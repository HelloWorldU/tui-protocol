# Documentation

This directory is the authoritative index for project documentation. The
repository README is a short introduction; design reasoning and research live
here.

## Current documents

| Document | Kind | Status |
|---|---|---|
| [RFC 0001: Mutable Terminal History and Reading Anchors](rfcs/0001-mutable-terminal-history-and-reading-anchors.md) | Requirements RFC | Draft |
| [Operation semantics](protocol/operations.md) | Protocol draft | Draft |
| [Capability negotiation](protocol/capabilities.md) | Protocol draft | Draft |
| [Wire format requirements](protocol/wire-requirements.md) | Protocol draft | Draft |
| [Logical wire message model](protocol/wire-format.md) | Protocol draft | Draft |
| [Concrete message schemas](protocol/message-schemas.md) | Protocol draft | Draft |
| [Error codes](protocol/error-codes.md) | Protocol draft | Draft |
| [JSON serialization](protocol/serialization.md) | Protocol draft | Draft |
| [OSC carrier and framing](protocol/framing.md) | Protocol draft | Draft |
| [Content representation](protocol/content-representation.md) | Protocol draft | Draft |
| [Plain text content](protocol/plain-text.md) | Protocol draft | Draft |
| [Protocol Context semantics](protocol/contexts.md) | Protocol draft | Draft |
| [Terminal-native behavior](protocol/terminal-native-behavior.md) | Protocol draft | Draft |
| [First prototype design notes](design/first-prototype.md) | Design note | Working note |
| [Next-stage validation plan](design/next-stage-validation.md) | Engineering assessment and priorities | Working plan |
| [Block model prototype](../prototypes/block-model/README.md) | Executable prototype | Experimental |
| [TypeScript TUI SDK](../sdk/README.md) | Application-facing API | Experimental; local JavaScript build, unpublished |
| [Streaming text example](../examples/streaming-text/README.md) | SDK application example | Experimental; built JavaScript and application-owned fallback |
| [Terminal host example](../examples/terminal-host/README.md) | Terminal integration example | Experimental; depends on prototype xterm adapter |
| [Multi-round application example](../examples/multi-round/README.md) | Interactive SDK application example | Experimental; three simulated rounds through bundled ConPTY |
| [Ingress pressure experiment](../prototypes/integration/ingress-pressure/README.md) | Integration measurement | Experimental; in-process backlog under a controlled render stall |
| [PTY pressure experiment](../prototypes/integration/pty-pressure/README.md) | Transport integration measurement | Experimental; browser byte credits and bundled-ConPTY pause/resume |
| [Producer-side ConPTY waiting](../prototypes/integration/pty-pressure/upstream.md) | Transport isolation measurement | Experimental; normal versus paused reads with independent producer timing |
| [Browser hold and producer waiting](../prototypes/integration/pty-pressure/composed.md) | Transport integration measurement | Experimental; larger browser workload with overlapping producer write delay |
| [Terminal protocol module](../terminal/README.md) | Terminal-facing execution | Experimental; local JavaScript build, unpublished |
| [Terminal protocol endpoint](../prototypes/integration/protocol-endpoint/README.md) | Experiment record | Implementation and tests moved to terminal/ |
| [PTY transport probe](../prototypes/integration/pty-transport/README.md) | Transport integration probe | Experimental; tested system/bundled ConPTY outcomes recorded |
| [Real PTY demonstration](../prototypes/integration/pty-demo/README.md) | Process-to-browser integration prototype | Experimental; fixed Windows bundled-ConPTY scenario |
| [xterm protocol endpoint](../prototypes/integration/xterm-protocol-endpoint/README.md) | Integration prototype | Experimental |
| [xterm browser protocol endpoint](../prototypes/integration/xterm-browser-protocol-endpoint/README.md) | Browser integration prototype | Experimental |
| [xterm browser selection and copy](../prototypes/integration/xterm-browser-selection/README.md) | Browser integration prototype | Experimental |
| [xterm browser search](../prototypes/integration/xterm-browser-search/README.md) | Browser integration prototype | Experimental |
| [xterm browser content metadata](../prototypes/integration/xterm-browser-metadata/README.md) | Browser integration prototype | Experimental |
| [xterm browser active input state](../prototypes/integration/xterm-browser-input-state/README.md) | Browser integration prototype | Experimental |
| [Protocol session prototype](../prototypes/protocol-session/README.md) | Experiment record | Implementation and tests moved to terminal/ |
| [Shared TypeScript protocol code](../protocol/README.md) | Shared implementation | Experimental; included in SDK build, unpublished |
| [xterm-headless OSC spike](../prototypes/xterm-headless/README.md) | Feasibility spike | Experimental |
| [Prior art and project evidence](prior-art.md) | Research note | Living document |
| [RFC process](rfcs/README.md) | Project policy | Active |

RFC 0001 is the current foundation of the project. It defines the problem,
project goals, initial responsibility boundaries, and the minimal Block and
Operation model. Detailed agreed semantics are consolidated under
`docs/protocol/` while they remain drafts.

## Repository layout

The three reusable TypeScript modules are private pnpm workspace packages:
`@tui-protocol/protocol`, `@tui-protocol/sdk`, and `@tui-protocol/terminal`.
Run `pnpm install` at the root before using source commands. Cross-module
imports use those public entries; local imports stay relative. Source entries
resolve to TypeScript, while the SDK and terminal build commands produce
self-contained JavaScript distributions. These names do not imply publication.

Only directories with real content are created. The intended layout is:

```text
docs/
  README.md       Documentation index
  design/         Working design notes for experiments
  prior-art.md    Verified related work and project evidence
  protocol/       Draft consolidated protocol semantics
  rfcs/           Numbered design proposals and decisions

spec/             Future normative protocol specification
prototypes/       Executable semantic and implementation experiments
tests/            Future black-box scenarios and conformance fixtures
```

`prototypes/` contains semantic models, xterm.js integration experiments, and
retained experiment records. Shared codec and terminal execution code now live
in `protocol/` and `terminal/`. The `spec/` and `tests/` directories should be added
only when the project has a normative specification or reusable conformance
fixtures to place in them.

## Document authority

Documents have different roles:

1. An accepted specification under `spec/` will define normative protocol
   behavior.
2. Drafts under `docs/protocol/` consolidate currently agreed semantics but
   remain non-normative.
3. RFCs record why a design was proposed, accepted, rejected, or replaced.
4. Research notes summarize evidence and may evolve as new sources appear.
5. The root README is informative and must point to the deeper documents
   rather than duplicate them.

Until a specification exists, RFC 0001 is the primary statement of the
project's motivation and goals. Its Draft status means that its contents can
still change.
