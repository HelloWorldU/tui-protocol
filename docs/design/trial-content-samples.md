# Fixed content samples before application integration

This experiment checks how the xterm integration stores and reflows a fixed
set of text samples before application integration.
The [fixed corpus](../../prototypes/integration/xterm-protocol-endpoint/content-samples.ts)
contains Chinese explanation with literal fenced code, a code line containing
160 repeated characters, emoji/combining text including a ZWJ sequence, and
Chinese Tab/CRLF output. `text/plain` displays Markdown syntax literally.

## Results

Seven [Node checks](../../prototypes/integration/xterm-protocol-endpoint/content-samples.test.ts)
test native Buffer text and Session content after Append/Update, plus safe
rejection of emoji, combining text, and a ZWJ sequence beside Tab. Those three
rejections preserve native rows, logical content, and the previous content-state
ID so a later supported Extend can succeed.

Four [browser checks](../../prototypes/integration/xterm-browser-protocol-endpoint/scenarios/content-samples.ts)
test the positive samples through Append, a 40–20–40 column round trip, and
Update. The native Buffer text remained equal to the explicitly expected text.
They ran with the existing browser endpoint suite: 73 scenarios passed locally.

For these Unicode samples, assertions inspect stored Buffer text. Font shaping,
grapheme width, emoji presentation, selection/copy, and search need separate
checks. Existing Chinese/Tab interaction cases are linked from the
[plain-text evidence](../protocol/plain-text.md#experimental-evidence).

## Remaining constraints

The pinned renderer has exact mapping only for its tested ASCII/basic-CJK range.
Unmapped text next to Tab is conservatively rejected with the existing
`resource_exhausted` preparation result. This renderer restriction applies to
otherwise valid protocol text. Large Blocks and mixed capacity layouts can
likewise be rejected; partial-Block eviction is not implemented.

The corpus provides a reproducible acceptance/rejection baseline. Further
integration work needs samples from actual Pi output, styled ordinary traffic,
more native control combinations, bidi text, shaping, and other terminals.
