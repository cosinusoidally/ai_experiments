#!/usr/bin/env node

'use strict';

var fs = require('fs');
var path = require('path');

function printUsage(scriptName) {
  console.error('Usage: node ' + scriptName + ' [inputDir] [outputDir]');
  console.error('Defaults: inputDir=../../transcripts outputDir=same directory as each input file');
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, contents) {
  fs.writeFileSync(filePath, contents, 'utf8');
}

function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function trimSpecialUserMessage(text) {
  var normalized = normalizeNewlines(text).replace(/^\s+|\s+$/g, '');

  if (!normalized) {
    return '';
  }

  if (/^<environment_context>[\s\S]*<\/environment_context>$/.test(normalized)) {
    return '';
  }

  if (/^<turn_aborted>[\s\S]*<\/turn_aborted>$/.test(normalized)) {
    return '';
  }

  return normalized;
}

function extractContentText(content) {
  var parts;
  var i;
  var item;
  var text;

  if (!content || !content.length) {
    return '';
  }

  parts = [];
  for (i = 0; i < content.length; i += 1) {
    item = content[i];
    if (!item || item.encrypted_content) {
      continue;
    }

    text = null;
    if (typeof item.text === 'string') {
      text = item.text;
    } else if (typeof item.input_text === 'string') {
      text = item.input_text;
    } else if (typeof item.output_text === 'string') {
      text = item.output_text;
    }

    if (text) {
      parts.push(text);
    }
  }

  return normalizeNewlines(parts.join('\n\n')).replace(/^\s+|\s+$/g, '');
}

function formatMessage(role, timestamp, text) {
  var label = role === 'assistant' ? 'GPT' : 'User';
  return '[' + timestamp + '] ' + label + '\n' + text;
}

function parseTranscriptFile(filePath) {
  var input;
  var lines;
  var messages;
  var i;
  var line;
  var record;
  var payload;
  var text;

  input = readUtf8(filePath);
  lines = normalizeNewlines(input).split('\n');
  messages = [];

  for (i = 0; i < lines.length; i += 1) {
    line = lines[i].replace(/^\s+|\s+$/g, '');
    if (!line) {
      continue;
    }

    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error('Invalid JSON on line ' + (i + 1) + ' in ' + filePath + ': ' + error.message);
    }

    if (!record || record.type !== 'response_item' || !record.payload) {
      continue;
    }

    payload = record.payload;
    if (payload.type !== 'message') {
      continue;
    }

    if (payload.role !== 'user' && payload.role !== 'assistant') {
      continue;
    }

    text = extractContentText(payload.content);
    if (payload.role === 'user') {
      text = trimSpecialUserMessage(text);
    }

    if (!text) {
      continue;
    }

    messages.push(formatMessage(payload.role, record.timestamp || 'unknown-timestamp', text));
  }

  return messages.join('\n\n');
}

function convertFile(inputPath, outputPath) {
  var outputText = parseTranscriptFile(inputPath);
  writeUtf8(outputPath, outputText ? outputText + '\n' : '');
}

function main() {
  var scriptDir = __dirname;
  var defaultInputDir = path.resolve(scriptDir, '../../transcripts');
  var inputDir = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultInputDir;
  var outputDir = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : null;
  var entries;
  var jsonlFiles;
  var i;
  var entryName;
  var inputPath;
  var outputName;
  var outputPath;

  if (process.argv.length > 4) {
    printUsage(path.basename(process.argv[1] || 'process_transcript.js'));
    process.exit(1);
  }

  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    console.error('Input directory not found: ' + inputDir);
    process.exit(1);
  }

  if (outputDir) {
    ensureDirectory(outputDir);
  }

  entries = fs.readdirSync(inputDir);
  jsonlFiles = [];
  for (i = 0; i < entries.length; i += 1) {
    entryName = entries[i];
    inputPath = path.join(inputDir, entryName);
    if (fs.statSync(inputPath).isFile() && /\.jsonl$/i.test(entryName)) {
      jsonlFiles.push(entryName);
    }
  }

  jsonlFiles.sort();

  if (!jsonlFiles.length) {
    console.error('No .jsonl files found in ' + inputDir);
    process.exit(1);
  }

  for (i = 0; i < jsonlFiles.length; i += 1) {
    entryName = jsonlFiles[i];
    inputPath = path.join(inputDir, entryName);
    outputName = entryName.replace(/\.jsonl$/i, '.txt');
    outputPath = outputDir ? path.join(outputDir, outputName) : path.join(inputDir, outputName);
    convertFile(inputPath, outputPath);
    console.log('Wrote ' + outputPath);
  }
}

main();
