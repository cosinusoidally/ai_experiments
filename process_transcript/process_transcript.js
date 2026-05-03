#!/usr/bin/env node

'use strict';

var fs = require('fs');
var path = require('path');

function printUsage(scriptName) {
  console.error('Usage: node ' + scriptName + ' <inputFile.jsonl> [outputFile.txt]');
  console.error('Defaults: writes rendered transcript to standard output');
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

function indentBlock(text) {
  return normalizeNewlines(String(text)).replace(/^/gm, '  ');
}

function formatSection(timestamp, label, text) {
  return '[' + timestamp + '] ' + label + '\n' + text;
}

function formatMessage(role, timestamp, text) {
  var label = role === 'assistant' ? 'GPT' : 'User';
  return formatSection(timestamp, label, text);
}

function extractReasoningText(payload) {
  var parts;
  var i;
  var item;

  parts = [];

  if (payload.summary && payload.summary.length) {
    for (i = 0; i < payload.summary.length; i += 1) {
      item = payload.summary[i];
      if (!item || item.encrypted_content) {
        continue;
      }

      if (typeof item.text === 'string' && item.text) {
        parts.push(item.text);
      } else if (typeof item.content === 'string' && item.content) {
        parts.push(item.content);
      }
    }
  }

  if (payload.content && typeof payload.content === 'string') {
    parts.push(payload.content);
  }

  if (!parts.length && payload.encrypted_content) {
    parts.push('[encrypted reasoning omitted]');
  }

  return normalizeNewlines(parts.join('\n\n')).replace(/^\s+|\s+$/g, '');
}

function formatReasoning(timestamp, payload) {
  var text = extractReasoningText(payload);

  if (!text) {
    return '';
  }

  return formatSection(timestamp, 'Reasoning', text);
}

function formatFunctionCall(timestamp, payload) {
  var lines;

  lines = [];
  lines.push('name: ' + (payload.name || 'unknown'));

  if (typeof payload.call_id === 'string' && payload.call_id) {
    lines.push('call_id: ' + payload.call_id);
  }

  if (typeof payload.arguments === 'string' && payload.arguments) {
    lines.push('arguments:');
    lines.push(indentBlock(payload.arguments));
  }

  return formatSection(timestamp, 'Tool Call', lines.join('\n'));
}

function formatFunctionCallOutput(timestamp, payload) {
  var lines;
  var outputText;

  lines = [];
  if (typeof payload.call_id === 'string' && payload.call_id) {
    lines.push('call_id: ' + payload.call_id);
  }

  outputText = typeof payload.output === 'string' ? normalizeNewlines(payload.output).replace(/^\s+|\s+$/g, '') : '';
  if (outputText) {
    lines.push('output:');
    lines.push(indentBlock(outputText));
  } else {
    lines.push('output: [none]');
  }

  return formatSection(timestamp, 'Tool Output', lines.join('\n'));
}

function parseTranscriptFile(filePath) {
  var input;
  var lines;
  var sections;
  var i;
  var line;
  var record;
  var payload;
  var text;
  var rendered;

  input = readUtf8(filePath);
  lines = normalizeNewlines(input).split('\n');
  sections = [];

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

    if (payload.type === 'message') {
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

      rendered = formatMessage(payload.role, record.timestamp || 'unknown-timestamp', text);
    } else if (payload.type === 'reasoning') {
      rendered = formatReasoning(record.timestamp || 'unknown-timestamp', payload);
    } else if (payload.type === 'function_call') {
      rendered = formatFunctionCall(record.timestamp || 'unknown-timestamp', payload);
    } else if (payload.type === 'function_call_output') {
      rendered = formatFunctionCallOutput(record.timestamp || 'unknown-timestamp', payload);
    } else {
      continue;
    }

    if (rendered) {
      sections.push(rendered);
    }
  }

  return sections.join('\n\n');
}

function main() {
  var inputPath;
  var outputPath;
  var outputText;

  if (process.argv.length < 3 || process.argv.length > 4) {
    printUsage(path.basename(process.argv[1] || 'process_transcript.js'));
    process.exit(1);
  }

  inputPath = path.resolve(process.cwd(), process.argv[2]);
  outputPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : null;

  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    console.error('Input file not found: ' + inputPath);
    process.exit(1);
  }

  if (!/\.jsonl$/i.test(inputPath)) {
    console.error('Input file must end with .jsonl: ' + inputPath);
    process.exit(1);
  }

  outputText = parseTranscriptFile(inputPath);
  if (outputText) {
    outputText += '\n';
  }

  if (outputPath) {
    writeUtf8(outputPath, outputText);
  } else {
    process.stdout.write(outputText);
  }
}

main();
