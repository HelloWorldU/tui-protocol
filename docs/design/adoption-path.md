# Adoption path and the cold-start constraint

Working note, 2026-10-11; ladder revised 2026-10-26. This note records what broad adoption of the
protocol would mean and the realistic path toward it. It is a strategy note,
not a protocol document.

## What broad adoption means

- **Receiver side**: multiple terminal emulators implement the protocol
  receiver — negotiation, the Block model, mutable history, region
  ownership, and preserved native interaction.
- **Sender side**: applications emit Block Operations when the terminal
  confirms support and keep their existing rendering path otherwise.
- On both sides the feature must be **optional and degrade gracefully**. No
  vendor adopts a large mandatory change for an unproven protocol; the ask
  must stay small and reviewable.

## The cold-start loop

Each side prices the other's installed base: applications ask which
terminals support the protocol, and terminals ask which applications use
it. Today both sides have exactly one implementation, both from this
project. The loop breaks through independent second implementations, not
through advocacy.

## The realistic ladder (ordered)

1. **Prove the experience delta with a real application.** Done 2026-10-03:
   the [Pi stock-UI trial](../../prototypes/integration/pi-stock-ui/README.md)
   runs Pi's stock interactive UI with a protocol-owned transcript, with all
   four browser checks passing.
2. **A runnable, demonstrable terminal.** Terminals are made by their
   vendors, not by this project; what the project can do is make the case
   self-evident. A standalone demo terminal that runs the real Pi beside an
   ordinary shell, a side-by-side comparison with an ordinary terminal, and a
   vendor kit (protocol summary, embeddable reference implementation,
   integration guide, conformance checks) let a vendor judge the value
   directly. Revised 2026-10-26 from "build a second terminal-side
   implementation ourselves": a vendor's integration is the independent
   second implementation that breaks the loop.
3. **A second application-side integration** — another agent TUI, or Pi
   through an official seam if upstream interest materializes — proving the
   sender side is not captive either. Vendors will ask which applications use
   the protocol; until then the answer is Pi, unmodified, with fallback in
   ordinary terminals.
4. **Vendor and community conversations**, only then, with working, dated,
   reproducible evidence rather than proposals.

## How comparable mechanisms spread

Recorded with primary sources in [prior art](../prior-art.md):

- OSC 133 shell integration spread because it is optional and degrades
  gracefully; terminals and shells adopted incrementally.
- The Kitty keyboard protocol spread after one influential terminal shipped
  it and applications wanted it.
- The pattern is a small optional feature plus one respected adopter on
  each side, then organic spread. This protocol is larger; the bounded
  baseline (`text/plain`, five Operations, one carrier) exists partly to
  keep the receiver-side ask reviewable.

## What this project does not control

Vendor priorities and roadmaps. Pi chose application-owned fullscreen;
Kimi reverted in-place patches; Codex retired a transcript-owned viewport
(see [prior art](../prior-art.md)). The protocol's role is to make the third
path demonstrably available, not to be chosen by anyone in particular.

Related: [prior art](../prior-art.md),
[Pi rendering architecture](pi-rendering-architecture.md),
[Pi stock-UI trial design](pi-stock-ui-trial.md),
[validation plan](next-stage-validation.md).
