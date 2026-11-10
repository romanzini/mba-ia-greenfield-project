# Phase 03 — Context

## Scope

Implement the backend portion of “Upload e Processamento de Vídeos” from `docs/project-plan.md` and `docs/decisions/technical-decisions-phase-03-videos.md`. The frontend is out of scope.

## Existing project

- `nestjs-project/` is NestJS 11, TypeScript, TypeORM, PostgreSQL 17 and Express.
- Authentication is global by default; `@CurrentUser()` provides the JWT subject and `@Public()` opts public routes out of the guard.
- Every user owns one `Channel`; new videos belong to that channel.
- TypeORM migrations are the schema source of truth; `synchronize` is disabled.
- `DomainException` and the global filters define the API error envelope.
- Docker Compose is the development runtime. Containers must address peers by Compose service name.
- The project now includes video persistence, S3-compatible storage, a Redis/BullMQ queue, and an independent FFmpeg worker for this phase.

## Scope boundaries

- No frontend, video editing/publication, categories, comments, or transcoding.
- The original uploaded media is retained. The worker extracts metadata and creates one thumbnail.
- Storage objects remain private; the API exposes anonymous access only after a video is ready.
- Video UUIDs provide stable, collision-resistant resource URLs.

## Agreed design

Use S3-compatible multipart upload (64 MiB parts, at most 10,000,000,000 bytes) with presigned part URLs, MinIO locally, BullMQ/Redis for asynchronous work, and an independent Nest application-context worker using FFprobe/FFmpeg. Persist the upload and processing state in PostgreSQL. Stream private objects through the API with single-range HTTP support.
