# Gate 6C.3A.4 — direct conversation integrated browser acceptance PASS

Exact source commit: `128b17a307d844d9e1d2c71848b28b54a9bd7ba3`, branch `feat/v49-ui-integration`.

## Actual Chrome journey

Headless Chrome 158 at a 390×844 mobile viewport, using the production-built frontend from the exact source commit, a local Express API and a disposable in-memory MongoDB database. Five end-to-end steps passed:

1. Buyer signs in and opens the actual product detail page.
2. Buyer starts a direct conversation from “مراسلة المورد”; the server returns HTTP 201 and the message is confirmed in the conversation history.
3. Supplier signs in, opens the incoming direct-message notification, sees the buyer's message, and the exact notification is marked read.
4. Supplier replies from the same conversation; the server returns HTTP 201.
5. Buyer opens the supplier-reply notification, sees the reply, and the exact notification is marked read.

Three 390×844 screenshots are included. Browser recorded zero uncaught runtime exceptions and no horizontal overflow in the captured views. Actual API response sequence and browser steps are in [browser results](evidence/v49-gate6c-f2a4-20261128/browser-results.json).

## HTTP and database acceptance

10/10 additional assertions passed against the live local HTTP server and isolated MongoDB:

- Both recipient feeds contain only their own incoming direct-message notice; both read timestamps persist in MongoDB.
- Notification DTOs do not contain message text; `Cache-Control: private, no-store` and `Vary: Authorization` are present.
- A different buyer and a different supplier cannot read the conversation (404); staff cannot read it (403), and staff feeds do not expose direct messages.
- A foreign buyer cannot mark the recipient's notification read (404).
- Exact replay of the buyer's original message returns 200/replayed without a duplicate.
- Final database state: one conversation, two messages, two distinct embedded notice IDs, zero RFQs, zero trade confirmations and zero separate direct-message Notification documents.

Only a disposable `MongoMemoryServer` database named `jomla_f2a4` and five synthetic accounts were used. The original MongoDB service, original database, original checkout and production services were not accessed or changed. [HTTP/DB evidence](evidence/v49-gate6c-f2a4-20261128/http-results.json).

## Regression and build evidence

- Backend: fresh 43/43 across 4 suites (direct conversations, RFQ message delivery, reports/roles, security).
- Frontend: 107/107 across 5 suites from the same exact source content and commit (supplier dashboard, direct conversation, buyer dashboard, product detail, language).
- Strict CI production build: PASS; JavaScript `main.dfe10100.js`, CSS `main.ecb125ac.css`.
- [Test results](evidence/v49-gate6c-f2a4-20261128/test-results.json) · [Acceptance summary](evidence/v49-gate6c-f2a4-20261128/summary.json).

## Boundaries and remaining work

Gate 6C.3A is locally accepted. This does not establish push/email notifications, WebSocket delivery, background/mobile notification delivery, production load/capacity, physical-device acceptance or production deployment. The direct inbox remains an authenticated, pull/refresh-based experience. No real customer data or commercial transaction was used.

Next: Gate 6C.3B.1 — inspect and implement a separately bounded product-video upload pipeline, beginning with codec/container, size/duration, authorization, storage, cleanup and delivery constraints. Gate 6C overall remains OPEN; video, final cross-feature regression and production/device acceptance are not closed.
