import { registerAs } from '@nestjs/config';

export default registerAs('videoStorage', () => ({
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT || 'http://minio:9000',
  publicEndpoint:
    process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT || 'http://localhost:9000',
  region: process.env.OBJECT_STORAGE_REGION || 'us-east-1',
  bucket: process.env.OBJECT_STORAGE_BUCKET || 'streamtube-videos',
  accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID || 'minioadmin',
  secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || 'minioadmin',
  createBucket:
    process.env.OBJECT_STORAGE_CREATE_BUCKET !== undefined
      ? process.env.OBJECT_STORAGE_CREATE_BUCKET === 'true'
      : process.env.NODE_ENV !== 'production',
}));
