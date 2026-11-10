import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { promisify } from 'node:util';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Video, VideoStatus } from './entities/video.entity';
import { ObjectStorageService } from './storage/object-storage.service';
import { VideoProcessingService } from './video-processing.service';

const execFileAsync = promisify(execFile);

describe('VideoProcessingService (integration)', () => {
  let directory = '';

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'streamtube-video-test-'));
    await execFileAsync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=320x240:d=1',
      '-t',
      '1',
      '-c:v',
      'mpeg4',
      '-pix_fmt',
      'yuv420p',
      join(directory, 'source.mp4'),
    ]);
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('extracts metadata and generates a thumbnail using FFprobe and FFmpeg', async () => {
    const video: Video = Object.assign(new Video(), {
      id: 'b307a6b0-2a7f-4dc0-a535-95283af88791',
      object_key: 'videos/channel/video/original',
      channel_id: 'channel-id',
      status: VideoStatus.PROCESSING,
      duration_seconds: null,
      width: null,
      height: null,
      metadata: null,
      thumbnail_key: null,
    });
    const videoRepository = {
      findOneBy: jest.fn().mockResolvedValue(video),
      save: jest.fn((entity: Video) => Promise.resolve(entity)),
    };
    const objectStorage = {
      getObject: jest
        .fn()
        .mockImplementation(() =>
          createReadStream(join(directory, 'source.mp4')),
        ),
      putFile: jest.fn(async (_key: string, thumbnailPath: string) => {
        await access(thumbnailPath);
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoProcessingService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: ObjectStorageService, useValue: objectStorage },
      ],
    }).compile();
    const service = module.get(VideoProcessingService);

    try {
      await service.process(video.id);

      expect(video.status).toBe(VideoStatus.READY);
      expect(video.duration_seconds).toBeGreaterThan(0);
      expect(video.width).toBe(320);
      expect(video.height).toBe(240);
      expect(video.metadata?.videoCodec).toBe('mpeg4');
      expect(video.thumbnail_key).toBe(
        `thumbnails/${video.channel_id}/${video.id}.jpg`,
      );
      expect(objectStorage.putFile).toHaveBeenCalledWith(
        video.thumbnail_key,
        expect.any(String),
        'image/jpeg',
        expect.any(Number),
      );
      expect(videoRepository.save).toHaveBeenCalledWith(video);
    } finally {
      await module.close();
    }
  });
});
