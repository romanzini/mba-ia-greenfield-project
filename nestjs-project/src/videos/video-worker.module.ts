import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppModule } from '../app.module';
import { VideosModule } from './videos.module';
import { Video } from './entities/video.entity';
import { VideoProcessingService } from './video-processing.service';
import { VideoWorkerService } from './video-worker.service';

@Module({
  imports: [AppModule, VideosModule, TypeOrmModule.forFeature([Video])],
  providers: [VideoProcessingService, VideoWorkerService],
})
export class VideoWorkerModule {}
