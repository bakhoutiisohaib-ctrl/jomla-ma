# Home visual batch — 5–6 November 2026

Scope: homepage introduction, supplier entry, pictured category selectors. Existing product cards, shared navigation, authentication and RFQ behavior are unchanged.

`moroccan-trade-illustration.png` was generated with the built-in image generation tool. It is a fictional brand illustration, not a supplier photo or proof of inventory. The rendered website labels it as an illustrative scene. The original remains preserved. A 960×640 WebP derivative (119,646 bytes) is stored at `frontend/public/atlas-trade-home.webp`; resizing and compression were performed with the existing Sharp dependency on the isolated server, without installing packages.

The three category SVGs in `frontend/public/atlas-category-*.svg` are unchanged copies of this project's own `design/phase-d0/assets/{ceramics,basket,textile}.svg`. Category options still come from the actual search results. Known categories use these public illustrations to avoid periodic blanking during protected media revalidation. Unknown categories use the existing ProtectedImage authorization flow and a package icon fallback. No supplier media is copied into public assets.

## Exact generation prompt

Use case: ads-marketing. Create one refined photographic-style illustrative hero asset for a Moroccan wholesale marketplace website, landscape 3:2 composition. A warm sandstone Moroccan courtyard arch opens toward subtle Marrakech-inspired terracotta architecture and palms. Foreground grouped wholesale goods: tasteful olive green and cream glazed ceramic mugs and bowls, stacked folded natural linen textiles, a woven straw basket, and a few plain kraft shipping cartons. Beautiful tactile detail, warm natural morning light, restrained premium art direction, muted olive / sand / terracotta palette, realistic materials, uncluttered balanced composition. The objects and arch should read clearly at a small crop. This is an illustrative brand scene, not evidence of a real supplier or real inventory. No people, no text, no labels, no watermark, no logos, no UI, no buttons, no flags. Fill the frame with the scene; website copy is outside the image.

## Review evidence

Windows: `C:/JomlaLocal/Review-20261029/visual-home-20261105/`.
Private server: `/home/jomlaops/jomla-dev-20261105/evidence/home-20261105/`.
Final build: `/home/jomlaops/jomla-dev-20261105/runtime/build-home-review-20261106`.
Original accepted build: `/home/jomlaops/jomla-dev-20261105/runtime/build-final` (preserved).
