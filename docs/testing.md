# Verification and website compatibility

Test date: **2026-09-27**, local macOS arm64, Node 22.23.2, isolated Playwright Chromium 153.0.8010.12. Evidence is under [`docs/evidence`](evidence). Nothing in this report is a claim of successful real AI generation.

## Automated checks

| Check                             | Observed result                                | Scope                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript                        | Passed                                         | Extension, API, worker, shared code, scripts and tests                                                                                                                               |
| ESLint                            | Passed                                         | Source and scripts                                                                                                                                                                   |
| Vitest unit/contract              | 35 passed                                      | Extraction, schemas, category readiness, state rules, safe fetch, image decoding, provider request/error contracts                                                                   |
| Vitest integration                | 8 passed with `INTEGRATION=1`                  | Actual PostgreSQL, Redis and MinIO; synthetic images and mocked provider/network                                                                                                     |
| Prisma                            | Generated client and applied initial migration | PostgreSQL on localhost:55432                                                                                                                                                        |
| Build                             | Passed                                         | Bundled API/worker and locally bundled MV3 extension                                                                                                                                 |
| Packaging                         | ZIP produced                                   | `dist/tryon-studio-extension.zip`                                                                                                                                                    |
| Dependency audit                  | 0 advisories after updates                     | npm audit snapshot, not a security guarantee                                                                                                                                         |
| Installed extension browser smoke | Passed                                         | Registration, profile upload, fixture detection, actual queue/worker, public garment retrieval, watermarked mock output, comparison, save, feedback, download, recovery and deletion |

Ordinary `npm test` deliberately skips the 8 service-dependent tests. They were run separately and passed. `tests/integration.test.ts` calls the processor directly to control races and restart conditions; the browser smoke additionally exercises the actual BullMQ worker process. Live garment retrieval in the browser smoke depends on the public test image remaining accessible.

The final browser rerun also passed revoked-session recovery and found no script CSP violations or extension page runtime errors. The ZIP archive passed `unzip -t`. A native toolbar check was retried after restarting the desktop app: Chrome showed TryOn Studio in its Extensions menu, but accessibility actions then lost their targets as the browser state changed. Popup opening and docked-panel behavior were therefore not verified by that attempt.

The browser smoke loads the **unmodified compiled extension** in a fresh Chromium profile. Its local product fixture is served on the already-authorized API origin, allowing real `chrome.scripting` injection without widening production permissions. It opens the extension's sidepanel document as a tab to drive its UI. Native toolbar popup/side-panel docking and an actual shopping-tab `activeTab` user gesture remain **manual verification items**. No claim is made that test-harness page evaluation verifies those native surfaces.

Tests cover JSON-LD arrays/graphs, microdata, listing cards, lazy/relative URLs, candidate deduplication, variant association, recommended-product separation, empty quick-add controls, upload metadata removal, byte/dimension limits, private address/DNS/redirect rejection, Node's two DNS callback forms, ownership, idempotency, explicit consent, error normalization, restarting a saved prediction without resubmission, uncertain submissions, deleting while processing, photo replacement cancellation, actual garbage-object removal, and session revocation.

## Live browsing observations

The extension was loaded while testing, and the **production extraction module** was executed against the live page DOM by the browser harness. Selected images were retrieved through the same safe backend retrieval/decoder used by the worker. These are real-browser extraction/retrieval checks, distinct from the fixture tests and from actual AI generation.

| Website and exact tested URL                                                                      | Page/category     | Observed extraction                                                                     | Image retrieval             | Limitation                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tentree Valley Dress](https://www.tentree.com/products/valley-dress-jasper)                      | Detail / dress    | Main item first, 20 image candidates, 5 controls; 4 separate recommendation cards       | Success, decoded 960 × 1200 | Main item from page metadata (confidence 0.4); variant controls require user confirmation. Region popup appeared.                                     |
| [ASKET white T-shirt](https://www.asket.com/en-us/mens-t-shirt-white)                             | Detail / top      | Main metadata item, JSON-LD color alternatives and card recommendations; 11 items total | Success, decoded 1200 × 630 | First image is a wide social-preview crop; choose a suitable alternate garment view. Main gallery contains heuristic candidates and must be reviewed. |
| [Everlane day-to-night dresses](https://www.everlane.com/collections/womens-day-to-night-dresses) | Listing / dresses | 17 separate product cards with individual URLs/images                                   | Success, decoded 700 × 875  | Optional newsletter iframe had to be dismissed using “No Thanks”; no reliable variant controls on listing.                                            |
| [UNIQLO women's T-shirts](https://www.uniqlo.com/us/en/women/tops/t-shirts?colorDisplayCode=09)   | Listing / tops    | HTTP 403 “Access Denied”                                                                | Not attempted               | Access restriction respected; this website is not verified compatible in this environment.                                                            |

Recorded timestamps, titles, item counts, retrieval results and exact image URLs are in [`live-audit.json`](evidence/live-audit.json). Screenshots are actual browser captures. They are not generated images and do not demonstrate AI fidelity. No account login, purchase, cookie forwarding or access-challenge bypass was performed on shopping sites.

Live tests exposed and led to fixes for: Node 22 DNS callback shape, metadata detail pages being eclipsed by recommendations, and empty quick-add controls suppressing semantic listing detection. Store modals can intentionally hide catalog content from accessibility/visibility queries; dismiss them normally or run Detect after closing them.

## Real generation and remaining checks

**Not performed:** funded Hugging Face IDM-VTON generation using a consented person photo, identity/product fidelity assessment, lifestyle output evaluation, measured real model latency, and a finished real-AI examination recording. No provider credential or suitable reference photograph was supplied. Provider schema tests use mocked HTTP responses and are not evidence that an account has access, credits, or successful outputs.

Native Chrome checks to perform before the examination:

- Load the build, click its toolbar popup on a shopping tab, and open the docked side panel.
- Switch tabs, refresh, navigate a single-page storefront, close/reopen during a real job, and renew page permission through the toolbar when needed.
- Select an alternate product image and correct category; verify color/variant manually.
- Generate tops and dresses on at least two accessible sites with the same profile.
- Inspect and record real outputs using the [evaluation table](demonstration.md); test optional lifestyle separately.

Production HTTPS deployment, multi-instance API rate limiting, browser-store publication, and provider-side deletion handling are operator tasks documented in [deployment](deployment.md) and [privacy](privacy.md). No paid infrastructure or store publication was performed.
