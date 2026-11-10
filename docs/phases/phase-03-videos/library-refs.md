# Phase 03 — Library References

| Library / tool | Version | Used for | Documentation |
|---|---|---|---|
| `@aws-sdk/client-s3` | 3.1165.0 | S3-compatible multipart, object metadata and ranged reads | [AWS SDK v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/) |
| `@aws-sdk/s3-request-presigner` | 3.1165.0 | Presigned multipart part URLs | [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) |
| `bullmq` | 6.7.3 | Redis-backed durable video-processing queue and worker | [BullMQ workers](https://docs.bullmq.io/guide/workers) |
| `ioredis` | 5.11.1 | Redis client required by BullMQ | [ioredis](https://github.com/redis/ioredis) |
| FFmpeg / FFprobe | Docker image package | Video stream validation, metadata and thumbnail | [FFmpeg](https://ffmpeg.org/documentation.html) |
| MinIO | `bitnamilegacy/minio:2025.5.24` | Local S3-compatible object storage; CORS is enabled by default | [MinIO documentation](https://min.io/docs/minio/linux/index.html), [S3 API compatibility](https://github.com/minio/docs/blob/main/source/reference/s3-api-compatibility.rst) |
