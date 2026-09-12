# Example guidance

Examples teach application or terminal integration; they do not define protocol semantics.
Keep runnable application code separate from preparation and test-host tooling.
Use the built SDK in TUI client examples intended for external consumers, not
prototype internals. Terminal examples that still depend on experimental
adapters must identify that dependency rather than imply a standalone SDK.
Document commands, expected behavior, application-owned fallback where relevant,
cleanup, and the limits of verification in each example's README.

Run the relevant root checks and the documented example paths. Keep claims
specific to those checks; do not imply support in unmodified terminals.
