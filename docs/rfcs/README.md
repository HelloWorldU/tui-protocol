# RFC process

RFCs are numbered design documents for changes that affect the project's
architecture, semantics, compatibility, or security model. They are decision
records, not automatically standards.

## Statuses

- **Draft**: under active investigation and open to substantial change.
- **Accepted**: the project intends to implement the design.
- **Rejected**: considered but not selected.
- **Superseded**: replaced by a later RFC.

Changing an RFC's status is an explicit repository change. Once an RFC is
Accepted, substantial semantic changes should normally be proposed in a new
RFC so that the original decision remains understandable.

## File names

RFCs use a four-digit number followed by a descriptive slug:

```text
0001-mutable-terminal-history-and-reading-anchors.md
```

Numbers identify the discussion; they do not imply protocol versions.

## Expected contents

A protocol RFC should normally state:

- the problem and motivation;
- terminology and ownership boundaries;
- goals and non-goals;
- observable requirements and failure behavior;
- compatibility and fallback expectations;
- security considerations;
- alternatives and prior art;
- unresolved questions;
- evidence required before acceptance.

A Draft RFC may deliberately leave encoding and implementation details open
when those choices are not needed to validate the underlying semantics.

## Index

| RFC | Title | Status |
|---|---|---|
| [0001](0001-mutable-terminal-history-and-reading-anchors.md) | Mutable Terminal History and Reading Anchors | Draft |
