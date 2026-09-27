# Five-minute examination demonstration

This is a **script and recording checklist**, not a finished real-AI demonstration video. A valid recording needs a funded FASHN credential and suitable consented reference photographs. Automated screenshots use synthetic data and are not AI evidence.

## Recording prerequisites

- Build and load the unpacked extension; pin its toolbar action.
- API/worker running with `PROVIDER=fashn`; `/ready` returns 200. No demo banner.
- Prepare one clear, consented full-body photo usable for both a top and a dress. Keep keys and other private tabs out of the recording.
- Verify two accessible shopping sites with different product categories immediately before recording. Do not record bypassing any access challenge.
- Choose exact variant images; have credits for at least two try-ons. Keep Original setting selected.
- Record the browser window and side panel with the OS recorder. Capture actual queued/generating/completed states; do not relabel a mock or splice an unrelated image into a result.
- Fill the evaluation table with measured observations. If a generation takes longer than the nominal segment, extend the recording or visibly time-compress it with an accurate label.

## Walkthrough

| Time      | Screen action                                            | Suggested narration                                                                                                                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:25 | Show shopping page and installed extension               | “Online catalog photos do not show an item on me. TryOn Studio provides a visual appearance preview across shopping websites, without claiming fit or size accuracy.”                                                                                                                                                  |
| 0:25–1:05 | Register/sign in, create profile, upload full-body photo | “My named profile is reusable. Images are stored privately and only the relevant reference is sent with explicit consent. Good lighting and clear framing improve the input.”                                                                                                                                          |
| 1:05–1:55 | First website, detect a top, choose image and variant    | “The extension reads product metadata and page images. I can correct its category and choose another image. I confirm the selected color myself.”                                                                                                                                                                      |
| 1:55–2:40 | Consent, submit, observe real status, compare result     | “This is the actual provider job. It continues if I close the side panel. The comparison shows my source photograph and the generated preview. Notice any color, print, face or placement differences.”                                                                                                                |
| 2:40–3:35 | Second website, select dress, reuse profile, generate    | “The same profile works here. Dresses require a full-body reference. This job sends both my image and the garment image to the clothing-specific model.”                                                                                                                                                               |
| 3:35–4:15 | History, two-result comparison, save/download/feedback   | “History keeps the source product, model and timing with each look. I can flag changed details and download or save a result.”                                                                                                                                                                                         |
| 4:15–5:00 | Delete result/profile, explain diagram                   | “The API owns authentication and durable state; Redis coordinates the worker, PostgreSQL stores metadata, and private object storage holds images. Deletion revokes access immediately, suppresses in-flight publication and schedules physical file cleanup. Provider records follow its separate retention process.” |

## Actual generation evaluation

Do not fill unknowns with guesses. `Generation time` includes queue and processing as displayed by server timestamps. Assess identity, color, pattern/logo details and placement by inspecting the real result next to the original and product reference.

| Website / exact URL         | Category | Variant | Person photo    | Provider / model   | Measured time | Identity observation | Color / pattern / detail | Positioning | Outcome                   | Known issue                  |
| --------------------------- | -------- | ------- | --------------- | ------------------ | ------------- | -------------------- | ------------------------ | ----------- | ------------------------- | ---------------------------- |
| Pending consented real test | Tops     | Pending | Upper/full body | FASHN / tryon-v1.6 | Not measured  | Unverified           | Unverified               | Unverified  | Blocked: credential/photo | No real generation performed |
| Pending consented real test | Dresses  | Pending | Full body       | FASHN / tryon-v1.6 | Not measured  | Unverified           | Unverified               | Unverified  | Blocked: credential/photo | No real generation performed |

## Exact recording checklist

- [ ] Extension installation and exact build shown.
- [ ] Real provider mode and profile setup shown, without exposing credentials.
- [ ] Two real website URLs visible; at least top and dress tested.
- [ ] Actual page detection and image/variant selection shown on both.
- [ ] Explicit consent shown for each job.
- [ ] Real statuses and completed results shown; no mock evidence substituted.
- [ ] Original/product/output comparison with honest quality observations.
- [ ] Reused profile, history, download, feedback and deletion demonstrated.
- [ ] Architecture and provider retention limitation explained.
- [ ] Fill evaluation table and record test date, browser version, limitations and elapsed times.
- [ ] Export recording as MP4/WebM and label it accurately.
