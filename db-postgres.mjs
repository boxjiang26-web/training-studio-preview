import pg from 'pg';
import { coachSchema } from './coach-tools.mjs';
import { messageSchema } from './messages.mjs';
import { customExerciseSchema } from './strength.mjs';
import { readinessSchema } from './readiness.mjs';

const { Pool } = pg;

const CORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS students(
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  invite TEXT,
  expires BIGINT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  owner INTEGER NOT NULL,
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts(
  owner INTEGER NOT NULL,
  day TEXT NOT NULL,
  rev INTEGER NOT NULL,
  items JSONB NOT NULL,
  PRIMARY KEY(owner, day)
);
CREATE TABLE IF NOT EXISTS plans(
  id SERIAL PRIMARY KEY,
  owner INTEGER NOT NULL,
  day TEXT NOT NULL,
  rev INTEGER NOT NULL,
  items JSONB NOT NULL,
  UNIQUE(owner, day, rev)
);
CREATE TABLE IF NOT EXISTS feedback(
  id TEXT PRIMARY KEY,
  plan INTEGER UNIQUE NOT NULL,
  rpe INTEGER NOT NULL,
  note TEXT NOT NULL,
  sets JSONB NOT NULL,
  set_logs JSONB
);
`;

const INDEX_SCHEMA = `
CREATE INDEX IF NOT EXISTS plans_owner_day_rev ON plans(owner, day, rev);
CREATE INDEX IF NOT EXISTS assessments_student_day ON assessments(student, day);
CREATE INDEX IF NOT EXISTS training_cycles_student_start ON training_cycles(student, start_day);
CREATE INDEX IF NOT EXISTS training_memory_student_created ON training_memory(student, created);
`;

export function convertPlaceholders(sqlText) {
  let index = 0;
  return sqlText.replace(/\?/g, () => `$${++index}`);
}

function resolveSslOption(connectionString) {
  if (process.env.PGSSLMODE === 'disable') return false;
  if (connectionString && /(?:@|\/\/)(?:localhost|127\.0\.0\.1)(?::|\/)/i.test(connectionString)) {
    return process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false;
  }
  return { rejectUnauthorized: false };
}

function bindClientOps(queryable) {
  const execute = (sqlText, values = []) => queryable.query(convertPlaceholders(sqlText), values);
  const one = async (sqlText, ...values) => (await execute(sqlText, values)).rows[0];
  const all = async (sqlText, ...values) => (await execute(sqlText, values)).rows;
  const run = async (sqlText, ...values) => execute(sqlText, values);

  const createStudent = async (name) => {
    const row = await one('INSERT INTO students(name) VALUES(?) RETURNING id', name);
    return Number(row.id);
  };

  const upsertDraft = async (owner, day, rev, itemsJson) =>
    run(
      'INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(owner,day) DO UPDATE SET rev=EXCLUDED.rev, items=EXCLUDED.items',
      owner,
      day,
      rev,
      itemsJson
    );

  const insertPlanIfAbsent = async (owner, day, rev, itemsJson) =>
    run(
      'INSERT INTO plans(owner,day,rev,items) VALUES(?,?,?,?) ON CONFLICT(owner,day,rev) DO NOTHING',
      owner,
      day,
      rev,
      itemsJson
    );

  return {
    one,
    all,
    run,
    createStudent,
    upsertDraft,
    insertPlanIfAbsent,
  };
}

export async function createPostgresAdapter(connectionString = process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString,
    ssl: resolveSslOption(connectionString),
  });

  await pool.query(CORE_SCHEMA);
  await pool.query(coachSchema + messageSchema(true) + customExerciseSchema + readinessSchema);
  await pool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS archived INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE feedback ADD COLUMN IF NOT EXISTS set_logs JSONB');
  await pool.query(INDEX_SCHEMA);

  const poolOps = bindClientOps(pool);

  async function transaction(_isWrite, callback) {
    const client = await pool.connect();
    const txOps = bindClientOps(client);
    try {
      await client.query('BEGIN');
      const result = await callback(txOps);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    ...poolOps,
    transaction,
    close: () => pool.end(),
  };
}
