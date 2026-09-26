# Bob Evidence — Fayaz

This folder contains screenshots of IBM Bob 2.0 sessions used while building Codebase Doctor, plus a running usage log.

## Screenshot Index

Only files that exist in this folder are listed (checked 2026-09-26). Each was matched to its
session by its on-screen content.

| File | Session | What the screenshot shows |
|---|---|---|
| `01-core-architecture-and-mcp-scaffold.png` | A/B — scaffold | Bob Agent mode: "All tasks completed 22/22", scaffold summary (10 tools registered, 14 passing tests) |
| `02-repository-consistency-audit.png` | C — consistency audit | Bob Agent mode: `mcp-server/` → `backend/` audit summary, build clean, 14/14 tests |
| `03-react18-migration-engine-complete.png` | D — React 18 transforms | Bob Agent mode: bc-1…bc-7 coverage matrix and the new `transforms.ts` |
| `04-end-to-end-integration-test.png` | F — integration tests | Bob Agent mode: "61/61 tests pass", end-to-end pipeline table |

> **How to capture:** Take a screenshot immediately after each significant Bob interaction and drop it here. Name files `NN-short-description.png` where `NN` is the next zero-padded sequence number (next: `05`). Add a row above only after the file exists.

## Usage Log

See [`BOB_USAGE_LOG.md`](BOB_USAGE_LOG.md) for a record of every Bob session.
