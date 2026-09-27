# Real provider adapter

Research date: 2026-09-27. Sources are official documentation, not inferred SDK structures.

| Contract     | Implementation                                                                       |
| ------------ | ------------------------------------------------------------------------------------ |
| Endpoint     | `POST https://api.fashn.ai/v1/run`, Bearer key                                       |
| Try-on model | `tryon-v1.6`                                                                         |
| Conditioning | Exactly one `model_image` and one `garment_image`, as JPEG data URIs                 |
| Category     | `tops`, `bottoms`, `one-pieces`; explicit mapping in registry                        |
| Settings     | balanced, conservative moderation, one sample, JPEG, base64 output                   |
| Submission   | Returned prediction `id` stored before status polling                                |
| Status       | `GET /v1/status/{id}`; starting, in_queue, processing, completed, failed             |
| Output       | First returned output, validated and stored privately                                |
| Cancellation | No implemented remote cancellation; local cancellation suppresses publication        |
| Lifestyle    | Optional second `edit` prediction with fixed scene instruction and the try-on output |

Official [try-on contract](https://docs.fashn.ai/api-reference/tryon-v1-6) documents image-based garment transfer and the category choices used here. Tops/shirts/jackets map to tops, trousers to bottoms, dresses to one-pieces. The adapter does not send web descriptions as prompts. It does not submit extra reference slots, masks, segmentation, or invented body measurements. Image preparation bounds the longest edge at 1600 pixels; the provider documents internal processing at 864 × 1296. Capture guidance is a practical recommendation, not an implemented pose detector.

[API Fundamentals](https://docs.fashn.ai/api-overview/api-fundamentals) establishes asynchronous polling and error structures. Runtime failure becomes `GENERATION_REJECTED`; raw provider responses and input data are never logged or returned as errors. Only status reads have automatic retries. Provider authentication, rate-limit and unavailable errors are normalized. Ambiguous submissions require manual reconciliation.

[Lifestyle Edit](https://docs.fashn.ai/api-reference/edit) is an experimental model. Enable with `ENABLE_LIFESTYLE=true`. It receives the try-on result and a server-owned prompt for studio, outdoors, beach, or city; request settings are `resolution: 1k`, `generation_mode: fast`, one JPEG base64 output. This is a separate charge. No strict mask is applied, so the UI warns of additional visual variation. Original setting is default. Identity, logos and product fidelity are requested, never guaranteed.

[Provider retention](https://docs.fashn.ai/api-overview/data-retention-privacy) states that base64 inputs have temporary processing copies with a one-day cleanup backstop, base64 outputs remain accessible for 60 minutes, and request records are not automatically deleted. The provider documents no training use unless separately opted in. No such opt-in is made by this application. Request-record deletion currently requires contacting the provider; no deletion endpoint is claimed.

## Credential-dependent validation

1. Set `PROVIDER=fashn`, `FASHN_API_KEY` with available credits in `.env`; restart API and worker.
2. Check `/capabilities` and `/ready`; `configured: true` only checks credential presence, not validity/credits.
3. Use a consenting adult's appropriate full-body photograph; do not use a synthetic square as evidence of person generation.
4. On a real shopping page, select a top and its exact color image. Generate in Original setting. Confirm a genuine completed prediction and inspect the output.
5. Reuse the full-body profile on a second website for a dress. Record actual timings and observations in the evaluation table.
6. Test optional lifestyle separately, preserving the initial original-setting evidence.

No real provider generation is asserted until those checks have been performed. Mock test images and watermarked mock previews are not evidence of AI quality.
