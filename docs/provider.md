# Real provider adapter — Hugging Face IDM-VTON

TryOn Studio uses the public `yisol/IDM-VTON` Hugging Face Space through its Gradio API. The adapter uploads the normalized person and garment images from the backend, then calls the named `/tryon` endpoint with automatic masking enabled.

## Verified contract

The official Space code defines `start_tryon(dict, garm_img, garment_des, is_checked, is_checked_crop, denoise_steps, seed)` and exposes it as `api_name='tryon'`. Automatic masking uses the Space's `upper_body` mask. The first returned image is the generated try-on and the second is the mask preview.

The initial adapter therefore enables only **T-shirts/tops and shirts**. Dresses, jackets, pants, shoes, jewellery, necklaces and accessories remain disabled until separately verified with an appropriate adapter.

The backend uses the Gradio upload and queue-based call endpoints. `HF_TOKEN` is optional for a public Space but recommended so requests use the signed-in Hugging Face account's ZeroGPU quota. The token is backend-only and must never be bundled into the extension.

## Runtime behavior

1. Set `PROVIDER=huggingface`.
2. Set `HF_TOKEN` to a Hugging Face read token if authenticated quota is desired.
3. Keep `HF_SPACE_URL=https://yisol-idm-vton.hf.space` unless intentionally testing a compatible duplicate.
4. Restart both API and worker.
5. Check `GET /ready` and `GET /capabilities`.
6. Test a consented upper-body photo with a T-shirt or shirt.

The public ZeroGPU Space can queue, rate-limit, reject a request when quota is exhausted, sleep, or become temporarily unavailable. TryOn Studio reports these conditions; it does not bypass quotas and does not silently fall back to FASHN or mock generation.

Lifestyle/background editing is not supported by this adapter. Keep `ENABLE_LIFESTYLE=false`.

## Privacy

Person and garment images are sent to the configured third-party Hugging Face Space only after explicit generation consent. Local deletion removes TryOn Studio's stored copies but cannot promise deletion from external infrastructure. Review Hugging Face privacy/terms and the Space's own repository before public deployment.

No real-provider quality claim should be made from mocked tests. A real consented generation is still required to validate API availability, latency, and output quality for the current Space version.
