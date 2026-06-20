# ADR Guide

## Scope

This guide applies to architecture decision records under `docs/adr/`.

## Rules

1. Add an ADR for non-trivial durable decisions, trade-offs, and design
   patterns.
2. Use the lightweight ADR format in `docs/adr/README.md`.
3. Keep statuses explicit: Proposed, Accepted, Superseded, or Deprecated.
4. Update `docs/adr/README.md` when adding or renaming ADRs.
5. Include validation evidence and follow-ups for every accepted ADR.
6. Open decisions touching architecture, external integrations, the data model,
   the observability/metrics contract, security posture, or design-system
   direction as *Proposed* linked from the driving issue; move to *Accepted*
   only after review. Smaller reversible choices do not need an ADR.
7. When superseding an ADR, add `Supersedes NNNN` to the new ADR, set the old
   ADR's status to `Superseded by MMMM`, and update the index table in
   `docs/adr/README.md`. Never orphan a still-active decision: if the new ADR
   only covers part of the old one, carry the remaining active parts forward
   into the new ADR.
8. Link every Proposed or Accepted ADR from its driving GitHub issue. Reference
   relevant ADRs in the acceptance criteria of architecture-changing issues.
9. Update an ADR in place when its details change but its direction holds, noting
   the change; reserve supersede for when a later decision replaces it.
