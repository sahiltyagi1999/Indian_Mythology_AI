# Mahabharat AI Studio — REST API

Base URL: `http://127.0.0.1:4000/api` (the web app proxies `/api/*` to it).
All responses are JSON. Errors use one shape:

```json
{ "error": { "message": "Human readable", "code": "VALIDATION_ERROR", "details": {} } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_ID`, `NO_FILE`, `UPLOAD_ERROR` | Malformed request |
| 404 | `NOT_FOUND` | Resource missing |
| 409 | `CONFLICT`, `DUPLICATE`, `CONFIRM_REQUIRED`, `BUDGET_CONFIRMATION_REQUIRED` | State does not allow the action, or explicit confirmation is required |
| 412 | `MISSING_CREDENTIALS` | A provider API key is not configured |
| 422 | `VALIDATION_ERROR`, `INVALID_PDF` | Body/query failed validation |
| 429 / 502 | `RATE_LIMITED`, `HTTP_*`, `AUTH` | Upstream provider error (message is scrubbed of secrets) |

Long-running work is never done in a request: endpoints enqueue jobs and return `202` with the `GenerationJob`. Poll `/jobs/:id` or the resource.

## Health & settings

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Mongo, Redis, vector store, binaries (ffmpeg, poppler, tesseract), disk |
| GET | `/health/queues` | BullMQ counts per queue |
| GET | `/settings` | All non-secret settings + masked secret status + pricing freshness |
| PUT | `/settings/:section` | Partial update. Sections: `google`, `elevenlabs`, `pricing`, `budget`, `render`, `story` |
| PUT | `/settings/:provider/secrets/apiKey` | `{ "value": "..." }` (or `null` to clear). Stored encrypted; response is masked |
| GET | `/settings/system` | Health + queue counts + storage usage |
| GET | `/settings/google/models` | Live `models.list` for the key + candidate video models |
| POST | `/settings/google/test` | Verifies key, resolves model per role, checks video model availability + capabilities |
| GET | `/settings/video-providers` | Registered video providers and capabilities |
| POST | `/settings/elevenlabs/test` | Subscription quota, Hindi-capable models, resolved model |
| GET | `/settings/elevenlabs/voices` | Voice list (`?search=`) |
| POST | `/settings/elevenlabs/test-voice` | `{ text?, voiceId? }` → `{ url }` short Hindi sample (cached) |
| POST/DELETE | `/settings/branding/logo` | Upload (`logo`, PNG/WebP) or remove the channel logo |

## Story Engine

| Method | Path | Description |
|---|---|---|
| GET | `/sources` | Sources with latest outline + episode counts |
| POST | `/sources` | multipart: `file` (PDF), `title`, `edition`, `language` (`hi`/`en`/`sa`), `ocrMode` (`auto`/`always`/`never`). 409 if the same file (SHA-256) exists |
| GET | `/sources/:id` | Source + recent jobs |
| PATCH | `/sources/:id` | Update title/edition/language/ocrMode |
| PUT | `/sources/:id/file` | Replace the PDF (only before episodes exist) |
| DELETE | `/sources/:id` | Delete (refused once episodes exist) |
| POST | `/sources/:id/process` | `{ retryFailedOcr?, force? }` — extraction → OCR fallback → chunking → embeddings |
| GET | `/sources/:id/pages?from&to` | Extracted page text (method `text`/`ocr`/`failed`, quality score) |
| GET | `/sources/:id/chunks?page&pageSize` | Chunks with page ranges and sections |
| GET | `/sources/:id/search?q` | Semantic search (vector store) |
| POST | `/sources/:id/outlines` | Start (or resume) a new outline version |
| GET | `/sources/:id/outlines` | Outline versions |
| GET | `/outlines/eras` | Chronological eras used for ordering |
| GET | `/outlines/:id` | Events, contradictions, planned episodes, progress |
| PATCH | `/outlines/:id/episodes/:n` | Edit a planned episode's title/synopsis (draft only) |
| POST | `/outlines/:id/approve` | Approve the outline |
| POST | `/outlines/:id/generate-scripts` | `{ from?, to?, limit? }` — creates episodes (idempotent) and queues scripts in order |

## Script Studio

| Method | Path | Description |
|---|---|---|
| GET | `/narration-styles` | The style library |
| GET | `/episodes` | Query: `sourceId, search, character, style, status (repeatable), videoStatus, sort, page, pageSize` |
| GET | `/episodes/facets?sourceId` | Character/style/status counts for filters |
| GET | `/episodes/:id` | `{ episode, previous, next, versions, videos, jobs }` |
| GET | `/episodes/:id/versions/:v` | One script version |
| PATCH | `/episodes/:id` | Edit (creates a new ScriptVersion; approved → draft; invalidates narration) |
| POST | `/episodes/:id/approve` · `unapprove` · `lock` · `unlock` | Status transitions |
| POST | `/episodes/:id/regenerate` | `{ instructions?, confirmProtected? }` — explicit only; approved needs `confirmProtected`, locked refused |
| POST | `/episodes/bulk` | `{ ids, action: approve|lock|unlock|unapprove }` |
| POST | `/episodes/export` | `{ ids, format: json|csv|txt }` → file download |

## Characters

| Method | Path | Description |
|---|---|---|
| GET | `/characters?sourceId&search` | Characters with episode counts |
| POST | `/characters` | Create |
| GET/PATCH/DELETE | `/characters/:id` | Read (with episodes) / edit (marks user-edited; AI never overwrites) / delete |
| POST | `/characters/:id/variants/:variant/images` | multipart `image` — reference image for providers that accept references |
| DELETE | `/characters/:id/variants/:variant/images?key=` | Remove a reference image |

## Video Engine

| Method | Path | Description |
|---|---|---|
| POST | `/batches/estimate` | `{ episodeIds, settings, maxConcurrency }` → `CostEstimate` (no side effects) |
| POST | `/batches` | `{ episodeIds, settings, maxConcurrency, confirm: true, acknowledgeBudget?, idempotencyKey }`. 409 `BUDGET_CONFIRMATION_REQUIRED` when the estimate exceeds a budget |
| GET | `/batches` · `/batches/:id` | Batches with video status counts |
| POST | `/batches/:id/cancel` | Cancel queued videos and active jobs |
| GET | `/videos?status&episodeId&batchId&page&pageSize` | Video versions (deleted excluded) |
| GET | `/videos/:id` | `{ video, scenes, jobs }` |
| POST | `/videos/:id/regenerate` | `{ reuseScenes = true, settings? }` → new version (never overwrites) |
| POST | `/videos/:id/scenes/:n/retry` | Retry one failed scene; render resumes automatically |
| POST | `/videos/:id/resume` | Re-run only the failed steps |
| POST | `/videos/:id/confirm-budget` | Approve overspend for a paused video and resume |
| DELETE | `/videos/:id` | Delete this version's render files (scene/narration cache kept) |
| GET/POST/DELETE | `/music` · `/music/:id` | Licensed music/SFX library (upload requires `license` and `commercialUseConfirmed=true`) |
| GET | `/files/<storage key>` | Streams stored assets with Range support; `?download=name.mp4` |

`settings` (VideoGenerationSettings, all optional — defaults come from Settings):
`voiceId, ttsModel, narrationStyleOverride, visualStyle, resolution (720p|1080p), videoProvider, videoModel, musicTrackId, musicVolume, sfxIntensity, subtitles{font,fontSize,textColor,highlightColor,backgroundOpacity,positionFromBottom,animation}, logoPath`.

## Jobs, analytics, dashboard

| Method | Path | Description |
|---|---|---|
| GET | `/jobs?status&queue&batchId&videoId&episodeId&page&pageSize` | Jobs with status counts |
| GET | `/jobs/health` | Queue counts |
| GET | `/jobs/:id` | Full job incl. logs |
| POST | `/jobs/:id/cancel` · `/jobs/:id/retry` | Cancel (cooperative for running jobs) / retry failed or cancelled |
| GET | `/analytics/summary?from&to` | Spend by category, per day, per model; budget; storage |
| GET | `/analytics/episodes` · `/analytics/batches` | Cost per episode / per batch |
| GET | `/dashboard` | Counters, spend, recent videos and jobs |
