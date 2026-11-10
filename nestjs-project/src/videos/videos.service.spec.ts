import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { ObjectStorageService } from './storage/object-storage.service';
import { VIDEO_PART_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES } from './video.constants';
import { VideoQueueService } from './video-queue.service';
import { VideosService } from './videos.service';

function createVideo(overrides: Partial<Video> = {}): Video {
  return Object.assign(new Video(), {
    id: 'b307a6b0-2a7f-4dc0-a535-95283af88791',
    original_filename: 'sample.mp4',
    title: 'Sample video',
    content_type: 'video/mp4',
    file_size_bytes: '10',
    status: VideoStatus.DRAFT,
    object_key: 'videos/channel-id/video-id/original',
    multipart_upload_id: 'upload-id',
    thumbnail_key: null,
    duration_seconds: null,
    width: null,
    height: null,
    metadata: null,
    channel_id: 'channel-id',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });
}

describe('VideosService', () => {
  let module: TestingModule;
  let service: VideosService;
  let videoRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let channelRepository: { findOne: jest.Mock };
  let objectStorage: {
    createMultipartUpload: jest.Mock;
    createPartUploadUrl: jest.Mock;
    listParts: jest.Mock;
    completeMultipartUpload: jest.Mock;
    abortMultipartUpload: jest.Mock;
    headObject: jest.Mock;
    getObject: jest.Mock;
  };
  let videoQueue: { enqueue: jest.Mock };

  beforeEach(async () => {
    const newVideo = createVideo({ multipart_upload_id: null });
    videoRepository = {
      create: jest.fn((data: Partial<Video>) =>
        Object.assign(newVideo, data, { id: data.id ?? newVideo.id }),
      ),
      save: jest.fn((video: Video) => Promise.resolve(video)),
      findOne: jest.fn(),
    };
    channelRepository = { findOne: jest.fn() };
    objectStorage = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-id'),
      createPartUploadUrl: jest.fn().mockResolvedValue('https://storage/part'),
      listParts: jest.fn(),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn(),
      getObject: jest.fn(),
    };
    videoQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };

    module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: getRepositoryToken(Channel), useValue: channelRepository },
        { provide: ObjectStorageService, useValue: objectStorage },
        { provide: VideoQueueService, useValue: videoQueue },
      ],
    }).compile();
    service = module.get(VideosService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('rejects uploads larger than 10 GB before creating resources', async () => {
    await expect(
      service.startUpload('user-id', {
        originalFilename: 'large.mp4',
        title: 'Large video',
        contentType: 'video/mp4',
        fileSizeBytes: MAX_VIDEO_SIZE_BYTES + 1,
      }),
    ).rejects.toThrow('10 GB');

    expect(channelRepository.findOne).not.toHaveBeenCalled();
    expect(objectStorage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('creates a draft and multipart session owned by the user channel', async () => {
    channelRepository.findOne.mockResolvedValue({ id: 'channel-id' });

    const result = await service.startUpload('user-id', {
      originalFilename: 'sample.mp4',
      title: '  Sample title  ',
      contentType: 'video/mp4',
      fileSizeBytes: 10,
    });

    expect(typeof result.id).toBe('string');
    expect(result).toMatchObject({
      partSizeBytes: VIDEO_PART_SIZE_BYTES,
      partCount: 1,
      status: VideoStatus.DRAFT,
      title: 'Sample title',
    });
    expect(videoRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.id,
        title: 'Sample title',
        object_key: `videos/channel-id/${result.id}/original`,
      }),
    );
    expect(objectStorage.createMultipartUpload).toHaveBeenCalledWith(
      `videos/channel-id/${result.id}/original`,
      'video/mp4',
    );
    expect(videoRepository.save).toHaveBeenCalledTimes(2);
  });

  it('does not create presigned URLs for videos owned by another user', async () => {
    videoRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createPartUploadUrl(
        'other-user',
        'b307a6b0-2a7f-4dc0-a535-95283af88791',
        1,
      ),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    expect(objectStorage.createPartUploadUrl).not.toHaveBeenCalled();
  });

  it('validates all stored parts before completing an upload', async () => {
    videoRepository.findOne.mockResolvedValue(
      createVideo({ file_size_bytes: '10' }),
    );
    objectStorage.listParts.mockResolvedValue([
      { PartNumber: 1, Size: 9, ETag: '"etag"' },
    ]);

    await expect(
      service.completeUpload('user-id', 'b307a6b0-2a7f-4dc0-a535-95283af88791'),
    ).rejects.toThrow('invalid number, size, or ETag');
    expect(objectStorage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(videoQueue.enqueue).not.toHaveBeenCalled();
  });

  it('completes the multipart upload and enqueues the video once', async () => {
    const video = createVideo();
    videoRepository.findOne.mockResolvedValue(video);
    objectStorage.listParts.mockResolvedValue([
      { PartNumber: 1, Size: 10, ETag: '"etag"' },
    ]);

    const result = await service.completeUpload('user-id', video.id);

    expect(result.status).toBe(VideoStatus.PROCESSING);
    expect(objectStorage.completeMultipartUpload).toHaveBeenCalledWith(
      video.object_key,
      'upload-id',
      [{ PartNumber: 1, ETag: '"etag"' }],
    );
    expect(videoQueue.enqueue).toHaveBeenCalledWith(video.id);
  });
});
