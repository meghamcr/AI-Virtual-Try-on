# Deployment and troubleshooting

## Local setup

Run commands from the repository root. `docker compose up -d --build` creates PostgreSQL on **55432**, Redis on 6379 and MinIO on 9000 (console 9001), bound only to loopback. Port 55432 avoids an existing PostgreSQL installation. If a port is occupied, change the matching Compose mapping and `.env`; do not stop unrelated services.

MinIO's community Docker Hub image was unavailable during implementation. `infra/minio.Dockerfile` builds official source tag `RELEASE.2025-10-15T17-29-55Z`. Its upstream is archived; this is a local examination dependency, not the recommended public storage service. First build downloads Go dependencies and takes longer than subsequent starts. `npm run db:setup` applies the committed migration and creates a private bucket without public policy. Docker volumes preserve data between restarts. `docker compose down` stops services without deleting volumes.

`npm run dev` runs API and worker through tsx and the frontend through Vite. For an actual extension test, rebuild and reload `apps/extension/dist` in Chrome after source changes. The Vite preview cannot access shopping tabs. Set the exact Chrome extension origin in `CORS_ORIGINS` and restart the API.

## Public backend

Do not publish the extension or provision paid services without explicit authorization. Deployment instructions below are for an operator to apply deliberately.

1. Use maintained managed PostgreSQL, Redis with persistence and `noeviction`, and private S3-compatible storage. Put DB/Redis on private networks.
2. Store secrets in the platform's secret manager. Set `NODE_ENV=production`, `PROVIDER=huggingface`, a valid `Hugging Face IDM-VTON_API_KEY`, non-default S3 credentials and an HTTPS S3 endpoint. Use a least-privilege bucket account, not an object-store root credential.
3. Run `npm ci`, `npm run db:generate`, `npm run db:migrate`, and `npm run build` in deployment. Provision/validate the private bucket separately or run `tsx scripts/storage-init.ts` with bucket creation privileges once.
4. Start `node dist/server/api/src/index.js` and `node dist/server/worker/src/index.js` as independently supervised processes. Include `node_modules` and Prisma's generated engine. Use a process supervisor or container orchestrator with graceful shutdown. The compiled server bundles keep dependencies external.
5. Expose the API only through an HTTPS reverse proxy; block direct public access to its HTTP port. Configure upload limits at least 12 MB, request timeouts over 30 seconds, and an accurate `TRUST_PROXY` hop count. Avoid logging Authorization, request bodies, image bytes or signed URLs.
6. Set `VITE_API_URL=https://api.your-domain.example` **before** rebuilding the extension. The build inserts only that API origin into host permissions and CSP. Set its extension origin in backend `CORS_ORIGINS`. Test CORS from the installed extension, not merely curl.
7. Check `GET /health` for liveness and `GET /ready` for dependencies, provider configuration and recent worker heartbeat. Readiness does not prove key validity or remaining credits; do the consented real-generation test.
8. Monitor failed jobs, uncertain submissions, worker heartbeat and oldest garbage-outbox age. Keep cleanup running through deletions and outages. Apply backup retention and storage lifecycle policies consistent with the user notice.

No public object URLs are necessary: person and garment inputs are sent directly to Hugging Face IDM-VTON. Do not configure local MinIO URLs as externally accessible provider inputs.

## Common failures

| Symptom                        | Diagnosis and action                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Cannot reach studio            | Start API; inspect `/health`; confirm build-time API URL and CORS origin                             |
| Readiness 503                  | Check PostgreSQL/Redis/bucket/worker; configure provider key; inspect booleans                       |
| Permission / cannot detect     | Open an HTTP(S) shopping page, click the toolbar icon there, then Detect                             |
| Images absent                  | Wait for page content; Detect again; choose Select on page; CSS/shadow-root images may not work      |
| `IMAGE_HTTP_403`, 429, timeout | Website/CDN restricts retrieval. Choose another accessible product image. Do not bypass restrictions |
| `UNSAFE_IMAGE_URL`             | URL resolves to a private/nonpublic address or uses unsafe scheme/credentials/port                   |
| `PROVIDER_AUTH`                | Wrong key/account access. Update backend secret and restart both services                            |
| `PROVIDER_RATE_LIMIT`          | Wait before an explicit new request; do not parallelize retries                                      |
| `GENERATION_REJECTED`          | Provider rejected the images; review framing, category and moderation suitability                    |
| `SUBMISSION_UNCERTAIN`         | A paid job may exist externally. Inspect provider history before resubmitting                        |
| Job stays queued               | Worker stopped, Redis unavailable or API enqueue failed. Reconciler dispatches durable DB jobs       |
| Photo replacement              | Existing active jobs are cancelled; choose the updated profile and start again                       |
| Deleted files still in bucket  | Worker/MinIO may be offline; deletion access is revoked immediately, byte cleanup is eventual        |

## Maintenance

`npm audit` was run after patching dependency advisories. Recheck before deployment. Overrides and exact resolved versions are recorded in the lockfile. UI and backend logs avoid personal media. The in-memory rate limiters suit this single-API assignment; deploy a shared limiter or gateway rate policy before horizontally scaling the API. Add email verification, password recovery, stronger account abuse controls and operational telemetry before opening public registration.
