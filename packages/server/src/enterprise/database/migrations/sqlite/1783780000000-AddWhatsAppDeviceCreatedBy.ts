import { MigrationInterface, QueryRunner } from 'typeorm'
import { ensureColumnExists } from './sqlliteCustomFunctions'

export class AddWhatsAppDeviceCreatedBy1783780000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await ensureColumnExists(queryRunner, 'whatsapp_device', 'createdBy', 'TEXT')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        try {
            await queryRunner.query(`ALTER TABLE "whatsapp_device" DROP COLUMN "createdBy";`)
        } catch (e) {}
    }
}
