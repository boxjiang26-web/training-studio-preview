import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { coachSchema } from './coach-tools.mjs';
import { messageSchema } from './messages.mjs';
import { customExerciseSchema } from './strength.mjs';
import { readinessSchema } from './readiness.mjs';

const CORE_SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY,
  name TEXT,
  invite TEXT,
  expires INTEGER,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  owner INTEGER,
  expires INTEGER
);
CREATE TABLE IF NOT EXISTS drafts(
  owner INTEGER,
  day TEXT,
  rev INTEGER,
  items TEXT,
  PRIMARY KEY(owner, day)
);
CREATE TABLE IF NOT EXISTS plans(
  id INTEGER PRIMARY KEY,
  owner INTEGER,
  day TEXT,
  rev INTEGER,
  items TEXT,
  UNIQUE(owner, day, rev)
);
CREATE TABLE IF NOT EXISTS feedback(
  id TEXT PRIMARY KEY,
  plan INTEGER UNIQUE,
  rpe INTEGER,
  note TEXT,
  sets TEXT,
  set_logs TEXT
);
`;

const INDEX_SCHEMA = `
CREATE INDEX IF NOT EXISTS plans_owner_day_rev ON plans(owner, day, rev);
CREATE INDEX IF NOT EXISTS assessments_student_day ON assessments(student, day);
CREATE INDEX IF NOT EXISTS training_cycles_student_start ON training_cycles(student, start_day);
CREATE INDEX IF NOT EXISTS training_memory_student_created ON training_memory(student, created);
`;

export function createSqliteAdapter(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'studio.sqlite'));
  db.exec(CORE_SCHEMA);
  db.exec(coachSchema + messageSchema(false) + customExerciseSchema + readinessSchema);
  const studentCols = db.prepare('PRAGMA table_info(students)').all();
  if (!studentCols.some((col) => col.name === 'archived')) {
    db.exec('ALTER TABLE students ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  }
  const feedbackCols = db.prepare('PRAGMA table_info(feedback)').all();
  if (!feedbackCols.some((col) => col.name === 'set_logs')) {
    db.exec('ALTER TABLE feedback ADD COLUMN set_logs TEXT');
  }
  db.exec(INDEX_SCHEMA);

  const one = (sqlText, ...values) => db.prepare(sqlText).get(...values);
  const all = (sqlText, ...values) => db.prepare(sqlText).all(...values);
  const run = (sqlText, ...values) => db.prepare(sqlText).run(...values);

  const createStudent = (name) => Number(run('INSERT INTO students(name) VALUES(?)', name).lastInsertRowid);
  const upsertDraft = (owner, day, rev, itemsJson) =>
    run('INSERT OR REPLACE INTO drafts VALUES(?,?,?,?)', owner, day, rev, itemsJson);
  const insertPlanIfAbsent = (owner, day, rev, itemsJson) =>
    run('INSERT OR IGNORE INTO plans(owner,day,rev,items) VALUES(?,?,?,?)', owner, day, rev, itemsJson);

  const ops = {
    one,
    all,
    run,
    createStudent,
    upsertDraft,
    insertPlanIfAbsent,
  };

  let txQueue = Promise.resolve();

  function transaction(isWrite, callback) {
    const task = txQueue.then(async () => {
      db.exec(isWrite ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try {
        const result = await callback(ops);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Ignore secondary rollback error if transaction was already closed.
        }
        throw error;
      }
    });
    txQueue = task.catch(() => {});
    return task;
  }

  return {
    ...ops,
    transaction,
    close: () => db.close(),
  };
}
