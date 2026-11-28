# Gate 6C.2B.2 (F1) - rated supplier filter UI - 2026-11-28

**PASS: scoped frontend increment; F1B live acceptance remains OPEN.** Baseline 2f4a2bf94176f74abb87fb005fa4fa37337cbb58.

- Enable rated control in market/directory. Selected-state copy states rounded average >=4.5/5 and at least three counted reviews; search ordering unchanged, not a verification badge. Existing request paths preserve single trust selection, business/taxonomy/search scope and external suppression.
- Scoped empty state; 503 from evidence or resource exhaustion displays localized unavailable/retry rather than an empty or unfiltered result. No CSS changes.
- First FE 54/54 (six suites), build PASS. Review added market/directory outage and retry regressions and localized error; final FE 56/56, six suites (16.809s), strict CI build PASS (combined exit 0, 38.63s), main.b400a910.js. [Evidence](evidence/v49-gate6c-f1b2-20261128/summary.json).
- No backend changes or fresh backend/full regression. Threshold and limits remain provisional, live browser and multi-supplier load test next, no physical device, production guarantee or deployment. Original reference and original checkout unchanged.
