#!/usr/bin/env node

'use strict';

/*
 * Estimating the cost of GPT-5.4 sessions.
 *
 * This file is intended to be read as the source.  There is no separate
 * tangling step.  The prose gives the calculation in the order a reader needs;
 * the JavaScript paragraphs immediately following it are the executable
 * definitions.
 *
 * The input is either one Codex session `.jsonl` file or a directory tree of
 * such files.  The output is an estimate of the dollar cost attributable to the
 * exact model string `gpt-5.4`.
 *
 * The logs give us two facts:
 *
 *   1. `turn_context` records name the active model.
 *   2. `token_count` events give cumulative token usage snapshots.
 *
 * The calculation is therefore:
 *
 *   resolve the input files;
 *   analyze each file into usage attributable to the target model;
 *   add the file results;
 *   attach prices and diagnostics;
 *   print the report.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var TARGET_MODEL = 'gpt-5.4';

/*
 * Prices checked on 2026-05-07 at https://openai.com/api/pricing/.
 */
var PRICING = {
  inputPerMillion: 2.50,
  cachedInputPerMillion: 0.25,
  outputPerMillion: 15.00
};

/*
 * The whole program.
 *
 * The rest of the file is an expansion of this paragraph.  Command-line flags
 * choose a path and an output form; every output form uses the same report.
 */
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
  report = reportOf(resolvedInput, aggregation, options.detailed);

  if (options.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

/*
 * Usage arithmetic.
 *
 * We reduce every usable token snapshot to four integer coordinates:
 *
 *   inputTokens
 *   cachedInputTokens
 *   outputTokens
 *   reasoningOutputTokens
 *
 * Missing fields contribute zero.  Present fields that are negative,
 * fractional, or not finite also contribute zero, but that coercion is counted
 * because it says something about the quality of the transcript.
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
 * Pricing a usage vector.
 *
 * Cached input is a subset of input, so the full-rate input count is:
 *
 *   max(inputTokens - cachedInputTokens, 0)
 *
 * Reasoning output is reported for visibility, but it is already included in
 * `outputTokens`, so it is not priced a second time.
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
 * One file as a state machine.
 *
 * A session file is scanned from top to bottom.  The state is:
 *
 *   currentModel  the model named by the most recent turn_context
 *   previousUsage the previous usable cumulative token snapshot
 *   usage         the sum attributed to TARGET_MODEL
 *
 * Each parsed line becomes one of three observations:
 *
 *   model_turn(model)
 *   usage_snapshot(usage)
 *   other
 *
 * The central assumption is that a usage snapshot belongs to the model named
 * by the most recent `turn_context`.  Because token snapshots are cumulative,
 * the quantity we add is the difference from the previous usable snapshot.
 *
 * Example:
 *
 *   turn_context gpt-5.4
 *   token_count  input=100 cached=20 output=10   add (100,20,10)
 *   token_count  input=150 cached=30 output=15   add (50,10,5)
 *   turn_context gpt-5.5
 *   token_count  input=190 cached=40 output=20   skip (40,10,5)
 *   turn_context gpt-5.4
 *   token_count  input=10  cached=1  output=2    reset, add (10,1,2)
 *
 * A backward-moving counter is treated as a reset: the whole current snapshot
 * is used as the increment, and the reset is reported.  This is a recovery
 * convention, not a claim that the transcript proves a clean restart.
 */
function newFileAnalysis(filePath) {
  var usage = zeroUsage();
  var diagnostics = newDiagnostics();

  return {
    filePath: filePath,
    currentModel: null,
    previousUsage: null,
    usage: usage,
    diagnostics: diagnostics,
    tokenCountEvents: 0,
    matchedTokenCountEvents: 0,
    matchedAnyTurn: false
  };
}

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
    payload.type === 'token_count';
}

function observationOfRecord(record, diagnostics) {
  var payload;
  var usage;

  if (!record || !record.payload) {
    return {
      kind: 'other'
    };
  }

  payload = record.payload;

  if (isModelTurnRecord(record, payload)) {
    return {
      kind: 'model_turn',
      model: payload.model
    };
  }

  if (isTokenCountRecord(record, payload)) {
    usage = usageFromInfo(payload.info, diagnostics);
    if (usage) {
      return {
        kind: 'usage_snapshot',
        usage: usage
      };
    }
  }

  return {
    kind: 'other'
  };
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

function advanceFileAnalysis(analysis, observation, targetModel) {
  var incrementUsage;

  if (observation.kind === 'model_turn') {
    analysis.currentModel = observation.model;
    if (analysis.currentModel === targetModel) {
      analysis.matchedAnyTurn = true;
    }
    return;
  }

  if (observation.kind !== 'usage_snapshot') {
    return;
  }

  analysis.tokenCountEvents += 1;
  incrementUsage = incrementFromSnapshots(analysis.previousUsage, observation.usage, analysis.diagnostics);

  if (analysis.currentModel === targetModel) {
    addUsage(analysis.usage, incrementUsage);
    analysis.matchedTokenCountEvents += 1;
  }

  analysis.previousUsage = observation.usage;
}

function fileAnalysisResult(analysis) {
  return {
    filePath: analysis.filePath,
    usage: analysis.usage,
    diagnostics: analysis.diagnostics,
    tokenCountEvents: analysis.tokenCountEvents,
    matchedTokenCountEvents: analysis.matchedTokenCountEvents,
    matchedAnyTurn: analysis.matchedAnyTurn
  };
}

function analyzeSessionFile(filePath, targetModel) {
  var fileContents;
  var fileLines;
  var analysis;
  var lineIndex;
  var trimmedLine;
  var record;
  var observation;

  fileContents = fs.readFileSync(filePath, 'utf8');
  fileLines = fileContents.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  analysis = newFileAnalysis(filePath);

  for (lineIndex = 0; lineIndex < fileLines.length; lineIndex += 1) {
    trimmedLine = fileLines[lineIndex].replace(/^\s+|\s+$/g, '');
    if (!trimmedLine) {
      continue;
    }

    record = parseJsonLine(trimmedLine, filePath, lineIndex + 1, analysis.diagnostics);
    observation = observationOfRecord(record, analysis.diagnostics);
    advanceFileAnalysis(analysis, observation, targetModel);
  }

  return fileAnalysisResult(analysis);
}

/*
 * The input domain.
 *
 * By default we scan `~/.codex/sessions`.  The caller may instead provide one
 * `.jsonl` file or a directory tree.  Directory traversal is sorted so reports
 * are deterministic.  This program deliberately does not recover from
 * filesystem errors beyond the explicit "path not found" check.
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
 * From files to a report.
 *
 * Aggregation is just a fold:
 *
 *   totalUsage       := zero
 *   totalDiagnostics := zero diagnostics
 *   for each file:
 *     analyze the file
 *     add its usage
 *     merge its diagnostics
 *
 * We then translate the internal names to the public report schema.  Text and
 * JSON output both consume this same report object.
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

function reportOf(resolvedInput, aggregation, includeDetails) {
  var totalDiagnosticsObject;
  var totalSummary;
  var report;

  totalDiagnosticsObject = diagnosticsObjectOf(aggregation.totalDiagnostics);
  totalSummary = summaryOf(aggregation.totalUsage, totalDiagnosticsObject);

  report = {
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

  if (includeDetails) {
    report.session_summary = totalSummary;
    report.sessions = detailedReportsOf(aggregation.fileStatsList);
  }

  return report;
}

/*
 * Rendering.
 *
 * The renderer formats an already-computed report.  It does not perform token
 * attribution or pricing decisions.
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

function pricingRows(report) {
  return [
    'Pricing verified on ' + report.pricing_verified_on + ' from ' + report.pricing_source,
    '  input rate: ' + formatMoney(report.pricing.input_per_million) + ' / 1M tokens',
    '  cached input rate: ' + formatMoney(report.pricing.cached_input_per_million) + ' / 1M tokens',
    '  output rate: ' + formatMoney(report.pricing.output_per_million) + ' / 1M tokens'
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

function printDetailedReports(sessionReports) {
  var sessionIndex;
  var sessionReport;

  console.log('Per-session breakdown');

  for (sessionIndex = 0; sessionIndex < sessionReports.length; sessionIndex += 1) {
    sessionReport = sessionReports[sessionIndex];
    printSummary(sessionReport.file_path, {
      usage: sessionReport.usage,
      costs: sessionReport.costs,
      diagnostics: sessionReport.diagnostics
    }, true);
    console.log('  token_count_snapshots: ' + sessionReport.token_count_snapshots);
    console.log('  priced_snapshots: ' + sessionReport.priced_snapshots);
    console.log('');
  }
}

function printReport(report) {
  printRows(rowsOfReportPreamble(report));
  console.log('');
  printSummary('Token totals', report.totals, false);
  console.log('');
  printRows(pricingRows(report));

  if (report.sessions) {
    console.log('');
    printDetailedReports(report.sessions);
  }
}

/*
 * Command line.
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

main();
