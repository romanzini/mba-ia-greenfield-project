import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Repository } from 'typeorm';
import { ObjectStorageService } from './storage/object-storage.service';
import { Video, VideoMetadata, VideoStatus } from './entities/video.entity';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

interface ProbeOutput {
  format?: {
    duration?: string;
    format_name?: string;
  };
  streams?: ProbeStream[];
}

interface ProcessedVideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  metadata: VideoMetadata;
}

const MAX_PROBE_OUTPUT_BYTES = 1024 * 1024;
const MAX_ERROR_OUTPUT_CHARS = 4096;

@Injectable()
export class VideoProcessingService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async process(videoId: string): Promise<void> {
    const video = await this.videoRepository.findOneBy({ id: videoId });
    if (!video) throw new Error(`Video ${videoId} was not found`);
    if (video.status !== VideoStatus.PROCESSING) return;

    const workingDirectory = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const inputPath = join(workingDirectory, 'original');
    const thumbnailPath = join(workingDirectory, 'thumbnail.jpg');

    try {
      await pipeline(
        await this.objectStorage.getObject(video.object_key),
        createWriteStream(inputPath, { flags: 'wx' }),
      );

      const metadata = await this.readMetadata(inputPath);
      await this.createThumbnail(
        inputPath,
        thumbnailPath,
        metadata.durationSeconds,
      );

      const thumbnailSize = (await stat(thumbnailPath)).size;
      const thumbnailKey = `thumbnails/${video.channel_id}/${video.id}.jpg`;
      await this.objectStorage.putFile(
        thumbnailKey,
        thumbnailPath,
        'image/jpeg',
        thumbnailSize,
      );

      video.duration_seconds = metadata.durationSeconds;
      video.width = metadata.width;
      video.height = metadata.height;
      video.metadata = metadata.metadata;
      video.thumbnail_key = thumbnailKey;
      video.status = VideoStatus.READY;
      await this.videoRepository.save(video);
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  async markFailed(videoId: string): Promise<void> {
    const video = await this.videoRepository.findOneBy({ id: videoId });
    if (!video || video.status !== VideoStatus.PROCESSING) return;

    video.status = VideoStatus.ERROR;
    await this.videoRepository.save(video);
  }

  private async readMetadata(
    inputPath: string,
  ): Promise<ProcessedVideoMetadata> {
    const output = await this.runProcess('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration,format_name:stream=codec_type,codec_name,width,height',
      '-of',
      'json',
      inputPath,
    ]);
    const probe = JSON.parse(output) as ProbeOutput;
    const videoStream = probe.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    const durationSeconds = Number(probe.format?.duration);
    if (
      !videoStream ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds < 0 ||
      typeof videoStream.width !== 'number' ||
      !Number.isInteger(videoStream.width) ||
      typeof videoStream.height !== 'number' ||
      !Number.isInteger(videoStream.height)
    ) {
      throw new Error('FFprobe did not find valid video metadata');
    }

    const audioStream = probe.streams?.find(
      (stream) => stream.codec_type === 'audio',
    );
    return {
      durationSeconds,
      width: videoStream.width,
      height: videoStream.height,
      metadata: {
        formatName: probe.format?.format_name ?? null,
        videoCodec: videoStream.codec_name ?? null,
        audioCodec: audioStream?.codec_name ?? null,
      },
    };
  }

  private async createThumbnail(
    inputPath: string,
    thumbnailPath: string,
    durationSeconds: number,
  ): Promise<void> {
    const timestamp = Math.min(durationSeconds * 0.1, 5);
    await this.runProcess('ffmpeg', [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-ss',
      String(timestamp),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      "scale='min(1280,iw)':-2",
      thumbnailPath,
    ]);
  }

  private runProcess(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let errorOutput = '';
      let outputLimitExceeded = false;

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (output.length > MAX_PROBE_OUTPUT_BYTES) {
          outputLimitExceeded = true;
          child.kill('SIGKILL');
        }
      });
      child.stderr.on('data', (chunk: string) => {
        errorOutput = (errorOutput + chunk).slice(-MAX_ERROR_OUTPUT_CHARS);
      });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0 && !outputLimitExceeded) {
          resolve(output);
          return;
        }

        reject(
          new Error(
            `${command} failed (${signal ?? code}): ${
              outputLimitExceeded
                ? 'output exceeded the size limit'
                : errorOutput.trim()
            }`,
          ),
        );
      });
    });
  }
}
