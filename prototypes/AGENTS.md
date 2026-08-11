# Prototype guidance

## Overview

The `prototypes/` tree contains executable experiments that test protocol and
terminal-integration assumptions. A prototype supplies evidence; it does not
define the protocol by itself.

## Experiment categories

- Unit prototypes isolate one protocol or implementation mechanism and test
  its behavior independently.
- Integration prototypes compose two or more prototype layers and test whether
  their interfaces and documented semantics work together.

Both categories remain experimental evidence. Their classification describes
the boundary being tested, not the size or maturity of the implementation.

## Experiment records

Each prototype's `README.md` must:

- define the core question the experiment addresses and record what it proves,
  what it does not prove, its known limitations, and how to run it;
- clearly label temporary identifiers, encodings, private or unstable APIs,
  and other experimental fixtures, including their purpose and limitations;
  and
- for a unit prototype, link to the design or protocol documents whose
  assumptions it tests; for an integration prototype, link to the component
  prototype records it composes and any document whose cross-layer requirement
  it directly tests.

Do not present experimental fixtures as selected protocol behavior. When an
experiment confirms, refutes, or narrows a documented inference, update the
related documents and link to the supporting prototype or test.

## Verification

Tests should verify the claims recorded in each prototype's `README.md`. Keep
claims precise and do not overstate what the evidence proves. Write each test
name as a direct, observable scenario and outcome that a human can understand
without reading the implementation. Do not substitute an abstract summary for
the concrete behavior being tested.

Run the relevant commands from the repository root before submitting a change:

```sh
pnpm typecheck
pnpm test
```
