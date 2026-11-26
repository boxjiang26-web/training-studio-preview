import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteAdapter } from './db-sqlite.mjs';
import { startServer } from './server-core.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const db = createSqliteAdapter(dataDir);

startServer(db, { dataDir });
