# Prototype guidance

## Overview

The `prototypes/` tree contains executable experiments that test protocol and
terminal-integration assumptions and provide evidence for protocol design.

## Experiment categories

- Unit prototypes isolate one protocol or implementation mechanism and test
  its behavior independently.
- Integration prototypes compose two or more prototype layers and test whether
  their interfaces and documented semantics work together.

## Experiment records

Keep writing focused on the subject. Avoid repetitive disclaimers.

Each prototype's `README.md` must:

- organize the account around the experiment's core question and ground its
  conclusions in evidence;
- clearly label temporary identifiers, encodings, private or unstable APIs,
  and other experimental fixtures, including their purpose and limitations;
  and
- for a unit prototype, link to the design or protocol documents whose
  assumptions it tests; for an integration prototype, link to the component
  prototype records it composes and any document whose cross-layer requirement
  it directly tests.

Describe experimental choices in their local context; adopting them as protocol
behavior requires an explicit update to the protocol documents. When an
experiment confirms, refutes, or narrows a documented inference, update the
related documents and link to the supporting prototype or test.

## Verification

Tests should verify the claims recorded in each prototype's `README.md`. Keep
claims precise and within the scope of the evidence. Write each test
name as a direct, observable scenario and outcome that a human can understand
without reading the implementation.

Run the relevant commands from the repository root before submitting a change:

```sh
pnpm typecheck
pnpm test
```
