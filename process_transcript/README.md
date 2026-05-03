# Process Transcript

This directory contains an ECMAScript 5.1 Node.js script that converts Codex/OpenAI transcript `.jsonl` files into plain text conversation logs.

## What it does

- Reads every `.jsonl` file from an input directory
- Extracts only visible `user` and `assistant` messages
- Writes one human-readable `.txt` file per transcript
- Preserves the transcript timestamp for each message
- Skips hidden `encrypted_content`
- Ignores internal aborted-turn marker messages

## Location

- Script: `ai_experiments/process_transcript/process_transcript.js`
- Default input directory: `transcripts/`
- Default output location: next to each input `.jsonl` file

## Requirements

- Node.js
- The script itself uses ES5.1-style syntax (`var`, classic functions, no arrow functions, no `let`/`const`)

## Usage

From the repository root:

```sh
node ai_experiments/process_transcript/process_transcript.js
```

This reads `transcripts/` and writes each `.txt` file next to its source `.jsonl`.

You can also provide custom input and output directories:

```sh
node ai_experiments/process_transcript/process_transcript.js path/to/input path/to/output
```

## Output format

Each message is written like this:

```text
[2026-04-30T09:09:49.191Z] GPT
The build is still running.

[2026-04-30T09:09:41.952Z] User
run the bootstrap
```

## Notes

- The converter uses `response_item` message entries so it only includes visible chat messages.
- It does not include tool calls, reasoning entries, system prompts, developer prompts, or other event records.
- If you pass an output directory, the script writes converted files there. Otherwise it writes beside the input files.
