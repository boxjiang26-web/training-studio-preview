import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresAdapter } from './db-postgres.mjs';
import { startServer } from './server-core.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || root;
const db = await createPostgresAdapter(process.env.DATABASE_URL);

startServer(db, { dataDir });
