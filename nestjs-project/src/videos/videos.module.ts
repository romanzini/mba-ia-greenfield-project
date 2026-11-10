import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { S3Client } from '@aws-sdk/client-s3';
import videoQueueConfig from '../config/video-queue.config';
import videoStorageConfig from '../config/video-storage.config';
import { Channel } from '../channels/entities/channel.entity';
import { VideosController } from './videos.controller';
import { Video } from './entities/video.entity';
import { VideoQueueService } from './video-queue.service';
import { VideosService } from './videos.service';
import {
  ObjectStorageService,
  VIDEO_S3_CLIENT,
  VIDEO_S3_PRESIGN_CLIENT,
} from './storage/object-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([Video, Channel])],
  controllers: [VideosController],
  providers: [
    {
      provide: VIDEO_S3_CLIENT,
      inject: [videoStorageConfig.KEY],
      useFactory: (config: ConfigType<typeof videoStorageConfig>) =>
        new S3Client({
          endpoint: config.endpoint,
          region: config.region,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }),
    },
    {
      provide: VIDEO_S3_PRESIGN_CLIENT,
      inject: [videoStorageConfig.KEY],
      useFactory: (config: ConfigType<typeof videoStorageConfig>) =>
        new S3Client({
          endpoint: config.publicEndpoint,
          region: config.region,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }),
    },
    ObjectStorageService,
    VideosService,
    {
      provide: VideoQueueService,
      useFactory: (config: ConfigType<typeof videoQueueConfig>) =>
        new VideoQueueService(config),
      inject: [videoQueueConfig.KEY],
    },
  ],
  exports: [ObjectStorageService, VideoQueueService, VideosService],
})
export class VideosModule {}
