import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type CompletedPart,
  type Part,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import videoStorageConfig from '../../config/video-storage.config';

export const VIDEO_S3_CLIENT = Symbol('VIDEO_S3_CLIENT');
export const VIDEO_S3_PRESIGN_CLIENT = Symbol('VIDEO_S3_PRESIGN_CLIENT');

export interface StoredObjectMetadata {
  size: number;
  contentType: string;
}

@Injectable()
export class ObjectStorageService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(VIDEO_S3_CLIENT) private readonly client: S3Client,
    @Inject(VIDEO_S3_PRESIGN_CLIENT)
    private readonly presignClient: S3Client,
    @Inject(videoStorageConfig.KEY)
    private readonly config: ConfigType<typeof videoStorageConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.createBucket) return;

    try {
      await this.client.send(
        new CreateBucketCommand({ Bucket: this.config.bucket }),
      );
    } catch (error) {
      if (
        !(
          error instanceof S3ServiceException &&
          ['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(
            error.name,
          )
        )
      ) {
        throw error;
      }
    }
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );

    if (!result.UploadId) {
      throw new Error('S3 did not return a multipart upload ID');
    }

    return result.UploadId;
  }

  createPartUploadUrl(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: 900 },
    );
  }

  async listParts(key: string, uploadId: string): Promise<Part[]> {
    const result = await this.client.send(
      new ListPartsCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        MaxParts: 1000,
      }),
    );

    if (result.IsTruncated) {
      throw new Error('Multipart upload exceeds the supported part count');
    }

    return result.Parts ?? [];
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async headObject(key: string): Promise<StoredObjectMetadata> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (result.ContentLength === undefined || !result.ContentType) {
      throw new Error('Stored video is missing size or content type metadata');
    }

    return { size: result.ContentLength, contentType: result.ContentType };
  }

  async getObject(key: string, range?: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Range: range,
      }),
    );

    if (!(result.Body instanceof Readable)) {
      throw new Error('S3 response did not contain a readable object stream');
    }

    return result.Body;
  }

  async putFile(
    key: string,
    path: string,
    contentType: string,
    size: number,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }

  onModuleDestroy(): void {
    this.client.destroy();
    this.presignClient.destroy();
  }
}
