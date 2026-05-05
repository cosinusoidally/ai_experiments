# AI Experiments

This repo is where I am testing out AI software development. In each of these
projects I have tried to get the AI to do as much as possible for me. In each
project I plan to add a human_review directory where I review the code that the
AI has generated, and add any relevant notes about my experience of AI based
software development.

## mawkcc

This is a compiler for a subset of C that is also valid JavaScript and AWK. This
is me trying to reproduce my cjsawk project (see /experiments/cjsawk in my
tcc_simple repo. To a very large extent this succeeded, and the AI wrote the bulk
of the code (with a fair amount of guidance from me).

Model: GPT-5.4 under Codex CLI

## jsvm

Planned to be a self hosted JavaScript VM (by growing mawkcc). This is still at
the early stages and WIP, but does have the initial test rig in place.

Model: GPT-5.4 under Codex CLI

## jsapi_test

This C program demonstrates embedding Mozilla Spidermonkey JavaScript engine into a C application.
It is compileable against Firefox 1 era Mozilla Spidermonkey (the original SpiderMonkey v1 API).

This project is incomplete and partially broken (since it was largely done with
Claude Haiku 4.5 via GitHub copilot). The Haiku model wasn't very good.

Model: Claude Haiku 4.5 under the web version of GitHub Copilot. Possibly also
       a bit of GPT-5.4 under Codex CLI, but I can't remember for sure.
