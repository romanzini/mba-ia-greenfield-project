import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import videoQueueConfig from '../config/video-queue.config';
import { VIDEO_PROCESSING_QUEUE } from './video.constants';

export interface ProcessVideoJob {
  videoId: string;
}

@Injectable()
export class VideoQueueService implements OnModuleDestroy {
  private readonly queue: Queue<ProcessVideoJob>;

  constructor(
    @Inject(videoQueueConfig.KEY)
    config: ConfigType<typeof videoQueueConfig>,
  ) {
    this.queue = new Queue<ProcessVideoJob>(VIDEO_PROCESSING_QUEUE, {
      connection: {
        host: config.host,
        port: config.port,
        maxRetriesPerRequest: null,
      },
    });
  }

  async enqueue(videoId: string): Promise<void> {
    await this.queue.add(
      'process-video',
      { videoId },
      {
        jobId: videoId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
