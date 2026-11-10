import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { S3ServiceException, type CompletedPart } from '@aws-sdk/client-s3';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  ChannelNotFoundException,
  InvalidVideoUploadException,
  VideoNotFoundException,
  VideoNotReadyException,
  VideoRangeNotSatisfiableException,
  VideoUploadStateException,
} from '../common/exceptions/domain.exception';
import { Channel } from '../channels/entities/channel.entity';
import { ObjectStorageService } from './storage/object-storage.service';
import { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { VideoUploadResponseDto } from './dto/video-upload-response.dto';
import { MAX_VIDEO_SIZE_BYTES, VIDEO_PART_SIZE_BYTES } from './video.constants';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoQueueService } from './video-queue.service';
import { parseVideoRange } from './video-range.util';
import { Readable } from 'node:stream';

const PRESIGNED_URL_TTL_SECONDS = 900;

export interface VideoStream {
  body: Readable;
  contentType: string;
  contentLength: number;
  contentRange: string | null;
  statusCode: 200 | 206;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly objectStorage: ObjectStorageService,
    private readonly videoQueue: VideoQueueService,
  ) {}

  async startUpload(
    userId: string,
    dto: CreateVideoUploadDto,
  ): Promise<VideoUploadResponseDto> {
    if (
      !Number.isSafeInteger(dto.fileSizeBytes) ||
      dto.fileSizeBytes < 1 ||
      dto.fileSizeBytes > MAX_VIDEO_SIZE_BYTES
    ) {
      throw new InvalidVideoUploadException(
        'Video size must be between 1 byte and 10 GB',
      );
    }

    const channel = await this.channelRepository.findOne({
      where: { user_id: userId },
    });
    if (!channel) throw new ChannelNotFoundException();

    const videoId = randomUUID();
    const video = this.videoRepository.create({
      id: videoId,
      original_filename: dto.originalFilename.trim(),
      title: dto.title.trim(),
      content_type: dto.contentType.toLowerCase(),
      file_size_bytes: String(dto.fileSizeBytes),
      status: VideoStatus.DRAFT,
      channel_id: channel.id,
      object_key: `videos/${channel.id}/${videoId}/original`,
      multipart_upload_id: null,
      thumbnail_key: null,
      duration_seconds: null,
      width: null,
      height: null,
      metadata: null,
    });
    await this.videoRepository.save(video);

    let uploadId: string | undefined;
    try {
      uploadId = await this.objectStorage.createMultipartUpload(
        video.object_key,
        video.content_type,
      );
      video.multipart_upload_id = uploadId;
      await this.videoRepository.save(video);
    } catch (error) {
      let cleanupFailed = false;
      let cleanupError: unknown;
      if (uploadId) {
        try {
          await this.objectStorage.abortMultipartUpload(
            video.object_key,
            uploadId,
          );
        } catch (caught) {
          cleanupFailed = true;
          cleanupError = caught;
        }
      }

      video.status = VideoStatus.ERROR;
      video.multipart_upload_id = null;
      await this.videoRepository.save(video);

      if (cleanupFailed) {
        throw new AggregateError(
          [error, cleanupError],
          'Video upload initialization and cleanup both failed',
        );
      }
      throw error;
    }

    return this.toUploadResponse(video);
  }

  async createPartUploadUrl(
    userId: string,
    videoId: string,
    partNumber: number,
  ): Promise<{
    uploadUrl: string;
    partNumber: number;
    expiresInSeconds: number;
  }> {
    const video = await this.findOwnedVideo(videoId, userId);
    if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
      throw new VideoUploadStateException(
        'Video does not have an active multipart upload',
      );
    }

    const partCount = this.partCount(video);
    if (
      !Number.isInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > partCount
    ) {
      throw new InvalidVideoUploadException('Part number is out of range');
    }

    return {
      uploadUrl: await this.objectStorage.createPartUploadUrl(
        video.object_key,
        video.multipart_upload_id,
        partNumber,
      ),
      partNumber,
      expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
    };
  }

  async completeUpload(
    userId: string,
    videoId: string,
  ): Promise<VideoUploadResponseDto> {
    const video = await this.findOwnedVideo(videoId, userId);

    if (video.status === VideoStatus.PROCESSING) {
      await this.videoQueue.enqueue(video.id);
      return this.toUploadResponse(video);
    }
    if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
      throw new VideoUploadStateException(
        'Video does not have an active multipart upload',
      );
    }

    const uploadId = video.multipart_upload_id;
    const parts = await this.objectStorage.listParts(
      video.object_key,
      uploadId,
    );
    const expectedPartCount = this.partCount(video);
    if (parts.length !== expectedPartCount) {
      throw new InvalidVideoUploadException(
        'All expected upload parts must be present',
      );
    }

    const completedParts: CompletedPart[] = parts.map((part, index) => {
      const expectedPartNumber = index + 1;
      const expectedSize = Math.min(
        VIDEO_PART_SIZE_BYTES,
        Number(video.file_size_bytes) - index * VIDEO_PART_SIZE_BYTES,
      );
      if (
        part.PartNumber !== expectedPartNumber ||
        part.Size !== expectedSize ||
        !part.ETag
      ) {
        throw new InvalidVideoUploadException(
          'Upload parts have an invalid number, size, or ETag',
        );
      }
      return { PartNumber: part.PartNumber, ETag: part.ETag };
    });

    try {
      await this.objectStorage.completeMultipartUpload(
        video.object_key,
        uploadId,
        completedParts,
      );
    } catch (error) {
      if (
        !(error instanceof S3ServiceException && error.name === 'NoSuchUpload')
      ) {
        throw error;
      }
      const completedObject = await this.objectStorage.headObject(
        video.object_key,
      );
      if (completedObject.size !== Number(video.file_size_bytes)) {
        throw error;
      }
    }

    video.multipart_upload_id = null;
    video.status = VideoStatus.PROCESSING;
    await this.videoRepository.save(video);
    await this.videoQueue.enqueue(video.id);

    return this.toUploadResponse(video);
  }

  async abortUpload(userId: string, videoId: string): Promise<void> {
    const video = await this.findOwnedVideo(videoId, userId);
    if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
      throw new VideoUploadStateException(
        'Video does not have an active multipart upload',
      );
    }

    await this.objectStorage.abortMultipartUpload(
      video.object_key,
      video.multipart_upload_id,
    );
    video.multipart_upload_id = null;
    video.status = VideoStatus.ERROR;
    await this.videoRepository.save(video);
  }

  async getPublicVideo(videoId: string): Promise<VideoResponseDto> {
    const video = await this.findReadyVideo(videoId);
    return this.toPublicResponse(video);
  }

  async getThumbnail(videoId: string): Promise<Readable> {
    const video = await this.findReadyVideo(videoId);
    if (!video.thumbnail_key) throw new VideoNotReadyException();
    return this.objectStorage.getObject(video.thumbnail_key);
  }

  async openVideoStream(
    videoId: string,
    rangeHeader?: string,
  ): Promise<VideoStream> {
    const video = await this.findReadyVideo(videoId);
    const fileSize = Number(video.file_size_bytes);
    if (!rangeHeader) {
      return {
        body: await this.objectStorage.getObject(video.object_key),
        contentType: video.content_type,
        contentLength: fileSize,
        contentRange: null,
        statusCode: 200,
      };
    }

    const range = parseVideoRange(rangeHeader, fileSize);
    if (!range) throw new VideoRangeNotSatisfiableException(fileSize);

    return {
      body: await this.objectStorage.getObject(
        video.object_key,
        `bytes=${range.start}-${range.end}`,
      ),
      contentType: video.content_type,
      contentLength: range.end - range.start + 1,
      contentRange: `bytes ${range.start}-${range.end}/${fileSize}`,
      statusCode: 206,
    };
  }

  async openDownload(
    videoId: string,
    rangeHeader?: string,
  ): Promise<VideoStream> {
    return this.openVideoStream(videoId, rangeHeader);
  }

  private async findOwnedVideo(
    videoId: string,
    userId: string,
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId, channel: { user_id: userId } },
      relations: { channel: true },
    });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  private async findReadyVideo(videoId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId, status: VideoStatus.READY },
    });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  private partCount(video: Video): number {
    return Math.ceil(Number(video.file_size_bytes) / VIDEO_PART_SIZE_BYTES);
  }

  private toUploadResponse(video: Video): VideoUploadResponseDto {
    return {
      id: video.id,
      title: video.title,
      partSizeBytes: VIDEO_PART_SIZE_BYTES,
      partCount: this.partCount(video),
      status: video.status,
    };
  }

  private toPublicResponse(video: Video): VideoResponseDto {
    return {
      id: video.id,
      originalFilename: video.original_filename,
      title: video.title,
      contentType: video.content_type,
      fileSizeBytes: Number(video.file_size_bytes),
      status: video.status,
      durationSeconds: video.duration_seconds,
      width: video.width,
      height: video.height,
      metadata: video.metadata,
      thumbnailUrl: `/videos/${video.id}/thumbnail`,
      streamUrl: `/videos/${video.id}/stream`,
      downloadUrl: `/videos/${video.id}/download`,
      createdAt: video.created_at,
    };
  }
}
