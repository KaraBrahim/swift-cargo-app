// Test orchestrator. Boots ONE embedded Postgres (this process owns its whole
// lifecycle), exposes it via DATABASE_URL, runs `node --test` in a child that
// connects to it, then guarantees teardown + a hard exit — so a slow Postgres
// shutdown can never hang the run or orphan a server.
import './testCredentials.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { startEmbeddedPg } from '../src/db/embedded.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '.test-pgdata');
const PORT = 55521;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
}

let embedded;
let code = 1;
try {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  embedded = await startEmbeddedPg({ dataDir, port: PORT, persistent: false });

  code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', 'test/*.test.js'], {
      cwd: join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: embedded.connectionString, USE_EMBEDDED_PG: '0' },
      stdio: 'inherit',
      shell: false,
    });
    child.on('exit', (c) => resolve(c ?? 1));
    child.on('error', () => resolve(1));
  });
} catch (e) {
  console.error('Test bootstrap failed:', e);
} finally {
  if (embedded) await withTimeout(embedded.stop(), 8000);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(code);
}
