import { ApiProperty } from '@nestjs/swagger';
import { VideoMetadata, VideoStatus } from '../entities/video.entity';

export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  originalFilename: string;

  @ApiProperty({ maxLength: 255 })
  title: string;

  @ApiProperty({ example: 'video/mp4' })
  contentType: string;

  @ApiProperty({ example: 1048576 })
  fileSizeBytes: number;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiProperty({ nullable: true, example: 123.45 })
  durationSeconds: number | null;

  @ApiProperty({ nullable: true })
  width: number | null;

  @ApiProperty({ nullable: true })
  height: number | null;

  @ApiProperty({ nullable: true, type: Object })
  metadata: VideoMetadata | null;

  @ApiProperty({
    example: '/videos/00000000-0000-0000-0000-000000000000/thumbnail',
  })
  thumbnailUrl: string;

  @ApiProperty({
    example: '/videos/00000000-0000-0000-0000-000000000000/stream',
  })
  streamUrl: string;

  @ApiProperty({
    example: '/videos/00000000-0000-0000-0000-000000000000/download',
  })
  downloadUrl: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}
