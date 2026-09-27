# API reference

Base URL: `http://localhost:4000` in development, HTTPS behind a reverse proxy in production. JSON except multipart uploads and image responses. Protected routes require `Authorization: Bearer <session-token>`. CORS never substitutes for authentication. Tokens expire after seven days; only SHA-256 token hashes are stored in PostgreSQL. Passwords use bcrypt cost 12, 12-character minimum, 72-byte maximum. This examination build does not include email verification or password recovery.

| Method | Route                        | Request / response                                                                        |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/health`                    | Process liveness                                                                          |
| GET    | `/ready`                     | DB, Redis, bucket, recent worker heartbeat and provider configuration; 503 if unavailable |
| GET    | `/capabilities`              | Provider/model, enabled categories, lifecycle features, configured flag                   |
| POST   | `/auth/register`             | `{email,password}` → token and email                                                      |
| POST   | `/auth/login`                | `{email,password}` → token and email                                                      |
| POST   | `/auth/logout`               | Revoke current session                                                                    |
| GET    | `/auth/me`                   | Owned account ID/email/creation date                                                      |
| GET    | `/profiles`                  | Owned named profiles with image metadata, never storage keys                              |
| POST   | `/profiles`                  | `{name,isDefault?}` → profile                                                             |
| PATCH  | `/profiles/:id`              | `{name?,isDefault?}`                                                                      |
| DELETE | `/profiles/:id`              | Remove profile, photos, jobs and results; enqueue object deletion                         |
| POST   | `/profiles/:id/images/:slot` | Multipart field `image`; replaces slot; returns dimensions and heuristic warnings         |
| DELETE | `/profiles/:id/images/:slot` | Remove slot; cancel jobs using it                                                         |
| GET    | `/images/:id`                | Authenticated JPEG bytes                                                                  |
| POST   | `/jobs`                      | Validated selection (below) → 202 `{id,status}`                                           |
| GET    | `/jobs`                      | Latest 100 owned jobs and result metadata                                                 |
| GET    | `/jobs/:id`                  | Persistent lifecycle, product, result and safe error code                                 |
| POST   | `/jobs/:id/cancel`           | Local cancellation; provider computation may still finish                                 |
| DELETE | `/jobs/:id`                  | Delete job and all owned input snapshots/output                                           |
| GET    | `/results`                   | Latest 100 completed results with job/product metadata                                    |
| PATCH  | `/results/:id`               | `{saved?,feedback?}`                                                                      |
| DELETE | `/results/:id`               | Delete result and its owning job/snapshots                                                |
| GET    | `/jobs/:id/media/:kind`      | `original`, `product`, or `result`; `?download=1` adds attachment header                  |
| DELETE | `/account`                   | Revoke all sessions; cascade profiles/jobs/consents; enqueue all image files              |

Slots: `full`, `upper`, `lower`, `feet`, `face`, `extra`. Profile limit: 10. Active jobs: 3/account. API limiter: 180/minute/IP; auth endpoints: 20/15 minutes/IP; creation: 10/minute/IP. Set proxy trust to exactly match deployment topology.

```json
{
  "profileId": "UUID",
  "category": "dresses",
  "scene": "original",
  "consent": true,
  "idempotencyKey": "UUID",
  "selectedImage": "https://shop.example/images/blue-dress.jpg",
  "variant": "Blue / Medium",
  "product": {
    "id": "page-product-1",
    "source": "https://shop.example/products/dress",
    "url": "https://shop.example/products/dress",
    "title": "Blue linen dress",
    "category": "dresses",
    "images": [
      { "url": "https://shop.example/images/blue-dress.jpg", "score": 100 }
    ],
    "variants": [{ "label": "Blue / Medium" }],
    "method": "jsonld",
    "confidence": 0.95
  }
}
```

Product metadata also accepts bounded description, brand, price and currency. `selectedImage` must belong to its images array. A repeated key returns the same job; changed input with the same key returns 409. Explicit consent is stored with provider and consent-version timestamp for each new job. Validation is shared with the extension.

Errors use `{error: string}`. Invalid input is 400, missing authentication 401, absent/unowned resources 404, conflicts 409, large uploads 413, rate limit 429, missing provider setup 503. Unexpected errors have generic messages without secrets. Product HTTP access failures are persisted as `IMAGE_HTTP_<status>` and do not trigger attempts to circumvent the website restriction.
