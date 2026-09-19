# Fixed content samples before application integration

Experimental evidence, not a complete Pi output corpus or Unicode support claim.
The [fixed corpus](../../prototypes/integration/xterm-protocol-endpoint/content-samples.ts)
contains Chinese explanation with literal fenced code, a code line containing
160 repeated characters, emoji/combining text including a ZWJ sequence, and
Chinese Tab/CRLF output. `text/plain` displays Markdown syntax literally;
this does not add Markdown rendering.

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

The Unicode checks assert stored Buffer text, **not font shaping, grapheme width,
emoji presentation, selection/copy, or search correctness** for those sequences.
Existing Chinese/Tab selection and search cases remain their own evidence. A
future Pi spike must not infer general emoji interaction support from this corpus.

## Remaining constraints

The pinned renderer has exact mapping only for its tested ASCII/basic-CJK range.
Unmapped text next to Tab is conservatively rejected with the existing
`resource_exhausted` preparation result. This is a renderer limitation, not a
claim that the protocol forbids that Unicode. Large Blocks and mixed capacity
layouts can likewise be rejected; partial-Block eviction is not implemented.

Keep these cases as a reproducible trial baseline. Actual Pi output, styled
ordinary traffic, more native control combinations, bidi text, shaping, and
other terminals need evidence from the later integration. This step identifies
known acceptance/rejection boundaries rather than silently claiming support.
