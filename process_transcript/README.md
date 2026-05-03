# Process Transcript

This directory contains an ECMAScript 5.1 Node.js script that converts a Codex/OpenAI transcript `.jsonl` file into a plain text conversation log.

## What it does

- Reads an explicit `.jsonl` transcript file
- Extracts only visible `user` and `assistant` messages
- Includes reasoning entries when present
- Includes tool calls and tool call outputs
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

[2026-04-30T09:09:41.952Z] User
run the bootstrap
```

## Notes

- The converter uses `response_item` entries for visible chat, reasoning, tool calls, and tool outputs.
- Most reasoning entries in these transcripts are encrypted. Those are rendered as `[encrypted reasoning omitted]` because the script skips `encrypted_content`.
- If you pass an output file path, the script writes there. Otherwise it writes to standard output.
