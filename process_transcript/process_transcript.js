#!/usr/bin/env node

'use strict';

var fs = require('fs');
var path = require('path');

function printUsage(scriptName) {
  console.error('Usage: node ' + scriptName + ' [--verbose] <inputFile.jsonl> [outputFile.txt]');
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

function formatCustomToolCallOutput(timestamp, payload) {
  var lines = [];

  if (typeof payload.call_id === 'string' && payload.call_id) {
    lines.push('call_id: ' + payload.call_id);
  }

  if (typeof payload.output === 'string' && payload.output) {
    lines.push('output:');
    lines.push(indentBlock(payload.output.replace(/^\s+|\s+$/g, '')));
  } else {
    lines.push('output: [none]');
  }

  return formatSection(timestamp, 'Custom Tool Output', lines.join('\n'));
}

function formatCustomToolCall(timestamp, payload) {
  var lines;

  lines = [];
  lines.push('name: ' + (payload.name || 'unknown'));

  if (typeof payload.call_id === 'string' && payload.call_id) {
    lines.push('call_id: ' + payload.call_id);
  }

  if (typeof payload.status === 'string' && payload.status) {
    lines.push('status: ' + payload.status);
  }

  if (typeof payload.input === 'string' && payload.input) {
    lines.push('input:');
    lines.push(indentBlock(payload.input));
  }

  return formatSection(timestamp, 'Custom Tool Call', lines.join('\n'));
}

function formatPatchApplyEnd(timestamp, payload) {
  var lines;
  var changePath;
  var change;

  lines = [];

  if (typeof payload.call_id === 'string' && payload.call_id) {
    lines.push('call_id: ' + payload.call_id);
  }

  if (typeof payload.status === 'string' && payload.status) {
    lines.push('status: ' + payload.status);
  }

  if (typeof payload.success === 'boolean') {
    lines.push('success: ' + payload.success);
  }

  if (typeof payload.stdout === 'string' && payload.stdout) {
    lines.push('stdout:');
    lines.push(indentBlock(payload.stdout.replace(/^\s+|\s+$/g, '')));
  }

  if (typeof payload.stderr === 'string' && payload.stderr) {
    lines.push('stderr:');
    lines.push(indentBlock(payload.stderr.replace(/^\s+|\s+$/g, '')));
  }

  if (payload.changes) {
    for (changePath in payload.changes) {
      if (Object.prototype.hasOwnProperty.call(payload.changes, changePath)) {
        change = payload.changes[changePath];
        lines.push('change: ' + changePath);
        if (change && change.type) {
          lines.push(indentBlock('type: ' + change.type));
        }
        if (change && change.move_path) {
          lines.push(indentBlock('move_path: ' + change.move_path));
        }
        if (change && typeof change.unified_diff === 'string' && change.unified_diff) {
          lines.push(indentBlock('unified_diff:'));
          lines.push(indentBlock(indentBlock(change.unified_diff.replace(/^\s+|\s+$/g, ''))));
        }
        if (change && typeof change.content === 'string' && change.content) {
          lines.push(indentBlock('content:'));
          lines.push(indentBlock(indentBlock(change.content.replace(/^\s+|\s+$/g, ''))));
        }
      }
    }
  }

  return formatSection(timestamp, 'Patch Result', lines.join('\n'));
}

function summarizeParsedCommand(parsed, verbose) {
  if (!parsed || !parsed.type) {
    return verbose ? 'Command Result' : '';
  }

  if (parsed.type === 'read') {
    return 'File Read';
  }

  if (parsed.type === 'list_files' || parsed.type === 'search') {
    return 'File Listing';
  }

  return verbose ? 'Command Result' : '';
}

function formatExecCommandEnd(timestamp, payload, verbose) {
  var parsed;
  var label;
  var lines;
  var i;

  if (!payload.parsed_cmd || !payload.parsed_cmd.length) {
    return '';
  }

  label = '';
  for (i = 0; i < payload.parsed_cmd.length; i += 1) {
    parsed = payload.parsed_cmd[i];
    label = summarizeParsedCommand(parsed, verbose);
    if (label) {
      break;
    }
  }

  if (!label) {
    return '';
  }

  lines = [];
  if (typeof payload.call_id === 'string' && payload.call_id) {
    lines.push('call_id: ' + payload.call_id);
  }
  if (typeof payload.status === 'string' && payload.status) {
    lines.push('status: ' + payload.status);
  }
  if (typeof payload.exit_code !== 'undefined') {
    lines.push('exit_code: ' + payload.exit_code);
  }

  for (i = 0; i < payload.parsed_cmd.length; i += 1) {
    parsed = payload.parsed_cmd[i];
    lines.push('operation: ' + (parsed.type || 'unknown'));
    if (parsed.path) {
      lines.push(indentBlock('path: ' + parsed.path));
    }
    if (parsed.name) {
      lines.push(indentBlock('name: ' + parsed.name));
    }
    if (parsed.cmd) {
      lines.push(indentBlock('command: ' + parsed.cmd));
    }
  }

  if (typeof payload.aggregated_output === 'string' && payload.aggregated_output) {
    lines.push('content:');
    lines.push(indentBlock(payload.aggregated_output.replace(/^\s+|\s+$/g, '')));
  }

  return formatSection(timestamp, label, lines.join('\n'));
}

function formatGenericEvent(timestamp, label, payload) {
  return formatSection(timestamp, label, JSON.stringify(payload, null, 2));
}

function parseTranscriptFile(filePath, options) {
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

    if (!record || !record.payload) {
      continue;
    }

    payload = record.payload;

    if (record.type === 'response_item' && payload.type === 'message') {
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
    } else if (record.type === 'response_item' && payload.type === 'reasoning') {
      rendered = formatReasoning(record.timestamp || 'unknown-timestamp', payload);
    } else if (record.type === 'response_item' && payload.type === 'function_call') {
      rendered = formatFunctionCall(record.timestamp || 'unknown-timestamp', payload);
    } else if (record.type === 'response_item' && payload.type === 'function_call_output') {
      rendered = formatFunctionCallOutput(record.timestamp || 'unknown-timestamp', payload);
    } else if (record.type === 'response_item' && payload.type === 'custom_tool_call') {
      rendered = formatCustomToolCall(record.timestamp || 'unknown-timestamp', payload);
    } else if (record.type === 'response_item' && payload.type === 'custom_tool_call_output' && options.verbose) {
      rendered = formatCustomToolCallOutput(record.timestamp || 'unknown-timestamp', payload);
    } else if (record.type === 'event_msg' && payload.type === 'patch_apply_end') {
      rendered = formatPatchApplyEnd(record.timestamp || 'unknown-timestamp', payload);
    } else if (record.type === 'event_msg' && payload.type === 'exec_command_end') {
      rendered = formatExecCommandEnd(record.timestamp || 'unknown-timestamp', payload, options.verbose);
    } else if (record.type === 'event_msg' && options.verbose && payload.type === 'task_started') {
      rendered = formatGenericEvent(record.timestamp || 'unknown-timestamp', 'Task Started', payload);
    } else if (record.type === 'event_msg' && options.verbose && payload.type === 'task_complete') {
      rendered = formatGenericEvent(record.timestamp || 'unknown-timestamp', 'Task Complete', payload);
    } else if (record.type === 'event_msg' && options.verbose && payload.type === 'turn_aborted') {
      rendered = formatGenericEvent(record.timestamp || 'unknown-timestamp', 'Turn Aborted', payload);
    } else if (record.type === 'event_msg' && options.verbose && payload.type === 'error') {
      rendered = formatGenericEvent(record.timestamp || 'unknown-timestamp', 'Error', payload);
    } else if (record.type === 'event_msg' && options.verbose && payload.type === 'agent_message') {
      rendered = formatGenericEvent(record.timestamp || 'unknown-timestamp', 'Agent Message Event', payload);
    } else if (record.type === 'event_msg' && options.verbose && payload.type === 'user_message') {
      rendered = formatGenericEvent(record.timestamp || 'unknown-timestamp', 'User Message Event', payload);
    } else if (record.type === 'event_msg' && options.verbose && payload.type === 'compaction') {
      rendered = formatGenericEvent(record.timestamp || 'unknown-timestamp', 'Compaction', payload);
    } else if (record.type === 'event_msg' && options.verbose && payload.type === 'context_compacted') {
      rendered = formatGenericEvent(record.timestamp || 'unknown-timestamp', 'Context Compacted', payload);
    } else if (record.type === 'event_msg' && options.verbose && payload.type === 'compacted') {
      rendered = formatGenericEvent(record.timestamp || 'unknown-timestamp', 'Compacted', payload);
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
  var args;
  var verbose;
  var inputPath;
  var outputPath;
  var outputText;

  args = process.argv.slice(2);
  verbose = false;

  if (args.length && args[0] === '--verbose') {
    verbose = true;
    args = args.slice(1);
  }

  if (args.length < 1 || args.length > 2) {
    printUsage(path.basename(process.argv[1] || 'process_transcript.js'));
    process.exit(1);
  }

  inputPath = path.resolve(process.cwd(), args[0]);
  outputPath = args[1] ? path.resolve(process.cwd(), args[1]) : null;

  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    console.error('Input file not found: ' + inputPath);
    process.exit(1);
  }

  if (!/\.jsonl$/i.test(inputPath)) {
    console.error('Input file must end with .jsonl: ' + inputPath);
    process.exit(1);
  }

  outputText = parseTranscriptFile(inputPath, { verbose: verbose });
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
