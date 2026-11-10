import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Worker } from 'bullmq';
import videoQueueConfig from '../config/video-queue.config';
import { ProcessVideoJob } from './video-queue.service';
import { VIDEO_PROCESSING_QUEUE } from './video.constants';
import { VideoProcessingService } from './video-processing.service';

@Injectable()
export class VideoWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoWorkerService.name);
  private worker: Worker<ProcessVideoJob> | undefined;

  constructor(
    private readonly processingService: VideoProcessingService,
    @Inject(videoQueueConfig.KEY)
    private readonly config: ConfigType<typeof videoQueueConfig>,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ProcessVideoJob>(
      VIDEO_PROCESSING_QUEUE,
      async (job) => this.processingService.process(job.data.videoId),
      {
        connection: {
          host: this.config.host,
          port: this.config.port,
          maxRetriesPerRequest: null,
        },
        concurrency: this.config.concurrency,
      },
    );

    this.worker.on('ready', () => {
      this.logger.log('Video processing worker is ready');
    });
    this.worker.on('failed', (job, error) => {
      if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
      void this.processingService
        .markFailed(job.data.videoId)
        .catch((failure) => {
          this.logger.error(
            `Could not mark video ${job.data.videoId} as failed`,
            failure instanceof Error ? failure.stack : String(failure),
          );
        });
      this.logger.error(
        `Video processing failed for ${job.data.videoId}`,
        error.stack,
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error('Video queue worker failed', error.stack);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
