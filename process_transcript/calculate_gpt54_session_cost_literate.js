#!/usr/bin/env node

'use strict';

/*
 * calculate_gpt54_session_cost_literate.js
 * ----------------------------------------
 *
 * This file is intentionally written in a literate-programming style.  It is
 * still an executable ES5.1 Node.js script, but the comments are not merely
 * decorative: they explain what the estimator is trying to prove, what facts
 * it relies on, and where those facts are weaker than they first appear.
 *
 * Purpose
 * -------
 * Estimate the token-only API cost of `gpt-5.4` usage found in Codex/OpenAI
 * `.jsonl` session logs.
 *
 * The key word is "estimate".  The logs contain enough information to make a
 * defensible token-cost estimate, but not enough information to reconstruct a
 * full invoice with perfect fidelity.  This script therefore does two things:
 *
 * 1. it computes the estimate as carefully as the logs allow; and
 * 2. it states the assumptions and holes openly.
 *
 * Sources consulted on 2026-05-07
 * -------------------------------
 * 1. OpenAI API pricing
 *    https://openai.com/api/pricing/
 *
 *    Used for the standard GPT-5.4 token rates:
 *    - input:        $2.50 / 1M tokens
 *    - cached input: $0.25 / 1M tokens
 *    - output:       $15.00 / 1M tokens
 *
 * 2. Responses API reference
 *    https://platform.openai.com/docs/api-reference/responses
 *
 *    Used for the billing-shape idea that:
 *    - cached tokens are a subset of input tokens; and
 *    - reasoning tokens are reported inside output-token details, rather than
 *      constituting an additional, separately billed bucket.
 *
 * 3. Prompt caching guide
 *    https://platform.openai.com/docs/guides/prompt-caching
 *
 *    Used for the cached-input concept and discounted cached-token pricing.
 *
 * Sourcing caveat
 * ---------------
 * The official API docs describe usage with nested objects such as:
 * - usage.input_tokens_details.cached_tokens
 * - usage.output_tokens_details.reasoning_tokens
 *
 * The Codex session logs used here expose flattened fields inside
 * `payload.info.total_token_usage` and `payload.info.last_token_usage`:
 * - input_tokens
 * - cached_input_tokens
 * - output_tokens
 * - reasoning_output_tokens
 *
 * That flattening is directly observed in the local logs, but it is not the
 * same object shape shown in the public API reference.  So the mapping from
 * public docs to these transcript fields is partly inferential.
 *
 * Main billing model
 * ------------------
 * Let:
 *   I = total input tokens for a priced unit of work
 *   C = cached subset of those input tokens
 *   O = total output tokens
 *
 * Then the billed components are:
 *   uncached input  = max(I - C, 0)
 *   cached input    = C
 *   output          = O
 *
 * Cost is therefore:
 *
 *   cost =
 *     ((I - C) / 1,000,000) * input_rate
 *   + ( C      / 1,000,000) * cached_input_rate
 *   + ( O      / 1,000,000) * output_rate
 *
 * Why reasoning tokens are not priced separately
 * ----------------------------------------------
 * The logs surface `reasoning_output_tokens`, but those tokens are understood
 * as a subset of output tokens, not an extra category on top of output tokens.
 * Pricing them again would double-count.
 *
 * Why this script does NOT bill from `last_token_usage`
 * -----------------------------------------------------
 * The transcript logs contain `last_token_usage`, but empirical inspection of
 * real Codex session logs shows that this value can be repeated across multiple
 * snapshots, including snapshots at the beginning of the next turn.
 *
 * That means a naive sum of `last_token_usage` can double-count.  So the
 * billable path in this script uses cumulative `total_token_usage` deltas,
 * while treating `last_token_usage` as diagnostic evidence only.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');

var TARGET_MODEL = 'gpt-5.4';

var PRICING = {
  verifiedOn: '2026-05-07',
  source: 'https://openai.com/api/pricing/',
  inputPerMillion: 2.50,
  cachedInputPerMillion: 0.25,
  outputPerMillion: 15.00
};

function printUsage(scriptName) {
  console.error('Usage: node ' + scriptName + ' [--detailed] [--json] [logPath]');
  console.error('Default logPath: ~/.codex/sessions');
  console.error('`logPath` may be either a single .jsonl file or a directory tree.');
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

function formatPercent(numerator, denominator) {
  if (!denominator) {
    return '0.00%';
  }

  return ((numerator / denominator) * 100).toFixed(2) + '%';
}

function toCount(value) {
  if (typeof value === 'number' && isFinite(value) && value >= 0) {
    return value;
  }

  return 0;
}

function zeroUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0
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

function addUsage(target, delta) {
  target.inputTokens += delta.inputTokens;
  target.cachedInputTokens += delta.cachedInputTokens;
  target.outputTokens += delta.outputTokens;
  target.reasoningOutputTokens += delta.reasoningOutputTokens;
}

/*
 * The log can provide usage in two shapes:
 *
 * 1. `last_token_usage`
 *    Retained for analysis only, not used for billing.
 *
 * 2. `total_token_usage`
 *    Interpreted as a cumulative counter across the session so far.
 *
 * We parse either shape into the same normalized structure.
 */
function makeUsageFromUsageObject(usageObject) {
  if (!usageObject) {
    return null;
  }

  return {
    inputTokens: toCount(usageObject.input_tokens),
    cachedInputTokens: toCount(usageObject.cached_input_tokens),
    outputTokens: toCount(usageObject.output_tokens),
    reasoningOutputTokens: toCount(usageObject.reasoning_output_tokens)
  };
}

function makeUsageRecord(info) {
  if (!info) {
    return null;
  }

  return {
    lastUsage: makeUsageFromUsageObject(info.last_token_usage),
    totalUsage: makeUsageFromUsageObject(info.total_token_usage)
  };
}

/*
 * Delta calculation
 * -----------------
 * This is the primary billing path.
 *
 * If the cumulative counters go backwards, we do not know whether the session
 * restarted, the log was spliced, or the counters changed semantics.  In that
 * case we treat the current total as a fresh baseline-sized chunk rather than
 * emitting a negative delta.
 *
 * That keeps the estimate non-negative, but it can still overcount.  We record
 * how often that happened so the caller can see the weakness.
 */
function diffUsage(previous, current) {
  var delta = zeroUsage();

  if (!previous) {
    return {
      usage: cloneUsage(current),
      resetDetected: false
    };
  }

  if (current.inputTokens < previous.inputTokens ||
      current.cachedInputTokens < previous.cachedInputTokens ||
      current.outputTokens < previous.outputTokens ||
      current.reasoningOutputTokens < previous.reasoningOutputTokens) {
    return {
      usage: cloneUsage(current),
      resetDetected: true
    };
  }

  delta.inputTokens = current.inputTokens - previous.inputTokens;
  delta.cachedInputTokens = current.cachedInputTokens - previous.cachedInputTokens;
  delta.outputTokens = current.outputTokens - previous.outputTokens;
  delta.reasoningOutputTokens = current.reasoningOutputTokens - previous.reasoningOutputTokens;

  return {
    usage: delta,
    resetDetected: false
  };
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

function resolveInputFiles(inputPath) {
  var resolvedPath;
  var stat;

  resolvedPath = path.resolve(expandHome(inputPath || '~/.codex/sessions'));
  if (!fs.existsSync(resolvedPath)) {
    throw new Error('Log path not found: ' + resolvedPath);
  }

  stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    return {
      inputPath: resolvedPath,
      inputKind: 'directory',
      files: listJsonlFiles(resolvedPath)
    };
  }

  if (stat.isFile()) {
    if (!/\.jsonl$/i.test(path.basename(resolvedPath))) {
      throw new Error('Log file must end in .jsonl: ' + resolvedPath);
    }

    return {
      inputPath: resolvedPath,
      inputKind: 'file',
      files: [resolvedPath]
    };
  }

  throw new Error('Unsupported log path: ' + resolvedPath);
}

function parseJsonLine(line, stats) {
  try {
    return JSON.parse(line);
  } catch (error) {
    if (stats) {
      stats.malformedLines += 1;
    }
    return null;
  }
}

/*
 * Session attribution strategy
 * ----------------------------
 * We keep track of the latest `turn_context.payload.model`.  A subsequent
 * `token_count` event is attributed to that model.
 *
 * This is not mathematically perfect, but it matches the observable transcript
 * structure: a turn context names the active model, then a token-count event
 * reports usage for that turn.
 */
function processSessionFile(filePath, targetModel) {
  var contents;
  var lines;
  var currentModel;
  var previousTotalUsage;
  var matchedAnyTurn;
  var fileUsage;
  var stats;
  var i;
  var trimmed;
  var record;
  var payload;
  var usageRecord;
  var deltaInfo;
  var pricedUsage;
  var previousLastUsageSignature;
  var currentLastUsageSignature;

  contents = fs.readFileSync(filePath, 'utf8');
  lines = contents.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  currentModel = null;
  previousTotalUsage = null;
  matchedAnyTurn = false;
  fileUsage = zeroUsage();
  stats = {
    filePath: filePath,
    usage: fileUsage,
    tokenCountEvents: 0,
    matchedTokenCountEvents: 0,
    matchedAnyTurn: false,
    malformedLines: 0,
    tokenCountEventsWithLastUsage: 0,
    repeatedLastUsageSnapshots: 0,
    totalUsageResetEvents: 0
  };
  previousLastUsageSignature = null;

  for (i = 0; i < lines.length; i += 1) {
    trimmed = lines[i].replace(/^\s+|\s+$/g, '');
    if (!trimmed) {
      continue;
    }

    record = parseJsonLine(trimmed, stats);
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

    usageRecord = makeUsageRecord(payload.info);
    if (!usageRecord || (!usageRecord.lastUsage && !usageRecord.totalUsage)) {
      continue;
    }

    stats.tokenCountEvents += 1;
    pricedUsage = null;

    if (usageRecord.lastUsage) {
      stats.tokenCountEventsWithLastUsage += 1;
      currentLastUsageSignature = [
        usageRecord.lastUsage.inputTokens,
        usageRecord.lastUsage.cachedInputTokens,
        usageRecord.lastUsage.outputTokens,
        usageRecord.lastUsage.reasoningOutputTokens
      ].join(':');
      if (currentLastUsageSignature === previousLastUsageSignature) {
        stats.repeatedLastUsageSnapshots += 1;
      }
      previousLastUsageSignature = currentLastUsageSignature;
    }

    if (usageRecord.totalUsage) {
      deltaInfo = diffUsage(previousTotalUsage, usageRecord.totalUsage);
      pricedUsage = deltaInfo.usage;
      if (deltaInfo.resetDetected) {
        stats.totalUsageResetEvents += 1;
      }
    }

    if (currentModel === targetModel && pricedUsage) {
      addUsage(fileUsage, pricedUsage);
      stats.matchedTokenCountEvents += 1;
    }

    if (usageRecord.totalUsage) {
      previousTotalUsage = usageRecord.totalUsage;
    }
  }

  return stats;
}

function compareFileStats(a, b) {
  var aCost;
  var bCost;

  aCost = computeCosts(a.usage).totalCost;
  bCost = computeCosts(b.usage).totalCost;

  if (bCost !== aCost) {
    return bCost - aCost;
  }

  if (a.filePath < b.filePath) {
    return -1;
  }

  if (a.filePath > b.filePath) {
    return 1;
  }

  return 0;
}

function printTotals(label, usage, malformedLines) {
  var costs = computeCosts(usage);

  console.log(label);
  console.log('  input_tokens: ' + usage.inputTokens);
  console.log('  cached_input_tokens: ' + usage.cachedInputTokens);
  console.log('  uncached_input_tokens: ' + costs.uncachedInputTokens);
  console.log('  cached_input_ratio: ' + formatPercent(usage.cachedInputTokens, usage.inputTokens));
  console.log('  output_tokens: ' + usage.outputTokens);
  console.log('  reasoning_output_tokens: ' + usage.reasoningOutputTokens + ' (included in output_tokens)');
  if (typeof malformedLines === 'number') {
    console.log('  malformed_jsonl_lines: ' + malformedLines);
  }
  console.log('  uncached_input_cost: ' + formatMoney(costs.inputCost));
  console.log('  cached_input_cost: ' + formatMoney(costs.cachedInputCost));
  console.log('  output_cost: ' + formatMoney(costs.outputCost));
  console.log('  total_cost: ' + formatMoney(costs.totalCost));
}

function buildSummaryObject(usage, malformedLines) {
  var costs = computeCosts(usage);

  return {
    usage: {
      input_tokens: usage.inputTokens,
      cached_input_tokens: usage.cachedInputTokens,
      uncached_input_tokens: costs.uncachedInputTokens,
      cached_input_ratio: usage.inputTokens ? (usage.cachedInputTokens / usage.inputTokens) : 0,
      output_tokens: usage.outputTokens,
      reasoning_output_tokens: usage.reasoningOutputTokens
    },
    costs: {
      uncached_input_cost: costs.inputCost,
      cached_input_cost: costs.cachedInputCost,
      output_cost: costs.outputCost,
      total_cost: costs.totalCost
    },
    malformed_jsonl_lines: malformedLines
  };
}

function buildDetailedObjects(fileStatsList) {
  var sorted;
  var results;
  var i;
  var fileStats;
  var summary;

  sorted = fileStatsList.slice(0).sort(compareFileStats);
  results = [];

  for (i = 0; i < sorted.length; i += 1) {
    fileStats = sorted[i];
    if (!fileStats.matchedAnyTurn) {
      continue;
    }

    summary = buildSummaryObject(fileStats.usage, fileStats.malformedLines);
    results.push({
      file_path: fileStats.filePath,
      token_count_snapshots: fileStats.tokenCountEvents,
      priced_snapshots: fileStats.matchedTokenCountEvents,
      usage: summary.usage,
      costs: summary.costs,
      malformed_jsonl_lines: summary.malformed_jsonl_lines
    });
  }

  return results;
}

function main() {
  var args;
  var detailed;
  var jsonOutput;
  var inputPath;
  var resolvedInput;
  var files;
  var totals;
  var matchedFiles;
  var totalTokenCountEvents;
  var matchedTokenCountEvents;
  var malformedLines;
  var fileStatsList;
  var output;
  var i;
  var fileStats;

  args = process.argv.slice(2);
  detailed = false;
  jsonOutput = false;
  inputPath = null;

  while (args.length) {
    if (args[0] === '--detailed') {
      detailed = true;
      args = args.slice(1);
      continue;
    }

    if (args[0] === '--json') {
      jsonOutput = true;
      args = args.slice(1);
      continue;
    }

    if (args[0] === '--help' || args[0] === '-h') {
      printUsage(path.basename(process.argv[1] || 'calculate_gpt54_session_cost_literate.js'));
      process.exit(0);
    }

    if (inputPath !== null) {
      printUsage(path.basename(process.argv[1] || 'calculate_gpt54_session_cost_literate.js'));
      process.exit(1);
    }

    inputPath = args[0];
    args = args.slice(1);
  }

  try {
    resolvedInput = resolveInputFiles(inputPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  files = resolvedInput.files;
  if (!files.length) {
    console.error('No .jsonl files found under: ' + resolvedInput.inputPath);
    process.exit(1);
  }

  totals = zeroUsage();
  matchedFiles = 0;
  totalTokenCountEvents = 0;
  matchedTokenCountEvents = 0;
  malformedLines = 0;
  fileStatsList = [];

  for (i = 0; i < files.length; i += 1) {
    fileStats = processSessionFile(files[i], TARGET_MODEL);
    fileStatsList.push(fileStats);
    addUsage(totals, fileStats.usage);
    totalTokenCountEvents += fileStats.tokenCountEvents;
    matchedTokenCountEvents += fileStats.matchedTokenCountEvents;
    malformedLines += fileStats.malformedLines;
    if (fileStats.matchedAnyTurn) {
      matchedFiles += 1;
    }
  }

  if (jsonOutput) {
    output = {
      model: TARGET_MODEL,
      input_path: resolvedInput.inputPath,
      input_kind: resolvedInput.inputKind,
      jsonl_files_scanned: files.length,
      files_with_matching_turns: matchedFiles,
      token_count_snapshots_scanned: totalTokenCountEvents,
      token_count_snapshots_priced: matchedTokenCountEvents,
      malformed_jsonl_lines_skipped: malformedLines,
      pricing_verified_on: PRICING.verifiedOn,
      pricing_source: PRICING.source,
      pricing: {
        input_per_million: PRICING.inputPerMillion,
        cached_input_per_million: PRICING.cachedInputPerMillion,
        output_per_million: PRICING.outputPerMillion
      },
      totals: buildSummaryObject(totals, malformedLines)
    };

    if (detailed) {
      output.session_summary = buildSummaryObject(totals, malformedLines);
      output.sessions = buildDetailedObjects(fileStatsList);
    }

    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('Model: ' + TARGET_MODEL);
  console.log('Input path: ' + resolvedInput.inputPath);
  console.log('Input kind: ' + resolvedInput.inputKind);
  console.log('JSONL files scanned: ' + files.length);
  console.log('Files with at least one ' + TARGET_MODEL + ' turn: ' + matchedFiles);
  console.log('Token-count snapshots scanned: ' + totalTokenCountEvents);
  console.log('Token-count snapshots priced for ' + TARGET_MODEL + ': ' + matchedTokenCountEvents);
  console.log('Malformed JSONL lines skipped: ' + malformedLines);
  console.log('');
  printTotals('Token totals', totals, null);
  console.log('');
  console.log('Pricing verified on ' + PRICING.verifiedOn + ' from ' + PRICING.source);
  console.log('  input rate: ' + formatMoney(PRICING.inputPerMillion) + ' / 1M tokens');
  console.log('  cached input rate: ' + formatMoney(PRICING.cachedInputPerMillion) + ' / 1M tokens');
  console.log('  output rate: ' + formatMoney(PRICING.outputPerMillion) + ' / 1M tokens');

  if (detailed) {
    console.log('');
    console.log('Per-session breakdown');
    output = buildDetailedObjects(fileStatsList);
    for (i = 0; i < output.length; i += 1) {
      fileStats = output[i];
      printTotals(fileStats.file_path, {
        inputTokens: fileStats.usage.input_tokens,
        cachedInputTokens: fileStats.usage.cached_input_tokens,
        outputTokens: fileStats.usage.output_tokens,
        reasoningOutputTokens: fileStats.usage.reasoning_output_tokens
      }, fileStats.malformed_jsonl_lines);
      console.log('  token_count_snapshots: ' + fileStats.token_count_snapshots);
      console.log('  priced_snapshots: ' + fileStats.priced_snapshots);
      console.log('');
    }
  }
}

main();
