# TryOn Studio

A Manifest V3 Chrome side-panel extension for image-conditioned virtual try-on. It detects products on shopping pages, reuses private personal photo profiles, and runs durable background jobs through an authenticated API. This is an **appearance preview**, not measurement, sizing, or physical-fit prediction.

## Quick start

Requirements: Node.js 22.12+, npm, Docker Desktop running, and Chrome 116+. The first infrastructure build compiles the pinned MinIO source release and can take several minutes.

```sh
npm ci
cp .env.example .env
# Edit .env: configure FASHN_API_KEY for real generation.
docker compose up -d --build
npm run db:generate
npm run db:setup
npm run build
npm run dev
```

`npm run dev` starts API `http://localhost:4000`, worker, and a UI development preview at `http://localhost:5173/sidepanel.html`. Shopping-page detection requires the installed extension, not the Vite preview.

For explicitly labeled local development without paid generation, set `PROVIDER=mock` in `.env` before starting both API and worker. Mock output is the original with a visible **DEMO — NO AI GENERATION** watermark. Mock mode is forbidden in production. Default `PROVIDER=fashn` never silently falls back to a mock.

## Install in Chrome

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**.
2. Select `apps/extension/dist` inside this repository.
3. Copy the displayed extension ID into `.env`: `CORS_ORIGINS=http://localhost:5173,chrome-extension://YOUR_ID`. Restart the API.
4. Pin TryOn Studio. Open a shopping page, click its toolbar icon, then **Open TryOn Studio**. That user gesture grants access to this tab.
5. Register with a password of at least 12 characters. Create a named profile and upload a full-body photo for dresses, or an upper/full-body photo for tops.
6. Click **Detect products**, select an item, image, category, and variant. Check that the image matches the variant. Review the consent and click **Try on this look**.
7. Reopen the panel to recover a running job. Use History to compare two looks, save, download, flag, or delete.

Build outputs: `apps/extension/dist/` (unpacked) and `dist/tryon-studio-extension.zip` (`npm run package`). All extension JavaScript is bundled locally; provider secrets remain on the server.

## Configuration

| Variable                                | Purpose                                                              |
| --------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                          | PostgreSQL connection, shared by API/worker/migrations               |
| `REDIS_URL`                             | Durable BullMQ Redis; AOF enabled in Compose                         |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | Private S3-compatible storage                                        |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`        | Backend-only storage credentials                                     |
| `PROVIDER`                              | `fashn` (default) or explicitly `mock` in development                |
| `FASHN_API_KEY`                         | Real FASHN API credential with available credits                     |
| `ENABLE_LIFESTYLE`                      | `true` enables the additional experimental, paid FASHN Edit stage    |
| `CORS_ORIGINS`                          | Exact comma-separated origins, including the unpacked extension ID   |
| `VITE_API_URL`                          | Build-time API URL; remote URLs must use HTTPS                       |
| `PORT`, `NODE_ENV`, `TRUST_PROXY`       | API listener, production validation, trusted reverse-proxy hop count |

Images are decoded, oriented, stripped of metadata and normalized before private storage. Inputs go to FASHN as data URIs through authenticated backend requests, so local MinIO does **not** need to be publicly reachable. No shopping cookies or authentication headers are forwarded.

## Commands

```sh
npm run typecheck
npm run lint
npm test                         # Unit/contract tests; no service dependencies
INTEGRATION=1 npm run test:integration # Real local DB/storage, mocked network/provider
npm run build
npm run package
npm run check                    # All ordinary checks + build + ZIP
npm run test:browser              # Installed-extension smoke test, synthetic photos, mock API
npm run test:live                 # Live extraction audit, no AI calls
```

Before integration checks run `npm run db:setup`. Before browser tests run `npx playwright install chromium`. Browser tests use an isolated temporary Chromium profile and clean up their synthetic account. They do not use an existing Chrome profile.

## Scope and evidence

Implemented provider categories: tops, shirts, jackets, dresses and pants. Tops and dresses are the initial demonstration targets. Shoes, jewellery, necklaces and accessories are shown as unavailable until an appropriate provider adapter is implemented. Profiles can hold their reference slots without falsely claiming those categories are supported. Multi-product outfits and wardrobe collections are not implemented.

**Real AI success is credential/photo-dependent and must not be inferred from mock tests.** See [testing and compatibility](docs/testing.md) for actual observations, [provider](docs/provider.md) for verified API contracts, and [demonstration](docs/demonstration.md) for the five-minute recording checklist and unfilled real-output evaluation table.

- [Architecture and lifecycle](docs/architecture.md)
- [API reference](docs/api.md)
- [Privacy and deletion](docs/privacy.md)
- [Deployment and troubleshooting](docs/deployment.md)
- [Provider research](docs/provider.md)

The repository contains no seeded personal photographs, provider keys, or fabricated AI outputs. Synthetic test images are generated at test time.
