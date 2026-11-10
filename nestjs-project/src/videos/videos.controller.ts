import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import {
  UploadPartUrlResponseDto,
  VideoUploadResponseDto,
} from './dto/video-upload-response.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { VideoStream, VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('uploads')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Creates a draft video and a multipart upload session without sending the video body to the API.',
  })
  @ApiResponse({ status: 201, type: VideoUploadResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid metadata or file size',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Channel not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  startUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoUploadDto,
  ): Promise<VideoUploadResponseDto> {
    return this.videosService.startUpload(user.sub, dto);
  }

  @Post(':id/uploads/parts/:partNumber')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create a presigned URL for an upload part',
    description:
      'Returns a short-lived URL so the client can upload one part directly to private object storage.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: UploadPartUrlResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Part number is out of range',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Upload is not active',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  createPartUploadUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) videoId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
  ): Promise<UploadPartUrlResponseDto> {
    return this.videosService.createPartUploadUrl(
      user.sub,
      videoId,
      partNumber,
    );
  }

  @Post(':id/uploads/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Verifies all multipart parts in object storage and queues asynchronous processing.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: VideoUploadResponseDto })
  @ApiResponse({
    status: 400,
    description: 'One or more upload parts are missing or invalid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Upload is not active',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) videoId: string,
  ): Promise<VideoUploadResponseDto> {
    return this.videosService.completeUpload(user.sub, videoId);
  }

  @Delete(':id/uploads')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Abort a video upload',
    description:
      'Aborts the active multipart upload and marks the draft failed.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Upload aborted' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Upload is not active',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) videoId: string,
  ): Promise<void> {
    return this.videosService.abortUpload(user.sub, videoId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get public video metadata',
    description: 'Returns metadata and stable delivery URLs for a ready video.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: VideoResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  getVideo(
    @Param('id', ParseUUIDPipe) videoId: string,
  ): Promise<VideoResponseDto> {
    return this.videosService.getPublicVideo(videoId);
  }

  @Public()
  @Get(':id/thumbnail')
  @ApiProduces('image/jpeg')
  @ApiOperation({
    summary: 'Get a video thumbnail',
    description: 'Streams the generated JPEG thumbnail for a ready video.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'JPEG thumbnail',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: 404,
    description: 'Video or thumbnail not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getThumbnail(
    @Param('id', ParseUUIDPipe) videoId: string,
  ): Promise<StreamableFile> {
    return new StreamableFile(await this.videosService.getThumbnail(videoId), {
      type: 'image/jpeg',
    });
  }

  @Public()
  @Get(':id/stream')
  @ApiOperation({
    summary: 'Stream a ready video',
    description:
      'Streams the private video object and supports a single HTTP byte range.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Video content',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: 206,
    description: 'Partial video content',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: 416,
    description: 'Requested byte range is invalid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @Param('id', ParseUUIDPipe) videoId: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const stream = await this.videosService.openVideoStream(videoId, range);
    return this.toStreamableFile(stream, response, false, videoId);
  }

  @Public()
  @Get(':id/download')
  @ApiOperation({
    summary: 'Download a ready video',
    description:
      'Downloads the original video as an attachment and supports a single HTTP byte range.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Original video attachment',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: 206,
    description: 'Partial video attachment',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: 416,
    description: 'Requested byte range is invalid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @Param('id', ParseUUIDPipe) videoId: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const stream = await this.videosService.openDownload(videoId, range);
    return this.toStreamableFile(stream, response, true, videoId);
  }

  private toStreamableFile(
    stream: VideoStream,
    response: Response,
    download: boolean,
    videoId: string,
  ): StreamableFile {
    response.status(stream.statusCode);
    response.setHeader('Accept-Ranges', 'bytes');
    if (stream.contentRange) {
      response.setHeader('Content-Range', stream.contentRange);
    }

    return new StreamableFile(stream.body, {
      type: stream.contentType,
      length: stream.contentLength,
      disposition: download
        ? `attachment; filename="video-${videoId}"`
        : 'inline',
    });
  }
}
