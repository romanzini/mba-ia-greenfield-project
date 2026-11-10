import { registerAs } from '@nestjs/config';

export default registerAs('videoQueue', () => ({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  concurrency: parseInt(process.env.VIDEO_WORKER_CONCURRENCY || '1', 10),
}));
