# Finite live multi-round checkpoint

Recorded 2026-09-21 for the [entered-prompt frontend](README.md).

## Setup

- Actual Pi SDK 0.86.1, existing OpenAI Codex subscription OAuth, `gpt-5.5`,
  low thinking, explicit SSE model transport; no Kimi or API-key fallback.
- `pnpm prototype:pi-multi-live`, Windows bundled ConPTY, pinned experimental
  browser xterm host, fixed 40-column by 8-row viewport.
- One retained in-memory Pi conversation, four deliberately entered prompts,
  one fixed read-only sample tool. No project files, arbitrary paths, shell
  execution, user extensions, or persisted Pi session were enabled.
- These calls consumed subscription allowance. No token/cost total was measured.
  Automatic local-fixture checks were absent/disabled on the live pages.

## Expected and observed

| Action | Expected | Observed |
| --- | --- | --- |
| Ask Pi to read the sample and return its main idea plus `STAGE3-ALPHA`. | The actual tool result appears and the round completes. | One displayed sample tool result; answer included the sample's meaning and the marker; Context 1 closed, round 1 completed. |
| Ask for the previous answer's marker without repeating it in the new prompt. | The same Pi conversation retains earlier context. | Answer was `STAGE3-ALPHA`; Context 2 closed, round 2 completed. |
| Ask for a numbered list beginning `STREAM-CANCEL`, with the one-shot cancel helper explicitly armed. | Cancellation occurs after nonempty mutable assistant content is observed; no false completion. | Partial `STREAM-CANCEL` remained with `[aborted] Request was aborted`; Context 3 closed, round 3 aborted, then ready for round 4. |
| Ask for the first answer's marker followed by `RESUMED`, without continuing the list. | Another prompt works after cancellation and still has the early context. | Answer contained `STAGE3-ALPHA RESUMED`; Context 4 closed, round 4 completed, then ready for round 5. |
| Search the old tool output, then end the idle session. | Old content remains searchable and cleanup finishes normally. | `Trial sample:` found; child exited 0; all four Contexts were closed before EOF; `[session ended by user]` appeared. |
| Search the cancellation label after exit. | Retained partial history remains searchable after the connection closes. | `Request was aborted` found. |

The helper was armed only for the third prompt. It clicked the ordinary cancel
control when the displayed report contained nonempty mutable assistant text;
it did not start a prompt or infer cancellation merely from a click. Browser
observations separately verified the aborted outcome and next ready state.

## Coverage

The four live prompts exercised tool use, retained conversation, assistant-stream
cancellation, and continuation. Tool-time cancellation and native
reading/selection/copy during subsequent output were checked with the local
deterministic provider in the [main record](README.md#verification).
