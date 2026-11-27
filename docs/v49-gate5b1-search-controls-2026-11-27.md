# Gate 5B.1 — V4.9 search condition removal and alternative counts — 2026-11-27

**Scoped backend acceptance PASS. Gate 5 remains OPEN.** Baseline 3f2838ef519f3594904569363e1c5d447fe6c79b. Original V4.9 reference SHA256 927901518b55674939608ca9b08802eff0a1f169da3012ba716d1c33f21cf903 rechecked; inspected actual j47Remove, j47Labels and j47SearchPanel behavior. No frontend or visual changes in this slice.

## Implementation
- Opt-in v49-1 search accepts explicit intentRemovals, validated against recognized conditions of the original phrase. Reject unknown, duplicate, malformed, absent or ambiguous branch keys. Server reparses original text, not client-supplied predicates or translated labels. Return original phrase, confirmed removed keys and available removable keys.
- Remove the chosen condition only; preserve other extracted conditions and explicit catalog filters. Reset derived strict bounds, unit/currency only where their associated conditions no longer remain.
- When explicitly requested via includeAlternatives and strict results total zero, count the result of relaxing one supported commercial condition using the same catalog pipeline, before pagination, including canonical public visibility and ownership. Counts only, never automatically return relaxed products. Maximum eight candidate condition types, serial execution, 5s aggregation limit per count. Alternative counts reflect live separate database reads, not a stable snapshot.
- Delivery is unknown and blocks matches until explicitly removed; only goods price can then be confirmed. Other invalid/ambiguous parses are not relaxed. Compound OR removal remains a whole-search clear/edit UI action, not individual branch mutation. No remote provider, invented inventory or external discovery.

## Verification
- Three new actual HTTP/Mongo tests for removal, cumulative removals, independent alternative counts, delivery handling, hidden products, manual filters, invalid/malformed keys and unsupported scopes.
- Final isolated backend: **88/88, 5/5 suites, 22.666s, exit 0** (products, publicPages, businessTypes, visualIndex, externalDiscovery). Node syntax checks for four changed JS files and git diff --check PASS.
- Reviewed actual source diff; no dependency changes. No new frontend, build or browser run for this backend-only contract checkpoint.

## Remaining
Activate structured request in existing V4.9 market shell; bind response to current query/filters and request generation, render reference summary/condition chips and explicit alternatives, preserve honest price context and multilingual labels. Continue outstanding grammar edges and visual search/comparison behavior. Alternative counts may increase latency; no production load certification. No complete visual/functional V4.9 parity claim. Original repository checkout, original database, reference file, default branch and deployment unchanged.
