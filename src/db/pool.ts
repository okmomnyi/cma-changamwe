import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { NAIROBI } from '../util/time.js';
const { Pool, types } = pg;
types.setTypeParser(types.builtins.DATE, (value: string) => value);
const serverless = env.SERVERLESS === true;
export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: serverless ? 1 : 10,
    idleTimeoutMillis: serverless ? 10000 : 30000,
    connectionTimeoutMillis: 10000,
    application_name: 'cma-changamwe',
    options: `-c timezone=${NAIROBI}`,
});
pool.on('error', (err) => {
    logger.error({ err }, 'idle postgres client error');
});
export type Queryable = Pick<pg.PoolClient, 'query'>;
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: readonly unknown[] = [], client: Queryable = pool): Promise<pg.QueryResult<T>> {
    return client.query<T>(text, params as unknown[]);
}
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: readonly unknown[] = [], client: Queryable = pool): Promise<T | null> {
    const res = await query<T>(text, params, client);
    return res.rows[0] ?? null;
}
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        try {
            await client.query('ROLLBACK');
        }
        catch (rollbackErr) {
            logger.error({ err: rollbackErr }, 'rollback failed');
        }
        throw err;
    }
    finally {
        client.release();
    }
}
export async function closePool(): Promise<void> {
    await pool.end();
}
