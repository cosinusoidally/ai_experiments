#!/usr/bin/env node

'use strict';

/*
 * Problem statement.
 *
 * Given one `.jsonl` transcript or a directory tree of transcripts, estimate
 * the dollar cost attributable to the exact model identifier `gpt-5.4`.
 *
 * The cost calculation is simple once the relevant token counts are known.  The
 * real work is extracting those counts from cumulative transcript snapshots and
 * stating the conventions used when the transcript is incomplete or malformed.
 *
 * The program is therefore written in the order one would write precise
 * pseudocode:
 *
 *   1. define the normalized data we manipulate;
 *   2. define the cost of one normalized usage vector;
 *   3. define how one transcript file yields model-attributed increments;
 *   4. define how multiple files are aggregated and reported.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

/*
 * Constants.
 *
 * We estimate only the exact model string below.  We do not infer families or
 * aliases.
 *
 * The prices were checked on 2026-05-07 at
 * https://openai.com/api/pricing/
 */
var TARGET_MODEL = 'gpt-5.4';

var PRICING = {
  inputPerMillion: 2.50,
  cachedInputPerMillion: 0.25,
  outputPerMillion: 15.00
};

/*
 * Step 1. Normalize transcript data.
 *
 * We reduce every usable token snapshot to a four-field record:
 *
 *   usage = {
 *     inputTokens,
 *     cachedInputTokens,
 *     outputTokens,
 *     reasoningOutputTokens
 *   }
 *
 * The counts are intended to be non-negative integers.  Any other scalar is
 * treated as unusable and replaced by zero.  That replacement is counted in a
 * diagnostics ledger rather than done silently.
 */
function zeroUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0
  };
}

function copyUsage(usage) {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens
  };
}

function addUsage(totalUsage, incrementUsage) {
  totalUsage.inputTokens += incrementUsage.inputTokens;
  totalUsage.cachedInputTokens += incrementUsage.cachedInputTokens;
  totalUsage.outputTokens += incrementUsage.outputTokens;
  totalUsage.reasoningOutputTokens += incrementUsage.reasoningOutputTokens;
}

function newDiagnostics() {
  return {
    malformedLines: 0,
    malformedLineLocations: [],
    missingUsageSnapshots: 0,
    invalidUsageFields: 0,
    resetSnapshots: 0
  };
}

function mergeDiagnostics(totalDiagnostics, fileDiagnostics) {
  totalDiagnostics.malformedLines += fileDiagnostics.malformedLines;
  totalDiagnostics.missingUsageSnapshots += fileDiagnostics.missingUsageSnapshots;
  totalDiagnostics.invalidUsageFields += fileDiagnostics.invalidUsageFields;
  totalDiagnostics.resetSnapshots += fileDiagnostics.resetSnapshots;
  totalDiagnostics.malformedLineLocations = totalDiagnostics.malformedLineLocations
    .concat(fileDiagnostics.malformedLineLocations)
    .slice(0, 20);
}

function noteMalformedLine(diagnostics, filePath, lineNumber) {
  diagnostics.malformedLines += 1;
  if (diagnostics.malformedLineLocations.length < 20) {
    diagnostics.malformedLineLocations.push({
      filePath: filePath,
      lineNumber: lineNumber
    });
  }
}

function normalizedCount(value, diagnostics) {
  if (typeof value === 'number' &&
      isFinite(value) &&
      value >= 0 &&
      Math.floor(value) === value) {
    return value;
  }

  if (diagnostics && value !== undefined) {
    diagnostics.invalidUsageFields += 1;
  }

  return 0;
}

function usageFromInfo(infoObject, diagnostics) {
  var totalUsageObject = infoObject && infoObject.total_token_usage ? infoObject.total_token_usage : null;

  if (!totalUsageObject) {
    if (diagnostics) {
      diagnostics.missingUsageSnapshots += 1;
    }
    return null;
  }

  return {
    inputTokens: normalizedCount(totalUsageObject.input_tokens, diagnostics),
    cachedInputTokens: normalizedCount(totalUsageObject.cached_input_tokens, diagnostics),
    outputTokens: normalizedCount(totalUsageObject.output_tokens, diagnostics),
    reasoningOutputTokens: normalizedCount(totalUsageObject.reasoning_output_tokens, diagnostics)
  };
}

/*
 * Step 2. Price one normalized usage vector.
 *
 * Cached input is treated as a subset of input.  Therefore we price
 *
 *   uncached input = max(input - cachedInput, 0)
 *   cached input   = cachedInput
 *   output         = output
 *
 * Reasoning output is carried for visibility but not priced separately.
 */
function costsOf(usage) {
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
 * Step 3. Turn one transcript file into model-attributed increments.
 *
 * The transcript logic can be stated as pseudocode:
 *
 *   currentModel  := null
 *   previousUsage := null
 *   fileUsage     := zero
 *
 *   for each non-empty line:
 *     parse JSON; if malformed, count and skip
 *     if line is a turn_context with model, update currentModel
 *     if line is not a token_count event, skip
 *     extract normalized usage snapshot U
 *     let delta be:
 *       U                      if previousUsage is null
 *       U                      if any coordinate moved backward
 *       U - previousUsage      otherwise
 *     if currentModel == TARGET_MODEL, add delta to fileUsage
 *     previousUsage := U
 *
 * The crucial assumption is that token-count snapshots are attributable to the
 * model named by the most recent `turn_context`.  Since the snapshots are
 * cumulative, correctness depends on transcript ordering being well-behaved
 * enough that differencing adjacent snapshots does not smear one model's usage
 * into another's.
 *
 * When a counter moves backward, we take the current snapshot itself as the
 * increment.  This is a recovery convention, not a theorem.  It is chosen so
 * that resets are visible in diagnostics rather than hidden as dropped usage.
 */
function parseJsonLine(lineText, filePath, lineNumber, diagnostics) {
  try {
    return JSON.parse(lineText);
  } catch (error) {
    if (diagnostics) {
      noteMalformedLine(diagnostics, filePath, lineNumber);
    }
    return null;
  }
}

function isModelTurnRecord(record, payload) {
  return record.type === 'turn_context' &&
    typeof payload.model === 'string' &&
    payload.model;
}

function isTokenCountRecord(record, payload) {
  return record.type === 'event_msg' &&
    payload.type === 'token_count' &&
    payload.info;
}

function incrementFromSnapshots(previousUsage, currentUsage, diagnostics) {
  var incrementUsage = zeroUsage();

  if (!previousUsage) {
    return copyUsage(currentUsage);
  }

  if (currentUsage.inputTokens < previousUsage.inputTokens ||
      currentUsage.cachedInputTokens < previousUsage.cachedInputTokens ||
      currentUsage.outputTokens < previousUsage.outputTokens ||
      currentUsage.reasoningOutputTokens < previousUsage.reasoningOutputTokens) {
    if (diagnostics) {
      diagnostics.resetSnapshots += 1;
    }
    return copyUsage(currentUsage);
  }

  incrementUsage.inputTokens = currentUsage.inputTokens - previousUsage.inputTokens;
  incrementUsage.cachedInputTokens = currentUsage.cachedInputTokens - previousUsage.cachedInputTokens;
  incrementUsage.outputTokens = currentUsage.outputTokens - previousUsage.outputTokens;
  incrementUsage.reasoningOutputTokens = currentUsage.reasoningOutputTokens - previousUsage.reasoningOutputTokens;

  return incrementUsage;
}

function analyzeSessionFile(filePath, targetModel) {
  var fileContents;
  var fileLines;
  var currentModel;
  var previousUsage;
  var fileUsage;
  var diagnostics;
  var stats;
  var lineIndex;
  var trimmedLine;
  var record;
  var payload;
  var currentUsage;
  var incrementUsage;

  fileContents = fs.readFileSync(filePath, 'utf8');
  fileLines = fileContents.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  currentModel = null;
  previousUsage = null;
  fileUsage = zeroUsage();
  diagnostics = newDiagnostics();

  stats = {
    filePath: filePath,
    usage: fileUsage,
    diagnostics: diagnostics,
    tokenCountEvents: 0,
    matchedTokenCountEvents: 0,
    matchedAnyTurn: false
  };

  for (lineIndex = 0; lineIndex < fileLines.length; lineIndex += 1) {
    trimmedLine = fileLines[lineIndex].replace(/^\s+|\s+$/g, '');
    if (!trimmedLine) {
      continue;
    }

    record = parseJsonLine(trimmedLine, filePath, lineIndex + 1, diagnostics);
    if (!record || !record.payload) {
      continue;
    }

    payload = record.payload;

    if (isModelTurnRecord(record, payload)) {
      currentModel = payload.model;
      if (currentModel === targetModel) {
        stats.matchedAnyTurn = true;
      }
      continue;
    }

    if (!isTokenCountRecord(record, payload)) {
      continue;
    }

    currentUsage = usageFromInfo(payload.info, diagnostics);
    if (!currentUsage) {
      continue;
    }

    stats.tokenCountEvents += 1;
    incrementUsage = incrementFromSnapshots(previousUsage, currentUsage, diagnostics);

    if (currentModel === targetModel) {
      addUsage(fileUsage, incrementUsage);
      stats.matchedTokenCountEvents += 1;
    }

    previousUsage = currentUsage;
  }

  return stats;
}

/*
 * Step 4. Resolve the input path to an ordered list of files.
 *
 * This is intentionally simple.  The program accepts a single `.jsonl` file or
 * a directory tree and recursively gathers `.jsonl` descendants.  It does not
 * attempt to recover from filesystem errors beyond the explicit "path not
 * found" check.
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

function walkJsonlFiles(rootDirectory, fileList) {
  var directoryEntries;
  var entryIndex;
  var entryPath;
  var entryStat;

  directoryEntries = fs.readdirSync(rootDirectory);
  for (entryIndex = 0; entryIndex < directoryEntries.length; entryIndex += 1) {
    entryPath = path.join(rootDirectory, directoryEntries[entryIndex]);
    entryStat = fs.statSync(entryPath);

    if (entryStat.isDirectory()) {
      walkJsonlFiles(entryPath, fileList);
    } else if (entryStat.isFile() && /\.jsonl$/i.test(directoryEntries[entryIndex])) {
      fileList.push(entryPath);
    }
  }
}

function listJsonlFiles(rootDirectory) {
  var fileList = [];

  walkJsonlFiles(rootDirectory, fileList);
  fileList.sort();
  return fileList;
}

function resolveInputFiles(inputPath) {
  var resolvedPath;
  var resolvedStat;

  resolvedPath = path.resolve(expandHome(inputPath || '~/.codex/sessions'));
  if (!fs.existsSync(resolvedPath)) {
    throw new Error('Log path not found: ' + resolvedPath);
  }

  resolvedStat = fs.statSync(resolvedPath);
  if (resolvedStat.isDirectory()) {
    return {
      inputPath: resolvedPath,
      inputKind: 'directory',
      files: listJsonlFiles(resolvedPath)
    };
  }

  if (resolvedStat.isFile()) {
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
 * Step 5. Aggregate files into one report.
 *
 * Again the pseudocode is short:
 *
 *   totalUsage       := zero
 *   totalDiagnostics := zero diagnostics
 *   for each file:
 *     fileStats := analyzeSessionFile(file)
 *     add fileStats.usage to totalUsage
 *     merge fileStats.diagnostics into totalDiagnostics
 *   package totals, diagnostics, and optional per-file reports
 */
function summaryOf(usage, diagnosticsObject) {
  var costs = costsOf(usage);

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
    diagnostics: diagnosticsObject || null
  };
}

function diagnosticsObjectOf(diagnostics) {
  return {
    malformed_jsonl_lines: diagnostics.malformedLines,
    malformed_jsonl_line_locations: diagnostics.malformedLineLocations,
    token_count_events_missing_usage: diagnostics.missingUsageSnapshots,
    invalid_usage_fields_coerced_to_zero: diagnostics.invalidUsageFields,
    counter_resets_priced_as_fresh_snapshots: diagnostics.resetSnapshots
  };
}

function compareFileStats(leftFileStats, rightFileStats) {
  var leftCost;
  var rightCost;

  leftCost = costsOf(leftFileStats.usage).totalCost;
  rightCost = costsOf(rightFileStats.usage).totalCost;

  if (rightCost !== leftCost) {
    return rightCost - leftCost;
  }

  if (leftFileStats.filePath < rightFileStats.filePath) {
    return -1;
  }

  if (leftFileStats.filePath > rightFileStats.filePath) {
    return 1;
  }

  return 0;
}

function sortedFileStatsOf(fileStatsList) {
  return fileStatsList.slice(0).sort(compareFileStats);
}

function detailedReportsOf(fileStatsList) {
  var sortedFileStats;
  var reports;
  var fileIndex;
  var fileStats;
  var fileDiagnostics;
  var fileSummary;

  sortedFileStats = sortedFileStatsOf(fileStatsList);
  reports = [];

  for (fileIndex = 0; fileIndex < sortedFileStats.length; fileIndex += 1) {
    fileStats = sortedFileStats[fileIndex];
    if (!fileStats.matchedAnyTurn) {
      continue;
    }

    fileDiagnostics = diagnosticsObjectOf(fileStats.diagnostics);
    fileSummary = summaryOf(fileStats.usage, fileDiagnostics);
    reports.push({
      file_path: fileStats.filePath,
      token_count_snapshots: fileStats.tokenCountEvents,
      priced_snapshots: fileStats.matchedTokenCountEvents,
      usage: fileSummary.usage,
      costs: fileSummary.costs,
      diagnostics: fileSummary.diagnostics
    });
  }

  return reports;
}

function aggregateFiles(files, targetModel) {
  var totalUsage;
  var totalDiagnostics;
  var matchedFiles;
  var totalTokenCountEvents;
  var matchedTokenCountEvents;
  var fileStatsList;
  var fileIndex;
  var fileStats;

  totalUsage = zeroUsage();
  totalDiagnostics = newDiagnostics();
  matchedFiles = 0;
  totalTokenCountEvents = 0;
  matchedTokenCountEvents = 0;
  fileStatsList = [];

  for (fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    fileStats = analyzeSessionFile(files[fileIndex], targetModel);
    fileStatsList.push(fileStats);
    addUsage(totalUsage, fileStats.usage);
    mergeDiagnostics(totalDiagnostics, fileStats.diagnostics);
    totalTokenCountEvents += fileStats.tokenCountEvents;
    matchedTokenCountEvents += fileStats.matchedTokenCountEvents;

    if (fileStats.matchedAnyTurn) {
      matchedFiles += 1;
    }
  }

  return {
    totalUsage: totalUsage,
    totalDiagnostics: totalDiagnostics,
    matchedFiles: matchedFiles,
    totalTokenCountEvents: totalTokenCountEvents,
    matchedTokenCountEvents: matchedTokenCountEvents,
    fileStatsList: fileStatsList
  };
}

function reportOf(resolvedInput, aggregation) {
  var totalDiagnosticsObject;
  var totalSummary;

  totalDiagnosticsObject = diagnosticsObjectOf(aggregation.totalDiagnostics);
  totalSummary = summaryOf(aggregation.totalUsage, totalDiagnosticsObject);

  return {
    model: TARGET_MODEL,
    input_path: resolvedInput.inputPath,
    input_kind: resolvedInput.inputKind,
    jsonl_files_scanned: resolvedInput.files.length,
    files_with_matching_turns: aggregation.matchedFiles,
    token_count_snapshots_scanned: aggregation.totalTokenCountEvents,
    token_count_snapshots_priced: aggregation.matchedTokenCountEvents,
    diagnostics: totalDiagnosticsObject,
    pricing_verified_on: '2026-05-07',
    pricing_source: 'https://openai.com/api/pricing/',
    pricing: {
      input_per_million: PRICING.inputPerMillion,
      cached_input_per_million: PRICING.cachedInputPerMillion,
      output_per_million: PRICING.outputPerMillion
    },
    totals: totalSummary
  };
}

/*
 * Step 6. Render the report.
 *
 * The rendering code is intentionally late.  By this point all numbers are
 * already fixed.
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

function printRows(rows) {
  var rowIndex;

  for (rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    console.log(rows[rowIndex]);
  }
}

function pricingRows() {
  return [
    'Pricing verified on 2026-05-07 from https://openai.com/api/pricing/',
    '  input rate: ' + formatMoney(PRICING.inputPerMillion) + ' / 1M tokens',
    '  cached input rate: ' + formatMoney(PRICING.cachedInputPerMillion) + ' / 1M tokens',
    '  output rate: ' + formatMoney(PRICING.outputPerMillion) + ' / 1M tokens'
  ];
}

function rowsOfDiagnostics(diagnosticsObject) {
  var rows;
  var locationIndex;

  rows = [
    '  malformed_jsonl_lines: ' + diagnosticsObject.malformed_jsonl_lines,
    '  token_count_events_missing_usage: ' + diagnosticsObject.token_count_events_missing_usage,
    '  invalid_usage_fields_coerced_to_zero: ' + diagnosticsObject.invalid_usage_fields_coerced_to_zero,
    '  counter_resets_priced_as_fresh_snapshots: ' + diagnosticsObject.counter_resets_priced_as_fresh_snapshots
  ];

  for (locationIndex = 0; locationIndex < diagnosticsObject.malformed_jsonl_line_locations.length; locationIndex += 1) {
    rows.push('  malformed_jsonl_line[' + locationIndex + ']: ' +
      diagnosticsObject.malformed_jsonl_line_locations[locationIndex].filePath + ':' +
      diagnosticsObject.malformed_jsonl_line_locations[locationIndex].lineNumber);
  }

  return rows;
}

function rowsOfSummary(summaryObject) {
  return [
    '  input_tokens: ' + summaryObject.usage.input_tokens,
    '  cached_input_tokens: ' + summaryObject.usage.cached_input_tokens,
    '  uncached_input_tokens: ' + summaryObject.usage.uncached_input_tokens,
    '  cached_input_ratio: ' + formatPercent(summaryObject.usage.cached_input_tokens, summaryObject.usage.input_tokens),
    '  output_tokens: ' + summaryObject.usage.output_tokens,
    '  reasoning_output_tokens: ' + summaryObject.usage.reasoning_output_tokens + ' (included in output_tokens)',
    '  uncached_input_cost: ' + formatMoney(summaryObject.costs.uncached_input_cost),
    '  cached_input_cost: ' + formatMoney(summaryObject.costs.cached_input_cost),
    '  output_cost: ' + formatMoney(summaryObject.costs.output_cost),
    '  total_cost: ' + formatMoney(summaryObject.costs.total_cost)
  ];
}

function rowsOfReportPreamble(report) {
  var rows;
  var locationIndex;

  rows = [
    'Model: ' + report.model,
    'Input path: ' + report.input_path,
    'Input kind: ' + report.input_kind,
    'JSONL files scanned: ' + report.jsonl_files_scanned,
    'Files with at least one ' + report.model + ' turn: ' + report.files_with_matching_turns,
    'Token-count snapshots scanned: ' + report.token_count_snapshots_scanned,
    'Token-count snapshots priced for ' + report.model + ': ' + report.token_count_snapshots_priced,
    'Malformed JSONL lines skipped: ' + report.diagnostics.malformed_jsonl_lines,
    'Token-count events missing usage: ' + report.diagnostics.token_count_events_missing_usage,
    'Invalid usage fields coerced to zero: ' + report.diagnostics.invalid_usage_fields_coerced_to_zero,
    'Counter resets priced as fresh snapshots: ' + report.diagnostics.counter_resets_priced_as_fresh_snapshots
  ];

  for (locationIndex = 0; locationIndex < report.diagnostics.malformed_jsonl_line_locations.length; locationIndex += 1) {
    rows.push('Malformed JSONL line ' + (locationIndex + 1) + ': ' +
      report.diagnostics.malformed_jsonl_line_locations[locationIndex].filePath + ':' +
      report.diagnostics.malformed_jsonl_line_locations[locationIndex].lineNumber);
  }

  return rows;
}

function printSummary(label, summaryObject, includeDiagnostics) {
  var summaryRows;

  summaryRows = rowsOfSummary(summaryObject);
  console.log(label);
  printRows(summaryRows.slice(0, 6));
  if (includeDiagnostics !== false && summaryObject.diagnostics) {
    printRows(rowsOfDiagnostics(summaryObject.diagnostics));
  }
  printRows(summaryRows.slice(6));
}

function printDetailedReports(fileStatsList) {
  var sortedFileStats;
  var fileIndex;
  var fileStats;
  var fileSummary;

  sortedFileStats = sortedFileStatsOf(fileStatsList);
  console.log('Per-session breakdown');

  for (fileIndex = 0; fileIndex < sortedFileStats.length; fileIndex += 1) {
    fileStats = sortedFileStats[fileIndex];
    if (!fileStats.matchedAnyTurn) {
      continue;
    }

    fileSummary = summaryOf(fileStats.usage, diagnosticsObjectOf(fileStats.diagnostics));
    printSummary(fileStats.filePath, fileSummary, true);
    console.log('  token_count_snapshots: ' + fileStats.tokenCountEvents);
    console.log('  priced_snapshots: ' + fileStats.matchedTokenCountEvents);
    console.log('');
  }
}

function printReport(report, detailed, fileStatsList) {
  printRows(rowsOfReportPreamble(report));
  console.log('');
  printSummary('Token totals', report.totals, false);
  console.log('');
  printRows(pricingRows());

  if (detailed) {
    console.log('');
    printDetailedReports(fileStatsList);
  }
}

/*
 * Step 7. Parse the command line and execute the plan.
 */
function printUsage(scriptName) {
  console.error('Usage: node ' + scriptName + ' [--detailed] [--json] [logPath]');
  console.error('Default logPath: ~/.codex/sessions');
  console.error('`logPath` may be either a single .jsonl file or a directory tree.');
}

function parseCommandLine(argv) {
  var remainingArgs;
  var detailed;
  var jsonOutput;
  var inputPath;
  var scriptName;

  remainingArgs = argv.slice(2);
  detailed = false;
  jsonOutput = false;
  inputPath = null;
  scriptName = path.basename(argv[1] || 'calculate_gpt54_session_cost.js');

  while (remainingArgs.length) {
    if (remainingArgs[0] === '--detailed') {
      detailed = true;
      remainingArgs = remainingArgs.slice(1);
      continue;
    }

    if (remainingArgs[0] === '--json') {
      jsonOutput = true;
      remainingArgs = remainingArgs.slice(1);
      continue;
    }

    if (remainingArgs[0] === '--help' || remainingArgs[0] === '-h') {
      printUsage(scriptName);
      process.exit(0);
    }

    if (inputPath !== null) {
      printUsage(scriptName);
      process.exit(1);
    }

    inputPath = remainingArgs[0];
    remainingArgs = remainingArgs.slice(1);
  }

  return {
    detailed: detailed,
    jsonOutput: jsonOutput,
    inputPath: inputPath
  };
}

function main() {
  var options;
  var resolvedInput;
  var aggregation;
  var report;

  options = parseCommandLine(process.argv);

  try {
    resolvedInput = resolveInputFiles(options.inputPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (!resolvedInput.files.length) {
    console.error('No .jsonl files found under: ' + resolvedInput.inputPath);
    process.exit(1);
  }

  aggregation = aggregateFiles(resolvedInput.files, TARGET_MODEL);
  report = reportOf(resolvedInput, aggregation);

  if (options.jsonOutput) {
    if (options.detailed) {
      report.session_summary = report.totals;
      report.sessions = detailedReportsOf(aggregation.fileStatsList);
    }

    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report, options.detailed, aggregation.fileStatsList);
}

main();
