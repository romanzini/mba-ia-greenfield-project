---
kind: phase
name: phase-03-videos
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Add backend video upload and delivery for files up to 10 GiB without sending large bodies through the API. Persist the draft and its channel ownership, complete a multipart S3-compatible upload, process it asynchronously in a separate worker, and provide stable public metadata, streaming, and download endpoints for ready videos.

## Step Implementations

### SI-03.1 — Storage, Queue, Configuration, and Compose

**Description:** Add S3-compatible object storage, Redis/BullMQ, FFmpeg and their validated configuration to the development infrastructure.

**Technical actions:**

- Add AWS SDK v3, S3 presigner, and BullMQ dependencies.
- Add S3, Redis, and worker configuration with Joi validation and development values in `.env.example`.
- Add MinIO, Redis, and `video-worker` services to Compose. Install FFmpeg in the shared backend image. Use Compose service names for internal URLs.
- Create storage and queue providers; create the private bucket at startup. MinIO enables CORS by default; configure the equivalent browser upload CORS rule in production storage infrastructure.
- Record chosen designs and documentation references in the decision document and `library-refs.md`.

**Tests:** Unit tests for configuration/adapters; verify service boot and Compose health.

**Dependencies:** None.

**Acceptance criteria:** API and worker can connect to PostgreSQL, Redis and MinIO; private bucket exists; all configuration is validated.

### SI-03.2 — Video Model and Multipart Upload API

**Description:** Persist channel-owned draft videos and implement safe, resumable multipart upload lifecycle endpoints.

**Technical actions:**

- Create `Video` entity with unique UUID, channel relation, title, status, original object key, multipart ID, expected size/type/name, metadata, thumbnail key, duration and timestamps.
- Add the inverse videos relation to `Channel` and generate a TypeORM migration.
- Implement authenticated endpoints to start a draft upload, request a presigned URL for an individual part, complete the upload, and abort it.
- Enforce a 10 GB (10,000,000,000 bytes) maximum, supported video MIME shape, owner checks, fixed 64 MiB part sizing, valid part-number ranges and exact remote part sizes.
- Queue completion with a deterministic job ID so a completion retry cannot create duplicate processing jobs.

**Tests:** Unit tests for size/part validation and service behavior; integration tests for persistence and ownership; e2e tests for auth and upload lifecycle.

**Dependencies:** SI-03.1.

**Acceptance criteria:** Upload initiation creates a titled draft; the API never receives the media body; only the owning authenticated channel can manage its upload; invalid/incomplete parts cannot transition to processing.

### SI-03.3 — Background Metadata and Thumbnail Processing

**Description:** Process completed uploads outside the API HTTP process and persist results or terminal failure state.

**Technical actions:**

- Add a separate Nest application-context entry point for the worker and a BullMQ consumer with bounded concurrency, retries and backoff.
- Download the source object to a unique temporary file, extract video metadata with FFprobe, generate a JPEG thumbnail with FFmpeg, and upload the thumbnail.
- Transition `processing` → `ready` only after all processing and persistence succeeds; after final retries, persist `error`.
- Remove temporary files in `finally` and close BullMQ/TypeORM resources on shutdown.

**Tests:** Unit tests for processing command/metadata parsing and state transitions; integration tests against PostgreSQL, Redis and MinIO where available.

**Dependencies:** SI-03.2.

**Acceptance criteria:** Completion queues work; the worker extracts duration/metadata and creates a thumbnail; status reflects processing, ready, or terminal error.

### SI-03.4 — Public Metadata, Range Streaming, and Download

**Description:** Expose stable, anonymous access to ready videos without making the object bucket public.

**Technical actions:**

- Add public video metadata endpoint with a safe response DTO.
- Add stream endpoint supporting one byte range, `206`, `Content-Range`, `Accept-Ranges`, and `416` for invalid ranges.
- Add download endpoint using the same bounded storage stream and attachment disposition.
- Return `404` for missing/unready videos; avoid exposing storage keys or multipart identifiers.

**Tests:** Unit tests for range parsing; e2e tests for public access, `200`/`206`/`416`, download disposition and unavailable videos.

**Dependencies:** SI-03.3.

**Acceptance criteria:** Public endpoints work without JWT only for ready videos; partial requests transfer only requested bytes; downloads use attachment headers; objects remain private.

### SI-03.5 — Verification and Documentation

**Description:** Validate the full feature, update operational documentation, and ensure the code and planning artifacts agree.

**Technical actions:**

- Run focused tests during each SI, then the full unit/integration and e2e suites.
- Run `npx tsc --noEmit`, lint, build and the relevant migrations against a clean database.
- Export OpenAPI and update backend setup/architecture documentation and the AI project instructions.
- Update `progress.md` and library references to match actual test outcomes.

**Tests:** Full suite, type check, lint, build, migration run, Compose connectivity and upload/processing/streaming smoke checks when infrastructure is available.

**Dependencies:** SI-03.4.

**Acceptance criteria:** Definition of Done from `nestjs-project/CLAUDE.md` passes; all challenge acceptance criteria are checked against the implemented API and infrastructure.

## Technical Specifications

### State and ownership

- States: `draft` → `processing` → `ready` or `error`.
- Each video belongs to exactly one existing channel. All upload lifecycle operations verify the authenticated user owns that channel.
- A non-empty title (up to 255 characters) is required when the draft is created and appears in upload and public metadata responses.
- Upload initiation reserves a UUID and private object key before any media bytes are sent.
- 10 GB (10,000,000,000 bytes) maximum file size; 64 MiB multipart part size; last part may be smaller.
- MIME type is validated as a video type at the API boundary, then the worker verifies an actual video stream.

### API contracts

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/videos/uploads` | JWT | Create titled draft and multipart session; requires `title`, `originalFilename`, `contentType`, and `fileSizeBytes` |
| POST | `/videos/:id/uploads/parts/:partNumber` | JWT | Presign one part upload |
| POST | `/videos/:id/uploads/complete` | JWT | Verify remote parts and enqueue processing |
| DELETE | `/videos/:id/uploads` | JWT | Abort unfinished upload |
| GET | `/videos/:id` | Public | Return safe metadata for a ready video |
| GET | `/videos/:id/thumbnail` | Public | Stream the generated JPEG thumbnail |
| GET | `/videos/:id/stream` | Public | Stream full or single-range content |
| GET | `/videos/:id/download` | Public | Download ready original |

### Failure and event behavior

- BullMQ job name: `process-video`; deterministic job ID is the video UUID.
- Retry transient processing failures with bounded exponential backoff; set `error` only after the final attempt.
- Upload storage keys, multipart IDs, and internal credentials are never included in public response DTOs.
- Range streaming supports one range per request. Invalid or unsatisfiable ranges return `416` with `Content-Range: bytes */<size>`.

## Dependency Map

SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5

## Deliverables

- S3/MinIO storage, Redis/BullMQ queue, and independent FFmpeg worker in Docker Compose.
- Persisted video entity and migrations (including a safe title backfill for existing rows), upload lifecycle API, metadata processing, thumbnail, stable public URL, streaming, and download.
- Unit/integration/e2e tests, OpenAPI updates, operational documentation, and completed phase progress record.
