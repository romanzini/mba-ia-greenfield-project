import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_VIDEO_SIZE_BYTES } from '../video.constants';

export class CreateVideoUploadDto {
  @IsString()
  @MaxLength(255)
  originalFilename: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  title: string;

  @IsString()
  @Matches(/^video\/[a-z0-9.+-]+$/i)
  @MaxLength(100)
  contentType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_SIZE_BYTES)
  fileSizeBytes: number;
}
