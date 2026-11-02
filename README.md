# Mahabharat AI Studio

Turns a Mahabharata PDF into a complete, chronological library of ~55-second Hindi narration scripts
(**Story Engine**), then turns any selection of approved scripts into cinematic 9:16 videos for YouTube Shorts
and Instagram Reels (**Video Engine**).

The story is generated **once**. Every script is versioned and stored in MongoDB. Approved scripts are never
regenerated automatically. Videos are produced only from saved scripts, and every paid step is cached so it is
never paid for twice.

---

## Architecture

```
Browser ── Next.js studio (apps/web) ──/api/* proxy──▶ Express API (apps/api/src/server.ts)
                                                        │  zod validation · encrypted secrets · budget guard
                                                        ├─ MongoDB      sources, chunks, outlines, episodes, versions, assets, jobs, usage
                                                        ├─ Qdrant       chunk embeddings (or MongoDB Atlas Vector Search)
                                                        └─ Redis/BullMQ ─▶ Worker process (apps/api/src/worker.ts)
                                                              pdf-processing → embedding-generation → story-outline → script-generation
                                                              audio-generation → video-generation → video-rendering
Providers: Gemini (text, structured output, embeddings, OCR) · ElevenLabs (Hindi TTS + timestamps)
           VideoProvider registry (Google Gemini Omni via Interactions API; add more without touching the pipeline)
FFmpeg:    safe 9:16 reframing · cross-fades · colour grade · ducked music · ambience · loudness −14 LUFS · Hindi subtitles · logo
```

### Story Engine pipeline
1. **Extraction.** Poppler extracts text page by page. Each page gets a quality score that detects scanned pages,
   legacy Krutidev-style fonts, broken Devanagari ordering and missing conjunct glyphs. Low-scoring pages are
   rendered and OCR'd (Gemini vision by default, Tesseract optional). Page numbers are kept throughout.
2. **Chunking.** Paragraph-aware chunks with overlap, section headings and page ranges, idempotently upserted.
3. **Embeddings.** Batched and resumable; written to Qdrant with deterministic point IDs.
4. **Master outline** (checkpointed per stage):
   - *Map:* extract events per segment, citing passage IDs.
   - *Era assignment:* every event is placed in the story-chronological era where it happens. Flashbacks such as
     Karna's birth (narrated in the Udyoga Parva) land where they occur in the story.
   - *Merge:* retellings are merged using embeddings. Variant versions are kept and flagged as contradictions.
   - *Characters:* a character database with visual identities and age variants.
   - *Plan:* events are grouped into ~55 s episodes window by window, with a coverage check so no important event
     is skipped.
5. **You approve the outline.**
6. **Scripts** (one job per episode, idempotent):
   - *Retrieval:* RAG over the cited passages plus semantically similar ones.
   - *Style:* chosen from 12 narration styles by context. Near-ties are broken deterministically, avoiding a repeat
     of the previous episode's style.
   - *Writing:* the script carries the previous episode's teaser and the next episode's plan for continuity.
   - *Checks:* duration, structure (hook first, honest teaser), duplicates (embedding similarity) and a separate
     LLM quality evaluation.
   - *Regeneration:* scripts below the bar are regenerated with feedback. If they still fail, they are saved as
     **Review Required**; work is never discarded.
7. **You** edit, approve and lock scripts. Each edit creates a new `ScriptVersion` and invalidates only that
   episode's narration and video assets.

### Video Engine pipeline (per episode version)
1. **Narration.** ElevenLabs `/with-timestamps`, cached by hash(script text, voice, model, settings). A Redis
   single-flight lock means identical narration is generated once, even inside a parallel batch. Real audio
   duration is measured and used to recalibrate the script duration estimator.
2. **Scene plan.** Timed sentence segments (from the TTS character timestamps) are mapped to 7–9 scenes by an LLM,
   with a deterministic fallback. Scene timing is exact to the narration. Each prompt includes the visual style,
   character identity prompts and reference images, and continuity notes.
3. **Scenes.** One job per scene, behind a budget guard. Scenes are cached by hash(prompt, references, model,
   aspect, resolution). A failed scene is retried on its own; finished scenes are reused.
4. **Render.**
   - Clips are fit over a blurred fill, so nothing is cropped and provider watermarks are never removed.
   - Visual effects: subtle push-in (disabled for providers with visible watermarks), cross-fades and a consistent
     colour grade.
   - Audio: narration normalised to −14 LUFS, music ducked by sidechain, provider ambience as an SFX bed.
   - Subtitles: rendered by Skia/HarfBuzz so Devanagari conjuncts are correct. Placement stays above the Shorts
     and Reels UI and clear of the right action rail. Modes are karaoke, pop, fade or none.
   - Output: H.264 High / AAC, 1080×1920, `+faststart`, plus SRT and ASS files and a thumbnail.
5. **Batches** respect `maxConcurrency`, run in the background and survive page refreshes and restarts.
   A new version is created on regenerate; earlier versions are never overwritten.

---

## Repository layout

```
apps/api/                 Express API + BullMQ workers (TypeScript, ESM, run with tsx)
  src/config              env (zod-validated), pino logger with secret redaction
  src/models              13 Mongoose models (+ MusicTrack) with indexes/unique constraints
  src/providers           llm/gemini · tts/elevenlabs · video/{types,registry,geminiOmni} · vector/{qdrant,atlas}
  src/services/story      pdf, chunker, ingest, retrieval, outline, characters, scripts
  src/services/video      alignment, subtitles, render (FFmpeg), pipeline (orchestration)
  src/services/cost       pricing catalog, usage records, budget guard, estimator
  src/queues, src/workers BullMQ queues, idempotent job service, worker runtime (retry/backoff/cancel/rate-limit)
  src/routes              REST API (see docs/API.md)
  tests/                  unit + integration (Workflow A, B, C)
apps/web/                 Next.js 15 studio UI (Tailwind, shadcn-style components, React Query)
packages/shared/          statuses, queue names, narration & visual style library, DTO types, duration heuristics
scripts/                  infra.sh (start/stop MongoDB, Qdrant, Redis), install-tools.sh
docs/API.md               endpoint reference
storage/                  local assets (git-ignored)
```

Storage layout (`StorageProvider` interface; the local implementation is used today, and an S3 implementation
can map the same keys to objects):

```
projects/<sourceId>/source/original.pdf · pages.json · ocr/
projects/<sourceId>/episodes/<0001>/audio/<cacheKey>.mp3 (+ .alignment.json)
projects/<sourceId>/episodes/<0001>/scenes/<cacheKey>.mp4
projects/<sourceId>/episodes/<0001>/renders/<videoId>/final.mp4 · thumbnail.jpg · subtitles.srt · subtitles.ass
characters/<id>/…   library/music/…   library/branding/…   library/fonts/ (optional extra .ttf/.otf)
```

---

## Prerequisites

| Tool | Version | Install (macOS) | Install (Ubuntu) |
|---|---|---|---|
| Node.js | ≥ 20.9 | `nvm install 20` | `nvm install 20` |
| MongoDB | ≥ 7 | `bash scripts/install-tools.sh` (official tarball into `.tools/`) or `brew install mongodb/brew/mongodb-community` | official apt repo, or `scripts/install-tools.sh` |
| Redis | ≥ 6.2 | `brew install redis` | `apt install redis-server` |
| Qdrant | 1.x | `bash scripts/install-tools.sh` (official binary) or Docker | same |
| FFmpeg + ffprobe | ≥ 6 with libx264 | `brew install ffmpeg` | `apt install ffmpeg` |
| Poppler (pdftotext/pdftoppm/pdfinfo) | any | `brew install poppler` | `apt install poppler-utils` |
| Tesseract (optional OCR) | ≥ 5 + `hin` | `brew install tesseract tesseract-lang` | `apt install tesseract-ocr tesseract-ocr-hin` |
| Devanagari font | — | built in (Kohinoor Devanagari) | `apt install fonts-noto-core` (Noto Sans Devanagari) |

FFmpeg does **not** need libass or drawtext; subtitles are rendered in Node. With Docker you can run
`docker compose up -d` instead of the infra script.

## Setup

```bash
nvm use                         # Node 20 (.nvmrc)
npm install
cp .env.example .env            # set SECRETS_MASTER_KEY (see comment in the file)
bash scripts/install-tools.sh   # only if MongoDB/Qdrant are not installed
npm run infra:up                # starts MongoDB :27017, Qdrant :6333, Redis :6379 (data in ./.data)
npm run db:init                 # creates collections, indexes, default settings & pricing
npm run dev                     # API :4000 + worker + web :3000
```

Open http://localhost:3000 → **AI Provider Settings**:

1. Paste the **OpenAI API key** (Text AI tab) and click *Test & check models*.
2. Paste the **Google AI Studio API key**, then click *Test & check models*. Models are discovered live from
   `models.list`; leave model fields on *Auto* or pin specific IDs.
3. Paste the **ElevenLabs API key**, pick a Hindi narrator voice and generate a test sample. The key needs Text to
   Speech (Access), Voices (Read), Models (Access) and User (Access).
4. Set **budgets** (daily, monthly, per episode) and review **pricing**.

Other commands: `npm run infra:status`, `npm run infra:down`, `npm run typecheck`, `npm test`,
`npm run build`, `npm run start -w @mas/api`, `npm run worker -w @mas/api`, `npm run start -w @mas/web`.

## Using it

1. **Story Sources:** upload the PDF (choose language and edition), then *Process*. Watch the page, OCR and
   embedding progress, and check the text preview and extraction errors.
2. *Generate outline*, review events, contradictions and planned episodes (edit titles and synopses), then
   *Approve*.
3. *Generate scripts*, either all at once or in ranges. Scripts appear in **Script Studio** as Draft or Review
   Required.
4. Edit, approve and lock scripts. Bulk approve and export (JSON/CSV/TXT) are available.
5. **Video Studio:** select approved episodes, then pick voice, visual style, quality, music, subtitles and
   concurrency. *Estimate cost*, then confirm. You can leave the page; progress is in **Generation Queue**.
6. **Video Library:** preview, download (MP4/SRT/ASS/audio), regenerate (new version) or delete versions.

---

## Provider notes (verified 2026-11-02)

- **Text AI provider (Settings → Text AI).** All text work goes through one switchable provider: outline,
  characters, Hindi scripts, quality checks, Hinglish copies, scene planning, OCR and embeddings. The default is
  **OpenAI** (Responses API with strict JSON schemas). Models are picked per role from your key's live model list:

  | Role | Model family | Current pick |
  |---|---|---|
  | Analysis | Sol | `gpt-6.1-sol` |
  | Script writing and OCR | Terra | `gpt-6.1-terra` |
  | Fact-check | Sol | `gpt-6.1-sol` |
  | Hinglish and style selection | Luna | `gpt-6-luna` |
  | Embeddings | — | `text-embedding-3-small` (768 dims) |

  Dated snapshots and models past their `shutdown_date` are skipped, and every role can be pinned. Google Gemini
  can be selected instead. Video always uses the Google video provider. Each source keeps the embedding model it
  was indexed with, so switching providers never mixes vector spaces.
- **English editions.** The PDF language is auto-detected. Scripts are always written in Hindi from the source
  facts, and each script also gets a saved Hinglish (Roman-script) reading copy.

- **Google video generation.** Veo models were shut down on the Gemini API (`veo-3.0-*` on 2026-06-30, the
  `veo-3.1-*` previews on 2026-10-22). The current model is **`gemini-omni-1.1-flash`**, called through
  `POST /v1beta/interactions` with `response_format.type = "video"`. Its constraints:
  - `aspect_ratio` `9:16` is supported, and the model is available in India.
  - Clips are 3–10 s at 24 fps; the clip length is chosen by the model, not a request field.
  - Resolution: 720p native; 1080p and 4k are upscaled.
  - Watermark: SynthID (invisible) only.
  - Billing: **paid tier only**, about $0.10/s at 720p.

  The adapter is `providers/video/geminiOmni.ts`. Nothing hardcodes the model: it comes from Settings or is
  discovered from `models.list`, and *Test & check models* calls `models.get` to confirm availability for your
  key. **A Google AI Pro consumer subscription does not include API credits.** API usage needs a billing-enabled
  AI Studio project.
- **Adding a provider.** Implement `VideoProvider` (`generateVideo`, `checkStatus`, `downloadVideo`,
  `getCapabilities`, `estimateCost`, `checkAvailability`) and call `registerVideoProvider()`. The pipeline never
  switches providers on its own; an unknown or unavailable provider is a clear error.
- **Gemini text and embeddings.** Models are chosen per role (text, analysis, quality, OCR, embedding) from the
  live catalog, preferring the newest stable model. You can pin any of them. Structured output tries
  `responseJsonSchema`, then `responseFormat`, then a prompt-only JSON mode, and every response is validated
  with zod either way.
- **ElevenLabs.** `/v1/text-to-speech/{voice}/with-timestamps` supplies the character alignment used for
  subtitles and scene timing. `language_code=hi` is sent except for `eleven_multilingual_v2`, which does not
  accept it.
- **Pricing.** No provider exposes a pricing API, so prices live in an editable catalog (Settings → Pricing) with
  source URLs, effective-date ranges (for example, Gemini 4 Argon's 2026-12-01 increase) and a staleness warning
  after 30 days. Prices that could not be verified are marked `verified: false` and appear as estimate warnings.
- **Music and SFX.** Nothing is bundled. Upload only tracks you have commercial rights to; uploads require a
  license field and an explicit confirmation.

## Reliability and cost control

- **Idempotency.** Every job has a unique idempotency key (unique index), so refreshes and double clicks cannot
  duplicate work. Episodes are unique per (source, number); videos per (episode, version); batches per client key.
- **Retries.** Retryable errors (network, 408, 429, 5xx) back off exponentially. A 429 pauses the queue without
  consuming an attempt. Permanent errors fail fast with the reason.
- **Cancel and resume.** Cancel is cooperative and checked between paid steps. *Resume* re-runs only failed steps.
  On worker start, jobs that MongoDB thinks are active but Redis lost are re-enqueued.
- **Budgets.** Daily, monthly and per-episode limits are checked before each paid call. Going over them pauses the
  video in `awaiting_confirmation` until you confirm.
- **Logging.** Secrets are encrypted at rest (AES-256-GCM), masked in the UI and redacted from logs and error
  messages.

## Testing

```bash
npm run infra:up && npm test
```

- **Unit tests** cover duration heuristics, chunking and overlap, PDF triage, style selection, script validation,
  pricing effective dates, crypto and secret scrubbing, and model auto-selection.
- **Workflow A** (`tests/integration/story-workflow.test.ts`) runs upload, extraction, OCR fallback, embeddings in
  Qdrant, outline, approval, scripts persisted, no duplicates on re-run, approval protection and versioned edits.
- **Workflow B/C** (`tests/integration/video-workflow.test.ts`) runs a 5-episode batch with confirmation and
  budget gates, real FFmpeg renders (1080×1920, SRT/ASS) and narration caching. It then forces a scene to fail,
  retries only that scene, checks that the other clips are reused and the render resumes, and confirms the old
  versions are kept.

Integration tests use real MongoDB, Redis, Qdrant, BullMQ, poppler and FFmpeg. Only the provider HTTP APIs
(Gemini, ElevenLabs) are replaced by a local stub server (`tests/helpers/stubProviders.ts`) that follows their
documented response shapes, so the tests run without credentials or cost. The running application always calls
the real providers.

## Atlas Vector Search (optional)

Set `VECTOR_STORE=atlas` and create an Atlas Search **vector** index named `chunk_vector_index` on the
`chunk_vectors` collection:

```json
{ "fields": [
  { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
  { "type": "filter", "path": "sourceId" }, { "type": "filter", "path": "pageStart" }, { "type": "filter", "path": "pageEnd" } ] }
```

## Troubleshooting

- **412 `MISSING_CREDENTIALS`:** add the key in Settings.
- **Video model "not available":** the key is not on the paid tier, or the model was retired. Pick another model
  in Settings.
- **Many OCR pages:** the PDF uses a legacy Hindi font or has no text layer. OCR needs the Gemini key, or
  Tesseract with `hin` data.
- **Subtitles show boxes:** install a Devanagari font, or drop a `.ttf` into `storage/library/fonts` and select it.
