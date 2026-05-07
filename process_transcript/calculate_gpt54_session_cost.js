#!/usr/bin/env node

'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');

var TARGET_MODEL = 'gpt-5.4';

/*
 * Pricing verified on 2026-05-07 against OpenAI's official API pricing page:
 * https://openai.com/api/pricing/
 *
 * GPT-5.4 standard rates there are:
 * - input:        $2.50 / 1M tokens
 * - cached input: $0.25 / 1M tokens
 * - output:       $15.00 / 1M tokens
 *
 * The session logs expose cumulative usage snapshots in `token_count` events.
 * Those snapshots mirror the OpenAI usage schema:
 * - `input_tokens`
 * - `cached_input_tokens`
 * - `output_tokens`
 * - `reasoning_output_tokens`
 *
 * Official usage docs show:
 * - `input_tokens_details.cached_tokens` is the cached subset of input tokens
 * - `output_tokens_details.reasoning_tokens` is the reasoning subset of output tokens
 *
 * Citations:
 * - usage schema: https://platform.openai.com/docs/api-reference/responses/list
 * - prompt caching guide: https://developers.openai.com/api/docs/guides/prompt-caching
 *
 * Because cached input tokens are a subset of input tokens, the uncached input
 * billed at the normal input rate is:
 *
 *   uncached_input_tokens = input_tokens - cached_input_tokens
 *
 * Reasoning output tokens are reported separately for visibility, but they are
 * still part of `output_tokens`, so this script does not bill them twice.
 */
var PRICING = {
  inputPerMillion: 2.50,
  cachedInputPerMillion: 0.25,
  outputPerMillion: 15.00
};

function printUsage(scriptName) {
  console.error('Usage: node ' + scriptName + ' [sessionsDir]');
  console.error('Default sessionsDir: ~/.codex/sessions');
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }

  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.indexOf('~/') === 0) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function formatMoney(amount) {
  return '$' + amount.toFixed(6);
}

function toCount(value) {
  if (typeof value === 'number' && isFinite(value) && value >= 0) {
    return value;
  }

  return 0;
}

function makeUsageSnapshot(info) {
  var totalUsage = info && info.total_token_usage ? info.total_token_usage : null;

  if (!totalUsage) {
    return null;
  }

  return {
    inputTokens: toCount(totalUsage.input_tokens),
    cachedInputTokens: toCount(totalUsage.cached_input_tokens),
    outputTokens: toCount(totalUsage.output_tokens),
    reasoningOutputTokens: toCount(totalUsage.reasoning_output_tokens)
  };
}

function cloneUsage(usage) {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens
  };
}

function zeroUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0
  };
}

function addUsage(target, delta) {
  target.inputTokens += delta.inputTokens;
  target.cachedInputTokens += delta.cachedInputTokens;
  target.outputTokens += delta.outputTokens;
  target.reasoningOutputTokens += delta.reasoningOutputTokens;
}

function diffUsage(previous, current) {
  var delta = zeroUsage();

  if (!previous) {
    return cloneUsage(current);
  }

  if (current.inputTokens < previous.inputTokens ||
      current.cachedInputTokens < previous.cachedInputTokens ||
      current.outputTokens < previous.outputTokens ||
      current.reasoningOutputTokens < previous.reasoningOutputTokens) {
    return cloneUsage(current);
  }

  delta.inputTokens = current.inputTokens - previous.inputTokens;
  delta.cachedInputTokens = current.cachedInputTokens - previous.cachedInputTokens;
  delta.outputTokens = current.outputTokens - previous.outputTokens;
  delta.reasoningOutputTokens = current.reasoningOutputTokens - previous.reasoningOutputTokens;

  return delta;
}

function computeCosts(usage) {
  var uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  var inputCost;
  var cachedInputCost;
  var outputCost;

  if (uncachedInputTokens < 0) {
    uncachedInputTokens = 0;
  }

  inputCost = (uncachedInputTokens / 1000000) * PRICING.inputPerMillion;
  cachedInputCost = (usage.cachedInputTokens / 1000000) * PRICING.cachedInputPerMillion;
  outputCost = (usage.outputTokens / 1000000) * PRICING.outputPerMillion;

  return {
    uncachedInputTokens: uncachedInputTokens,
    inputCost: inputCost,
    cachedInputCost: cachedInputCost,
    outputCost: outputCost,
    totalCost: inputCost + cachedInputCost + outputCost
  };
}

function walkFiles(rootDir, results) {
  var entries;
  var i;
  var entryPath;
  var stat;

  entries = fs.readdirSync(rootDir);
  for (i = 0; i < entries.length; i += 1) {
    entryPath = path.join(rootDir, entries[i]);
    stat = fs.statSync(entryPath);

    if (stat.isDirectory()) {
      walkFiles(entryPath, results);
    } else if (stat.isFile() && /\.jsonl$/i.test(entries[i])) {
      results.push(entryPath);
    }
  }
}

function listJsonlFiles(rootDir) {
  var results = [];

  walkFiles(rootDir, results);
  results.sort();
  return results;
}

function parseJsonLine(line, filePath, lineNumber, stats) {
  try {
    return JSON.parse(line);
  } catch (error) {
    if (stats) {
      stats.malformedLines += 1;
    }
    return null;
  }
}

function processSessionFile(filePath, targetModel) {
  var contents;
  var lines;
  var currentModel;
  var previousUsage;
  var matchedAnyTurn;
  var fileUsage;
  var stats;
  var i;
  var trimmed;
  var record;
  var payload;
  var snapshot;
  var delta;

  contents = fs.readFileSync(filePath, 'utf8');
  lines = contents.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  currentModel = null;
  previousUsage = null;
  matchedAnyTurn = false;
  fileUsage = zeroUsage();
  stats = {
    filePath: filePath,
    usage: fileUsage,
    tokenCountEvents: 0,
    matchedTokenCountEvents: 0,
    matchedAnyTurn: false,
    malformedLines: 0
  };

  for (i = 0; i < lines.length; i += 1) {
    trimmed = lines[i].replace(/^\s+|\s+$/g, '');
    if (!trimmed) {
      continue;
    }

    record = parseJsonLine(trimmed, filePath, i + 1, stats);
    if (!record || !record.payload) {
      continue;
    }

    payload = record.payload;

    if (record.type === 'turn_context' && typeof payload.model === 'string' && payload.model) {
      currentModel = payload.model;
      if (currentModel === targetModel) {
        matchedAnyTurn = true;
        stats.matchedAnyTurn = true;
      }
      continue;
    }

    if (record.type !== 'event_msg' || payload.type !== 'token_count' || !payload.info) {
      continue;
    }

    snapshot = makeUsageSnapshot(payload.info);
    if (!snapshot) {
      continue;
    }

    stats.tokenCountEvents += 1;
    delta = diffUsage(previousUsage, snapshot);

    if (currentModel === targetModel) {
      addUsage(fileUsage, delta);
      stats.matchedTokenCountEvents += 1;
    }

    previousUsage = snapshot;
  }

  return stats;
}

function main() {
  var args;
  var sessionsDir;
  var files;
  var totals;
  var matchedFiles;
  var totalTokenCountEvents;
  var matchedTokenCountEvents;
  var malformedLines;
  var i;
  var fileStats;
  var costs;

  args = process.argv.slice(2);
  if (args.length > 1) {
    printUsage(path.basename(process.argv[1] || 'calculate_gpt54_session_cost.js'));
    process.exit(1);
  }

  sessionsDir = path.resolve(expandHome(args[0] || '~/.codex/sessions'));
  if (!fs.existsSync(sessionsDir) || !fs.statSync(sessionsDir).isDirectory()) {
    console.error('Sessions directory not found: ' + sessionsDir);
    process.exit(1);
  }

  files = listJsonlFiles(sessionsDir);
  totals = zeroUsage();
  matchedFiles = 0;
  totalTokenCountEvents = 0;
  matchedTokenCountEvents = 0;
  malformedLines = 0;

  for (i = 0; i < files.length; i += 1) {
    fileStats = processSessionFile(files[i], TARGET_MODEL);
    addUsage(totals, fileStats.usage);
    totalTokenCountEvents += fileStats.tokenCountEvents;
    matchedTokenCountEvents += fileStats.matchedTokenCountEvents;
    malformedLines += fileStats.malformedLines;
    if (fileStats.matchedAnyTurn) {
      matchedFiles += 1;
    }
  }

  costs = computeCosts(totals);

  console.log('Model: ' + TARGET_MODEL);
  console.log('Sessions directory: ' + sessionsDir);
  console.log('JSONL files scanned: ' + files.length);
  console.log('Files with at least one ' + TARGET_MODEL + ' turn: ' + matchedFiles);
  console.log('Token-count snapshots scanned: ' + totalTokenCountEvents);
  console.log('Token-count snapshots priced for ' + TARGET_MODEL + ': ' + matchedTokenCountEvents);
  console.log('Malformed JSONL lines skipped: ' + malformedLines);
  console.log('');
  console.log('Token totals');
  console.log('  input_tokens: ' + totals.inputTokens);
  console.log('  cached_input_tokens: ' + totals.cachedInputTokens);
  console.log('  uncached_input_tokens: ' + costs.uncachedInputTokens);
  console.log('  output_tokens: ' + totals.outputTokens);
  console.log('  reasoning_output_tokens: ' + totals.reasoningOutputTokens + ' (included in output_tokens)');
  console.log('');
  console.log('Pricing verified on 2026-05-07 from https://openai.com/api/pricing/');
  console.log('  input rate: ' + formatMoney(PRICING.inputPerMillion) + ' / 1M tokens');
  console.log('  cached input rate: ' + formatMoney(PRICING.cachedInputPerMillion) + ' / 1M tokens');
  console.log('  output rate: ' + formatMoney(PRICING.outputPerMillion) + ' / 1M tokens');
  console.log('');
  console.log('Cost breakdown');
  console.log('  uncached input cost: ' + formatMoney(costs.inputCost));
  console.log('  cached input cost: ' + formatMoney(costs.cachedInputCost));
  console.log('  output cost: ' + formatMoney(costs.outputCost));
  console.log('  total cost: ' + formatMoney(costs.totalCost));
}

main();
