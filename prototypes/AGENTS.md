# Prototype guidance

## Overview

The `prototypes/` tree contains executable experiments that test protocol and
terminal-integration assumptions. A prototype supplies evidence; it does not
define the protocol by itself.

## Experiment records

Each prototype's `README.md` must:

- define the core question the experiment addresses and record what it proves,
  what it does not prove, its known limitations, and how to run it;
- clearly label temporary identifiers, encodings, private or unstable APIs,
  and other experimental fixtures, including their purpose and limitations;
  and
- link to the design or protocol documents whose assumptions it tests.

Do not present experimental fixtures as selected protocol behavior. When an
experiment confirms, refutes, or narrows a documented inference, update the
related documents and link to the supporting prototype or test.

## Verification

Tests should verify the claims recorded in each prototype's `README.md`. Run
the relevant commands from the repository root before submitting a change:

```sh
pnpm typecheck
pnpm test
```
