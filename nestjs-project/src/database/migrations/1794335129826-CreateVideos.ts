import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1794335129826 implements MigrationInterface {
  name = 'CreateVideos1794335129826';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "original_filename" character varying(255) NOT NULL, "content_type" character varying(100) NOT NULL, "file_size_bytes" bigint NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "object_key" character varying NOT NULL, "multipart_upload_id" character varying, "thumbnail_key" character varying, "duration_seconds" double precision, "width" integer, "height" integer, "metadata" jsonb, "channel_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_5c8d5988bc60abb9f7b5d14371d" UNIQUE ("object_key"), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_350c48c9093177350f2c50e650" ON "videos" ("channel_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_350c48c9093177350f2c50e650"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
