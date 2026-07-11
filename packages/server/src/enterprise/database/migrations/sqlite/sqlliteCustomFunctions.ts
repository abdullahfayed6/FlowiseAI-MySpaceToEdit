import { QueryRunner } from 'typeorm'

export const ensureColumnExists = async (
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string,
    columnType: string // Accept column type as a parameter
): Promise<void> => {
    // Check if table exists in sqlite_master first to avoid error on fresh databases where synchronizer hasn't run yet
    const tableCheck = await queryRunner.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`)
    if (tableCheck.length === 0) {
        return
    }

    // Retrieve column information from the specified table
    const columns = await queryRunner.query(`PRAGMA table_info(${tableName});`)

    // Check if the specified column exists
    const columnExists = columns.some((col: any) => col.name === columnName)

    // Check if the specified column exists in the returned columns
    if (!columnExists) {
        // Add the column if it does not exist
        await queryRunner.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType};`)
    }
}
