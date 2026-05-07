#!/usr/bin/env node

'use strict';

/*
 * This is the literate counterpart to `calculate_gpt54_session_cost.js`.
 *
 * "Literate" here means the program should explain itself as it unfolds.  A
 * reader should be able to move from top to bottom and answer, in order:
 *
 * 1. What is being estimated?
 * 2. Which external facts does the estimate depend on?
 * 3. Which transcript fields are treated as billable evidence?
 * 4. How are those fields turned into a cost?
 * 5. How does the script aggregate results and present them?
 *
 * The CLI behavior is intentionally kept identical to the original script.
 * The difference is in how the source is narrated, not in what the tool does.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');

/*
 * The original script is about one model only, so this version keeps the same
 * target.  Matching remains exact because the goal is behavioral parity rather
 * than a broader or smarter interpretation of model families.
 */
var TARGET_MODEL = 'gpt-5.4';

/*
 * Every estimate in this file eventually reduces to the three public token
 * prices below.
 *
 * Source checked on 2026-05-07:
 *   https://openai.com/api/pricing/
 *
 * GPT-5.4 standard rates there were:
 * - input:        $2.50 / 1M tokens
 * - cached input: $0.25 / 1M tokens
 * - output:       $15.00 / 1M tokens
 *
 * The script reports those rates back to the caller, just like the original.
 */
var PRICING = {
  inputPerMillion: 2.50,
  cachedInputPerMillion: 0.25,
  outputPerMillion: 15.00
};

/*
 * The program consumes transcript logs that contain token-count snapshots.
 * Conceptually we normalize every relevant snapshot to the same four numbers:
 *
 * - inputTokens
 * - cachedInputTokens
 * - outputTokens
 * - reasoningOutputTokens
 *
 * `reasoningOutputTokens` is carried through for visibility only.  It is not
 * billed separately because it is understood to be part of output tokens.
 *
 * Public docs describe the same ideas through the Responses API usage objects
 * and prompt-caching docs, although the transcript logs flatten the shape:
 * - https://platform.openai.com/docs/api-reference/responses
 * - https://platform.openai.com/docs/guides/prompt-caching
 */

function printUsage(scriptName) {
  console.error('Usage: node ' + scriptName + ' [--detailed] [--json] [logPath]');
  console.error('Default logPath: ~/.codex/sessions');
  console.error('`logPath` may be either a single .jsonl file or a directory tree.');
}

/*
 * The original tool accepts `~` in paths, so the literate version keeps that
 * small convenience intact.  This is part of matching the original interface,
 * not part of the cost model itself.
 */
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

/*
 * These formatting helpers are deliberately tiny, but they matter because the
 * script exposes the estimate both to humans and to machine consumers.
 */
function formatMoney(amount) {
  return '$' + amount.toFixed(6);
}

function formatPercent(numerator, denominator) {
  if (!denominator) {
    return '0.00%';
  }

  return ((numerator / denominator) * 100).toFixed(2) + '%';
}

/*
 * Transcript fields are not guaranteed to be present or well-typed.  Rather
 * than failing hard on a missing count, the original script treats bad values
 * as zero.  We preserve that policy here.
 */
function toCount(value) {
  if (typeof value === 'number' && isFinite(value) && value >= 0) {
    return value;
  }

  return 0;
}

/*
 * All accumulation in the program uses the same normalized usage shape.  The
 * next three helpers define that shape and the standard operations on it.
 */
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
 * Each token_count event carries cumulative usage in
 * `payload.info.total_token_usage`.  We normalize that structure immediately so
 * the rest of the program can ignore transcript-specific field names.
 */
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

/*
 * The transcript snapshots are cumulative within a session file.  Summing them
 * directly would therefore massively overcount.  The original script fixes that
 * by billing only the delta between consecutive snapshots, and that remains the
 * core accounting idea here.
 *
 * There is one awkward case: counters can appear to go backwards.  If they do,
 * we cannot prove whether the log restarted, the session was spliced, or the
 * transcript simply changed shape.  The original behavior is to treat the new
 * snapshot as a fresh chunk rather than emit negative usage.  This preserves
 * behavioral parity, even though the estimate can still be imperfect in such a
 * file.
 */
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

/*
 * This is the billing formula the entire tool exists to compute.
 *
 * Let:
 *   I = inputTokens
 *   C = cachedInputTokens
 *   O = outputTokens
 *
 * Then:
 *   uncached input = max(I - C, 0)
 *   cached input   = C
 *   output         = O
 *
 * Cost:
 *   ((I - C) / 1,000,000) * input rate
 * + ( C      / 1,000,000) * cached-input rate
 * + ( O      / 1,000,000) * output rate
 *
 * The `max(I - C, 0)` guard reflects another defensive choice carried over
 * from the original script: if the transcript ever claims more cached tokens
 * than total input tokens, we do not let the estimate go negative.
 */
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

/*
 * The original script accepts either a single `.jsonl` file or a directory
 * tree.  These helpers are the filesystem half of that contract.
 */
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

/*
 * Malformed lines are skipped rather than terminating the whole run.  The
 * caller still sees how many were skipped, which is the original script's way
 * of signalling "estimate completed, but input quality was imperfect".
 */
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

/*
 * This function is where transcript structure turns into model-specific usage.
 *
 * The transcript indicates the active model through `turn_context` records.
 * Token-count records do not themselves repeat the model name, so we attribute
 * each token snapshot to the most recent `turn_context.payload.model`.
 *
 * That attribution is not perfect in an abstract sense, but it is the
 * transcript model assumed by the original script and it matches the observable
 * structure of these logs.
 */
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

/*
 * Once each file has a normalized usage total, presentation becomes simpler.
 * We sort detailed results by descending cost so the most expensive sessions
 * appear first, exactly as in the original script.
 */
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

/*
 * Human-readable output and JSON output are both derived from the same summary
 * structures so that there is one place where the numbers are assembled.
 */
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

function printDetailedBreakdown(fileStatsList) {
  var sorted;
  var i;
  var fileStats;

  sorted = fileStatsList.slice(0).sort(compareFileStats);
  console.log('Per-session breakdown');

  for (i = 0; i < sorted.length; i += 1) {
    fileStats = sorted[i];
    if (!fileStats.matchedAnyTurn) {
      continue;
    }

    printTotals(fileStats.filePath, fileStats.usage, fileStats.malformedLines);
    console.log('  token_count_snapshots: ' + fileStats.tokenCountEvents);
    console.log('  priced_snapshots: ' + fileStats.matchedTokenCountEvents);
    console.log('');
  }
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

/*
 * The final section is the control flow of the tool:
 * parse flags, resolve inputs, accumulate per-file usage, and choose either
 * text or JSON output.
 *
 * Keeping `main()` last is part of the literate structure: by the time the
 * reader gets here, every operation it calls has already been explained.
 */
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
      printUsage(path.basename(process.argv[1] || 'calculate_gpt54_session_cost.js'));
      process.exit(0);
    }

    if (inputPath !== null) {
      printUsage(path.basename(process.argv[1] || 'calculate_gpt54_session_cost.js'));
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

  if (args.length > 0) {
    printUsage(path.basename(process.argv[1] || 'calculate_gpt54_session_cost.js'));
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
    fileStats = {
      model: TARGET_MODEL,
      input_path: resolvedInput.inputPath,
      input_kind: resolvedInput.inputKind,
      jsonl_files_scanned: files.length,
      files_with_matching_turns: matchedFiles,
      token_count_snapshots_scanned: totalTokenCountEvents,
      token_count_snapshots_priced: matchedTokenCountEvents,
      malformed_jsonl_lines_skipped: malformedLines,
      pricing_verified_on: '2026-05-07',
      pricing_source: 'https://openai.com/api/pricing/',
      pricing: {
        input_per_million: PRICING.inputPerMillion,
        cached_input_per_million: PRICING.cachedInputPerMillion,
        output_per_million: PRICING.outputPerMillion
      },
      totals: buildSummaryObject(totals, malformedLines)
    };

    if (detailed) {
      fileStats.session_summary = buildSummaryObject(totals, malformedLines);
      fileStats.sessions = buildDetailedObjects(fileStatsList);
    }

    console.log(JSON.stringify(fileStats, null, 2));
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
  console.log('Pricing verified on 2026-05-07 from https://openai.com/api/pricing/');
  console.log('  input rate: ' + formatMoney(PRICING.inputPerMillion) + ' / 1M tokens');
  console.log('  cached input rate: ' + formatMoney(PRICING.cachedInputPerMillion) + ' / 1M tokens');
  console.log('  output rate: ' + formatMoney(PRICING.outputPerMillion) + ' / 1M tokens');

  if (detailed) {
    console.log('');
    printDetailedBreakdown(fileStatsList);
  }
}

main();
