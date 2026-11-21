# Jomla.ma — D0 standalone design studies

These files are review prototypes, not application code. They do not import App.js, modify shared CSS, contact the API, read a database, upload files, persist form data, or implement payment/shipping. All names, prices, counts, messages and illustrations are synthetic.

Open [index.html](C:/Users/hp/jomla-ma/design/phase-d0/index.html) locally to compare Atlas, Medina and Horizon. Choose a page, Arabic/French and desktop/phone. Open `mockup.html` directly with `?theme=atlas&page=product&lang=ar` for an independent view. Files also work without an HTTP server; copy-to-clipboard availability depends on browser permissions.

Optional local preview from the project root:

```powershell
node design/phase-d0/serve.cjs
```

Then visit [the local design explorer](http://127.0.0.1:5080/). The server binds loopback, serves only this design directory, D0 evidence and the D0 report, accepts GET/HEAD, and sets `connect-src 'none'`. Stop it with Ctrl+C. It never starts the application or MongoDB. Port 5060 was rejected as unsafe by the browser during initial setup; 5080 is the working preview port.

Primary views: `home`, `product`, `store`, `supplier`. Additional views: `editor`, `buyer`, `messages`, `compare`. Each accepts `theme=atlas|medina|horizon` and `lang=ar|fr`. The four primary views have screenshots for every combination; additional review screenshots focus on Atlas.

Interactions intentionally remain local: filtering four sample products, comparing selected cards, displaying a sample RFQ form, stepping through a product form, switching a sample gallery and previewing a message. Save/publish/send actions explicitly disclose that nothing is saved or transmitted. Product links use one representative detail template, not a complete multi-product catalog. Comparison opens a fixed sample table, not a persisted list of selected items.

Fonts in the screenshots are system fallbacks. Suggested brand fonts are documented in `design-tokens.json`, not bundled. All five SVG illustrations are original code-made placeholders for this design study, not supplier photographs or evidence of merchandise, quality or origin. The monogram is a placeholder identity, not a final logo.

Current application behavior was reviewed from source plus saved synthetic C2/B/pilot evidence. No new functional regression run or production build is claimed for D0, because no application source was changed. Protected source hashes and prototype browser results are in `reports/phase-d0-evidence/`. This is a heuristic design review, not research with actual merchants or an accessibility certification.

Decision and implementation order: [phase-d0-premium-design-exploration.md](C:/Users/hp/jomla-ma/reports/phase-d0-premium-design-exploration.md). No implementation starts until the owner chooses and approves a direction.
