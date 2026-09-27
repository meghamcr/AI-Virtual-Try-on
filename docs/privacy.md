# Privacy, consent, and deletion

Personal photographs and generated results are sensitive. TryOn Studio stores them in a private S3-compatible bucket, with access mediated by an authenticated API. SQL stores object keys and metadata. There are no public bucket policies or personal-image URLs in extension storage. The extension stores its opaque login token and product draft in trusted extension-local storage; per-tab product metadata is ephemeral session storage. Logout/account deletion clears extension storage.

The selected personal image and downloaded garment are sent as base64 data through the backend to Hugging Face IDM-VTON only after the user checks generation consent. Extra profile references are not sent. The app never sends shopping cookies, session tokens, or page HTML to the provider. Original setting uses the try-on model; optional lifestyle processing sends its output for a separate edit. Product titles/descriptions are displayed with React text escaping and never inserted into model instructions.

We do not use photographs for training. Provider terms and account settings still apply: read the [Hugging Face IDM-VTON retention policy](https://docs.fashn.ai/api-overview/data-retention-privacy) and [provider integration notes](provider.md). Do not promise immediate erasure from provider systems or infrastructure backups. The operator must disclose its storage region and backup-retention policy before a public deployment.

## Deletion behavior

- **Remove a photo:** revokes the original photo endpoint, cancels affected active jobs, and queues the old source object for deletion. Completed result comparisons retain their own previously consented original snapshot. Delete those results to remove those copies.
- **Replace a photo:** same cancellation behavior; future jobs use the replacement. Existing completed previews are historical snapshots.
- **Delete a result/job:** removes its original, product, intermediate and result snapshots and associated metadata.
- **Delete a profile:** removes that profile, all its photos, jobs and results.
- **Delete account:** removes all owned records and revokes sessions immediately.

All file deletion uses a durable database garbage outbox. The worker normally removes bytes after a two-minute safety delay plus its next 15-second sweep. Storage outages extend this interval; entries remain until deletion succeeds. Run the worker until the outbox is empty. Media authorization is revoked immediately even if physical cleanup is pending. In-flight publication and deletion serialize on the same owner lock; workers recheck live records and never recreate a deleted profile/account/job.

Hugging Face IDM-VTON has no request-record deletion endpoint documented in the researched contract. The operator can retain prediction IDs in a restricted operational request while arranging provider deletion through its published contact. Do this **before** deleting local job metadata if provider record deletion is required. Local cancellation cannot guarantee cancellation or refund of already-submitted work.

## Security implementation

Decoded JPEG/PNG/WebP validation, 12 MB upload/fetch cap, 25 MP decoder cap, 256 px minimum edge, one frame, EXIF removal, orientation normalization, per-resource owner checks, random object names, short-lived in-memory image blobs, no-store responses, restricted CORS, hashed session tokens, secure password hashing, body limits and rate limits are implemented. Tokens are not URL query parameters.

Backend image fetch resolves all destination addresses and rejects any non-public address. The request pins the approved address while preserving the original hostname for TLS, preventing DNS rebinding. Each redirect is independently validated. Only HTTP(S), standard ports and credential-free URLs are allowed. Time/byte limits and actual decoding apply. No proxy, anti-bot bypass, hotlink workaround or cookie forwarding is used.

For production, use TLS, managed secrets, bucket public-access blocking, least-privilege service credentials, encrypted disks/backups and infrastructure-level egress controls. The included MinIO is for local development; its upstream community repository is archived. Choose maintained storage for a public deployment. Dependency audit results are a snapshot, not a guarantee.
