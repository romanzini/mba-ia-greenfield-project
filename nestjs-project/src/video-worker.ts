import { NestFactory } from '@nestjs/core';
import { VideoWorkerModule } from './videos/video-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(VideoWorkerModule);
  app.enableShutdownHooks();
}

void bootstrap();
