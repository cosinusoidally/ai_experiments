# Process Transcript

This directory contains an ECMAScript 5.1 Node.js script that converts a Codex/OpenAI transcript `.jsonl` file into a plain text conversation log.

It also contains a separate ECMAScript 5.1 Node.js script that scans `~/.codex/sessions/` logs and estimates the total token cost for `gpt-5.4`.

## What it does

- Reads an explicit `.jsonl` transcript file
- Extracts only visible `user` and `assistant` messages
- Includes reasoning entries when present
- Includes tool calls and tool call outputs
- Includes patch tool calls and patch results
- Includes explicit file-read and file-listing events when the transcript tagged them
- Includes command results by default
- Includes user interrupt events (`turn_aborted`) by default
- Supports `--verbose` to include broader operational and lifecycle events
- Writes to standard output by default
- Writes to a `.txt` file when an output path is provided
- Preserves the transcript timestamp for each message
- Skips hidden `encrypted_content`
- Ignores internal aborted-turn marker messages

## Location

- Script: `ai_experiments/process_transcript/process_transcript.js`
- Cost script: `ai_experiments/process_transcript/calculate_gpt54_session_cost.js`
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

To estimate the total `gpt-5.4` session cost from Codex logs:

```sh
node ai_experiments/process_transcript/calculate_gpt54_session_cost.js
```

You can also point it at a different sessions directory:

```sh
node ai_experiments/process_transcript/calculate_gpt54_session_cost.js ~/.codex/sessions
```

## Output format

Each message is written like this:

```text
[2026-04-30T09:09:49.191Z] GPT
The build is still running.

[2026-04-30T09:09:45.795Z line 123] Tool Call
name: exec_command
call_id: call_aRy6Y7GuKBjvhyD0OkUdebxq
arguments:
  {"cmd":"./bootstrap-i386.sh","workdir":"/home/foo/src/gpt/tcc-0.9.27"}

[2026-04-30T09:09:46.988Z line 124] Tool Output
call_id: call_aRy6Y7GuKBjvhyD0OkUdebxq
output:
  Chunk ID: f6171d
  Wall time: 1.0009 seconds
  Process running with session ID 21814

[2026-04-30T09:06:35.340Z line 9] Reasoning
[encrypted reasoning omitted]

[2026-04-30T09:07:50.708Z line 79] Custom Tool Call
name: apply_patch
call_id: call_eUgxSXn4iO7iVcp9eX6PuPOM
status: completed
input:
  *** Begin Patch
  ...

[2026-04-30T09:07:51.244Z line 81] Patch Result
call_id: call_eUgxSXn4iO7iVcp9eX6PuPOM
status: completed
success: true
stdout:
  Success. Updated the following files:
  A /path/to/file

[2026-04-30T09:11:47.923Z line 173] File Read
call_id: call_XWK9kmC4OCbgfK6t1qH984xD
status: completed
exit_code: 0
operation: read
  path: /home/foo/src/gpt/tcc-0.9.27/bootstrap-i386.sh
content:
  #!/bin/sh
  ...

[2026-04-30T09:09:41.952Z line 150] User
run the bootstrap
```

## Notes

- Every rendered section includes the source `.jsonl` line number or line range.
- The converter uses `response_item` entries for visible chat, reasoning, tool calls, tool outputs, and custom tool calls.
- It also uses `event_msg` entries for `patch_apply_end` and file-oriented `exec_command_end` records.
- It includes `turn_aborted` by default so user interruptions are visible.
- In `--verbose` mode it also includes additional non-encrypted operational events such as `custom_tool_call_output`, `task_started`, `task_complete`, and similar lifecycle records.
- Most reasoning entries in these transcripts are encrypted. Those are rendered as `[encrypted reasoning omitted]` because the script skips `encrypted_content`.
- If you pass an output file path, the script writes there. Otherwise it writes to standard output.

## Cost Calculation Notes

- `calculate_gpt54_session_cost.js` is separate from `process_transcript.js`; it does not change the transcript rendering path.
- It recursively scans `.jsonl` files under `~/.codex/sessions/` by default.
- It follows `turn_context.payload.model` to determine which token-count snapshots belong to `gpt-5.4`.
- It uses `event_msg` records of type `token_count` and reads `payload.info.total_token_usage`, which is cumulative within a session file.
- To avoid double-counting, it prices the delta between consecutive cumulative snapshots rather than summing every snapshot directly.
- It treats `cached_input_tokens` as a subset of `input_tokens`, so uncached input is `input_tokens - cached_input_tokens`.
- It treats `reasoning_output_tokens` as informational only because reasoning tokens are included inside `output_tokens`, so the script does not bill them separately.
- The script uses the OpenAI GPT-5.4 standard API prices verified on 2026-05-07: input `$2.50 / 1M`, cached input `$0.25 / 1M`, output `$15.00 / 1M`.
- Official references used in the code comments:
  - Pricing: https://openai.com/api/pricing/
  - Usage schema: https://platform.openai.com/docs/api-reference/responses/list
  - Prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
