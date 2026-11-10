import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class VideoUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ maxLength: 255 })
  title: string;

  @ApiProperty({ example: 67108864 })
  partSizeBytes: number;

  @ApiProperty({ example: 3 })
  partCount: number;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;
}

export class UploadPartUrlResponseDto {
  @ApiProperty({ format: 'uri' })
  uploadUrl: string;

  @ApiProperty({ example: 1 })
  partNumber: number;

  @ApiProperty({ example: 900 })
  expiresInSeconds: number;
}
