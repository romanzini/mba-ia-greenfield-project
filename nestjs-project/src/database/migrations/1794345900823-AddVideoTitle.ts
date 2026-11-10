import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideoTitle1794345900823 implements MigrationInterface {
  name = 'AddVideoTitle1794345900823';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "title" character varying(255) NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `UPDATE "videos" SET "title" = COALESCE(NULLIF("original_filename", ''), 'Untitled video')`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "title" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "title"`);
  }
}
