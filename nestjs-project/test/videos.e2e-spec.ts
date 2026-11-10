import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { Readable } from 'node:stream';
import request from 'supertest';
import { App } from 'supertest/types';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { User } from '../src/users/entities/user.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { VideoResponseDto } from '../src/videos/dto/video-response.dto';
import { VideoUploadResponseDto } from '../src/videos/dto/video-upload-response.dto';
import { ObjectStorageService } from '../src/videos/storage/object-storage.service';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VideoQueueService } from '../src/videos/video-queue.service';
import { VIDEO_PART_SIZE_BYTES } from '../src/videos/video.constants';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let throttlerStorage: ThrottlerStorageService;
  let accessToken: string;
  const storage = {
    createMultipartUpload: jest.fn(),
    createPartUploadUrl: jest.fn(),
    listParts: jest.fn(),
    completeMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
    headObject: jest.fn(),
    getObject: jest.fn(),
    putFile: jest.fn(),
  };
  const queue = { enqueue: jest.fn() };
  const createReadyVideo = async (overrides: Partial<Video> = {}) => {
    const channel = await channelRepository.findOneByOrFail({
      nickname: 'video-owner',
    });
    return videoRepository.save(
      videoRepository.create({
        original_filename: 'ready.mp4',
        title: 'Ready video',
        content_type: 'video/mp4',
        file_size_bytes: '11',
        status: VideoStatus.READY,
        object_key: `videos/${channel.id}/${randomUUID()}/original`,
        multipart_upload_id: null,
        thumbnail_key: 'thumbnails/ready.jpg',
        duration_seconds: 1,
        width: 320,
        height: 240,
        metadata: {
          formatName: 'mp4',
          videoCodec: 'mpeg4',
          audioCodec: null,
        },
        channel_id: channel.id,
        ...overrides,
      }),
    );
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ObjectStorageService)
      .useValue(storage)
      .overrideProvider(VideoQueueService)
      .useValue(queue)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    jest.clearAllMocks();
    throttlerStorage.storage.clear();
    storage.createMultipartUpload.mockResolvedValue('multipart-id');
    storage.createPartUploadUrl.mockResolvedValue('https://storage/part');
    storage.listParts.mockResolvedValue([
      { PartNumber: 1, Size: 10, ETag: '"etag"' },
    ]);
    storage.completeMultipartUpload.mockResolvedValue(undefined);
    storage.abortMultipartUpload.mockResolvedValue(undefined);
    storage.getObject.mockImplementation((_key, range?: string) =>
      Readable.from([range === 'bytes=0-4' ? 'hello' : 'hello world']),
    );
    queue.enqueue.mockResolvedValue(undefined);

    const user = await userRepository.save(
      userRepository.create({
        email: 'video-owner@example.com',
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    await channelRepository.save(
      channelRepository.create({
        name: 'video-owner',
        nickname: 'video-owner',
        user_id: user.id,
        description: null,
      }),
    );
    accessToken = app.get(JwtService).sign({ sub: user.id, email: user.email });
  });

  it('requires authentication to initiate uploads', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .send({
        originalFilename: 'sample.mp4',
        title: 'Sample video',
        contentType: 'video/mp4',
        fileSizeBytes: 10,
      })
      .expect(401);
  });

  it('creates a draft and returns a presigned URL for an upload part', async () => {
    const upload = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        originalFilename: 'sample.mp4',
        title: 'Sample video',
        contentType: 'video/mp4',
        fileSizeBytes: 10,
      })
      .expect(201);

    const uploadBody = upload.body as VideoUploadResponseDto;
    expect(typeof uploadBody.id).toBe('string');
    expect(uploadBody).toMatchObject({
      partSizeBytes: VIDEO_PART_SIZE_BYTES,
      partCount: 1,
      status: VideoStatus.DRAFT,
      title: 'Sample video',
    });

    const part = await request(app.getHttpServer())
      .post(`/videos/${uploadBody.id}/uploads/parts/1`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(part.body).toEqual({
      uploadUrl: 'https://storage/part',
      partNumber: 1,
      expiresInSeconds: 900,
    });
  });

  it('rejects upload sizes over 10 GB', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        originalFilename: 'oversized.mp4',
        title: 'Oversized video',
        contentType: 'video/mp4',
        fileSizeBytes: 10_000_000_001,
      })
      .expect(400);

    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('requires a non-empty title before creating the upload', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        originalFilename: 'sample.mp4',
        contentType: 'video/mp4',
        fileSizeBytes: 10,
      })
      .expect(400);

    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('does not allow another channel owner to manage an upload', async () => {
    const upload = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        originalFilename: 'sample.mp4',
        title: 'Sample video',
        contentType: 'video/mp4',
        fileSizeBytes: 10,
      })
      .expect(201);
    const uploadBody = upload.body as VideoUploadResponseDto;
    const otherUser = await userRepository.save(
      userRepository.create({
        email: 'other-owner@example.com',
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    await channelRepository.save(
      channelRepository.create({
        name: 'other-owner',
        nickname: 'other-owner',
        user_id: otherUser.id,
        description: null,
      }),
    );
    const otherAccessToken = app
      .get(JwtService)
      .sign({ sub: otherUser.id, email: otherUser.email });

    await request(app.getHttpServer())
      .post(`/videos/${uploadBody.id}/uploads/parts/1`)
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .expect(404);
    expect(storage.createPartUploadUrl).not.toHaveBeenCalled();
  });

  it('verifies remote parts before queueing processing', async () => {
    const upload = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        originalFilename: 'sample.mp4',
        title: 'Sample video',
        contentType: 'video/mp4',
        fileSizeBytes: 10,
      })
      .expect(201);
    const uploadBody = upload.body as VideoUploadResponseDto;
    storage.listParts.mockResolvedValue([]);

    await request(app.getHttpServer())
      .post(`/videos/${uploadBody.id}/uploads/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
    expect(queue.enqueue).not.toHaveBeenCalled();

    storage.listParts.mockResolvedValue([
      { PartNumber: 1, Size: 10, ETag: '"etag"' },
    ]);
    const completed = await request(app.getHttpServer())
      .post(`/videos/${uploadBody.id}/uploads/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect((completed.body as VideoUploadResponseDto).status).toBe(
      VideoStatus.PROCESSING,
    );
    expect(queue.enqueue).toHaveBeenCalledWith(uploadBody.id);
  });

  it('streams ready videos anonymously with byte-range headers', async () => {
    const video = await createReadyVideo();

    const response = await request(app.getHttpServer())
      .get(`/videos/${video.id}/stream`)
      .set('Range', 'bytes=0-4')
      .expect(206);

    expect(response.headers['content-range']).toBe('bytes 0-4/11');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(storage.getObject).toHaveBeenCalledWith(
      video.object_key,
      'bytes=0-4',
    );
  });

  it('returns 416 and Content-Range for an unsatisfiable request', async () => {
    const video = await createReadyVideo();

    await request(app.getHttpServer())
      .get(`/videos/${video.id}/stream`)
      .set('Range', 'bytes=11-20')
      .expect('Content-Range', 'bytes */11')
      .expect(416);

    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('returns safe metadata and delivery URLs without authentication', async () => {
    const video = await createReadyVideo();
    const response = await request(app.getHttpServer())
      .get(`/videos/${video.id}`)
      .expect(200);

    const videoResponse = response.body as VideoResponseDto;
    expect(videoResponse).toMatchObject({
      id: video.id,
      originalFilename: 'ready.mp4',
      title: 'Ready video',
      contentType: 'video/mp4',
      fileSizeBytes: 11,
      status: VideoStatus.READY,
      durationSeconds: 1,
      width: 320,
      height: 240,
      thumbnailUrl: `/videos/${video.id}/thumbnail`,
      streamUrl: `/videos/${video.id}/stream`,
      downloadUrl: `/videos/${video.id}/download`,
    });
    expect(Object.keys(videoResponse)).not.toContain('object_key');
    expect(Object.keys(videoResponse)).not.toContain('multipart_upload_id');
  });

  it('streams the generated thumbnail anonymously', async () => {
    const video = await createReadyVideo();
    const response = await request(app.getHttpServer())
      .get(`/videos/${video.id}/thumbnail`)
      .expect(200);

    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(storage.getObject).toHaveBeenCalledWith(video.thumbnail_key);
  });

  it('downloads the original video as an attachment', async () => {
    const video = await createReadyVideo();
    const response = await request(app.getHttpServer())
      .get(`/videos/${video.id}/download`)
      .expect(200);

    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="video-${video.id}"`,
    );
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(storage.getObject).toHaveBeenCalledWith(video.object_key);
  });
});
