/**
 * Snapshot the database and guest photos into backups/<date-time>/.
 * Safe to run while the server is running. Usage: npm run backup
 */
import '../server/env.ts';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const dbFile = path.join(dataDir, 'nextonstage.db');
if (!fs.existsSync(dbFile)) {
  console.error(`No database at ${dbFile}`);
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const out = path.resolve('backups', stamp);
fs.mkdirSync(out, { recursive: true });

// VACUUM INTO writes a consistent copy even while the app is writing.
const db = new DatabaseSync(dbFile);
db.exec(`VACUUM INTO '${path.join(out, 'nextonstage.db').replace(/'/g, "''")}'`);
db.close();

const avatars = path.join(dataDir, 'avatars');
if (fs.existsSync(avatars)) fs.cpSync(avatars, path.join(out, 'avatars'), { recursive: true });

console.log(`Backup saved to ${out}`);
