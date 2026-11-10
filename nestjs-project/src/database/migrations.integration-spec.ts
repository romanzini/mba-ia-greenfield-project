import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Video } from '../videos/entities/video.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794335129826 } from './migrations/1794335129826-CreateVideos';
import { AddVideoTitle1794345900823 } from './migrations/1794345900823-AddVideoTitle';
import { createTestDataSource } from '../test/create-test-data-source';

const MANAGED_TABLES = [
  'users',
  'channels',
  'videos',
  'refresh_tokens',
  'verification_tokens',
];
const MANAGED_TYPES = ['verification_tokens_type_enum', 'videos_status_enum'];

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, Video, RefreshToken, VerificationToken],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1794335129826,
          AddVideoTitle1794345900823,
        ],
      },
    );

    await dataSource.initialize();

    for (const table of MANAGED_TABLES) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    await dataSource.query(`DROP TABLE IF EXISTS "migrations" CASCADE`);
    for (const type of MANAGED_TYPES) {
      await dataSource.query(`DROP TYPE IF EXISTS "${type}"`);
    }
  });

  afterAll(async () => {
    // The second test undoes the last migration, leaving token tables missing.
    // Re-apply so the shared DB is fully migrated when subsequent suites run.
    await dataSource.runMigrations();
    await dataSource.destroy();
  });

  it('should apply all migrations and create all five tables including video title', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(4);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'videos',
    ]);

    const videoColumns = await dataSource.query<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'videos'
         AND column_name = 'title'`,
    );
    expect(videoColumns).toHaveLength(1);
  });

  it('should revert the title migration without dropping videos', async () => {
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['videos']],
    );
    expect(result).toHaveLength(1);

    const videoTitleColumn = await dataSource.query<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'videos'
         AND column_name = 'title'`,
    );
    expect(videoTitleColumn).toHaveLength(0);
  });

  it('should backfill titles for videos that predate the title column', async () => {
    const [user] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO "users" ("email", "password", "is_confirmed")
       VALUES ('legacy-video-owner@example.com', 'hashed-password', true)
       RETURNING "id"`,
    );
    const [channel] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO "channels" ("name", "nickname", "user_id")
       VALUES ('Legacy owner', 'legacy-owner', $1)
       RETURNING "id"`,
      [user.id],
    );
    await dataSource.query(
      `INSERT INTO "videos"
         ("original_filename", "content_type", "file_size_bytes", "object_key", "channel_id")
       VALUES ('legacy.mp4', 'video/mp4', 10, 'videos/legacy/original', $1)`,
      [channel.id],
    );

    await dataSource.runMigrations();

    const [video] = await dataSource.query<{ title: string }[]>(
      `SELECT "title" FROM "videos" WHERE "object_key" = 'videos/legacy/original'`,
    );
    expect(video.title).toBe('legacy.mp4');
  });
});
