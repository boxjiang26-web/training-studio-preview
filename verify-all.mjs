import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const includeAi = process.argv.includes('--include-ai');
const externalUrl = process.env.STUDIO_URL;

const CORE_SCRIPTS = [
  'verify-phase0.mjs',
  'verify-strength.mjs',
  'verify-crud.mjs',
  'verify-ai-retrieval.mjs',
  'verify-ui-ux.mjs',
  'verify-readiness.mjs',
  'verify-auth.mjs',
  'verify-copilot.mjs',
  'verify.mjs',
  'verify-library.mjs',
  'verify-teams.mjs',
  'verify-assessments.mjs',
  'verify-report.mjs',
  'verify-messages.mjs',
  'verify-cycles.mjs',
];

const AI_SCRIPTS = [
  'verify-ai.mjs',
  'verify-memory.mjs',
  'verify-cycle-ai.mjs',
  'verify-cycle-review.mjs',
  'verify-cycle-reports.mjs',
];

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + '/healthz');
      if (res.ok) return;
    } catch {
      // Wait for server startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become healthy at ${baseUrl}`);
}

function runScript(scriptName, env) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== Running ${scriptName} ===`);
    const child = spawn(process.execPath, [path.join(root, scriptName)], {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

let tempDataDir = '';
let serverProcess = null;

try {
  let studioUrl = externalUrl;
  if (!studioUrl) {
    const port = await findFreePort();
    studioUrl = `http://127.0.0.1:${port}`;
    tempDataDir = fs.mkdtempSync(path.join(root, '.tmp-verify-'));
    console.log(`Starting isolated server at ${studioUrl} (DATA_DIR=${tempDataDir})`);

    serverProcess = spawn(process.execPath, [path.join(root, 'server.mjs')], {
      cwd: root,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: tempDataDir },
      stdio: 'inherit',
    });
    await waitForHealth(studioUrl);
  }

  const scripts = includeAi ? [...CORE_SCRIPTS, ...AI_SCRIPTS] : CORE_SCRIPTS;
  const runEnv = { ...process.env, STUDIO_URL: studioUrl };

  for (const script of scripts) {
    await runScript(script, runEnv);
  }

  console.log(`\nALL ${scripts.length} VERIFICATION SCRIPTS PASSED.`);
} finally {
  if (serverProcess) {
    serverProcess.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (tempDataDir) {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}
