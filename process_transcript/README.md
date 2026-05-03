# Process Transcript

This directory contains an ECMAScript 5.1 Node.js script that converts a Codex/OpenAI transcript `.jsonl` file into a plain text conversation log.

## What it does

- Reads an explicit `.jsonl` transcript file
- Extracts only visible `user` and `assistant` messages
- Includes reasoning entries when present
- Includes tool calls and tool call outputs
- Includes patch tool calls and patch results
- Includes explicit file-read and file-listing events when the transcript tagged them
- Supports `--verbose` to include broader operational and lifecycle events
- Writes to standard output by default
- Writes to a `.txt` file when an output path is provided
- Preserves the transcript timestamp for each message
- Skips hidden `encrypted_content`
- Ignores internal aborted-turn marker messages

## Location

- Script: `ai_experiments/process_transcript/process_transcript.js`
- Input: explicit `.jsonl` file path
- Default output location: standard output

## Requirements

- Node.js
- The script itself uses ES5.1-style syntax (`var`, classic functions, no arrow functions, no `let`/`const`)

## Usage

From the repository root:

```sh
node ai_experiments/process_transcript/process_transcript.js transcripts/example.jsonl
```

This reads the given transcript file and prints the rendered log to standard output.

You can also provide an output file:

```sh
node ai_experiments/process_transcript/process_transcript.js transcripts/example.jsonl transcripts/example.txt
```

Verbose mode includes extra non-encrypted event data such as generic command completions, custom tool outputs, and lifecycle events:

```sh
node ai_experiments/process_transcript/process_transcript.js --verbose transcripts/example.jsonl
node ai_experiments/process_transcript/process_transcript.js --verbose transcripts/example.jsonl transcripts/example.txt
```

## Output format

Each message is written like this:

```text
[2026-04-30T09:09:49.191Z] GPT
The build is still running.

[2026-04-30T09:09:45.795Z] Tool Call
name: exec_command
call_id: call_aRy6Y7GuKBjvhyD0OkUdebxq
arguments:
  {"cmd":"./bootstrap-i386.sh","workdir":"/home/foo/src/gpt/tcc-0.9.27"}

[2026-04-30T09:09:46.988Z] Tool Output
call_id: call_aRy6Y7GuKBjvhyD0OkUdebxq
output:
  Chunk ID: f6171d
  Wall time: 1.0009 seconds
  Process running with session ID 21814

[2026-04-30T09:06:35.340Z] Reasoning
[encrypted reasoning omitted]

[2026-04-30T09:07:50.708Z] Custom Tool Call
name: apply_patch
call_id: call_eUgxSXn4iO7iVcp9eX6PuPOM
status: completed
input:
  *** Begin Patch
  ...

[2026-04-30T09:07:51.244Z] Patch Result
call_id: call_eUgxSXn4iO7iVcp9eX6PuPOM
status: completed
success: true
stdout:
  Success. Updated the following files:
  A /path/to/file

[2026-04-30T09:11:47.923Z] File Read
call_id: call_XWK9kmC4OCbgfK6t1qH984xD
status: completed
exit_code: 0
operation: read
  path: /home/foo/src/gpt/tcc-0.9.27/bootstrap-i386.sh
content:
  #!/bin/sh
  ...

[2026-04-30T09:09:41.952Z] User
run the bootstrap
```

## Notes

- The converter uses `response_item` entries for visible chat, reasoning, tool calls, and tool outputs.
- It also uses `event_msg` entries for `patch_apply_end` and file-oriented `exec_command_end` records.
- In `--verbose` mode it also includes additional non-encrypted operational events such as generic `exec_command_end`, `custom_tool_call_output`, `task_started`, `task_complete`, `turn_aborted`, and similar lifecycle records.
- Most reasoning entries in these transcripts are encrypted. Those are rendered as `[encrypted reasoning omitted]` because the script skips `encrypted_content`.
- If you pass an output file path, the script writes there. Otherwise it writes to standard output.
