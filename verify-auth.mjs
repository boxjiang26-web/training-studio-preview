import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'coach-secret-pass-2026!';

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + '/healthz');
      if (res.ok) return;
    } catch {
      // Wait for startup.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Auth test server did not become healthy');
}

const port = await findFreePort();
const base = `http://127.0.0.1:${port}`;
const tempDir = fs.mkdtempSync(path.join(root, '.tmp-verify-auth-'));
const server = spawn(process.execPath, [path.join(root, 'server.mjs')], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: tempDir,
    COACH_PASSWORD: SECRET,
    ALLOW_TRIAL_AUTH: '0',
  },
  stdio: 'ignore',
});

let browser;
try {
  await waitForHealth(base);

  // 1. Verify trial auth is disabled (403) when COACH_PASSWORD is active.
  const trialRes = await fetch(base + '/api/trial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(trialRes.status, 403, '/api/trial must be blocked in password auth mode');

  const modeRes = await (await fetch(base + '/api/auth/mode')).json();
  assert.equal(modeRes.mode, 'password');
  assert.equal(modeRes.trialEnabled, false);
  assert.equal(modeRes.authenticated, false);

  browser = await chromium.launch({ channel: 'chrome' });

  // 2. Coach login flow via HttpOnly cookie.
  const coachCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const coachPage = await coachCtx.newPage();
  await coachPage.goto(base);
  await coachPage.getByRole('heading', { name: '练记 · 教练登录' }).waitFor();

  await coachPage.getByLabel('教练密码').fill('wrong-password');
  await coachPage.getByRole('button', { name: '登录工作台' }).click();
  await coachPage.getByText('教练密码错误').waitFor();

  await coachPage.getByLabel('教练密码').fill(SECRET);
  await coachPage.getByRole('button', { name: '登录工作台' }).click();
  await coachPage.getByRole('heading', { level: 1, name: '训练编排', exact: true }).waitFor();

  // Confirm cookie is HttpOnly (not readable from document.cookie).
  const docCookie = await coachPage.evaluate(() => document.cookie);
  assert.equal(docCookie.includes('studio_session'), false, 'Session cookie must be HttpOnly');

  // 3. Create student and generate 7-day invite link.
  await coachPage.getByText('新建学员档案', { exact: true }).click();
  await coachPage.getByLabel('新学员姓名').fill('正式邀请学员');
  await coachPage.getByRole('button', { name: '建立档案' }).click();
  await coachPage.waitForFunction(
    () => document.querySelector('select[aria-label="当前学员"]')?.selectedOptions[0]?.textContent?.includes('正式邀请学员')
  );

  await coachPage.getByText('学员邀请与设备管理', { exact: true }).click();
  await coachPage.getByRole('button', { name: '生成 7 天邀请链接' }).click();
  const invite1 = await coachPage.getByLabel('学员专属邀请链接').inputValue();
  assert.ok(invite1.startsWith(base + '/?invite='));

  // Regenerating invite invalidates invite1.
  await coachPage.getByRole('button', { name: '生成 7 天邀请链接' }).click();
  await coachPage.waitForFunction(
    (oldUrl) => {
      const el = document.querySelector('input[aria-label="学员专属邀请链接"]');
      return el && el.value && el.value !== oldUrl;
    },
    invite1
  );
  const invite2 = await coachPage.getByLabel('学员专属邀请链接').inputValue();
  assert.notEqual(invite1, invite2);

  const oldRedeem = await fetch(base + '/api/auth/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite: new URL(invite1).searchParams.get('invite') }),
  });
  assert.equal(oldRedeem.status, 401, 'Old invite link must be invalidated upon regeneration');

  // 4. Student opens invite2 in a fresh mobile browser context -> binds 30-day HttpOnly cookie.
  const studentCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const studentPage = await studentCtx.newPage();
  await studentPage.goto(invite2);
  await studentPage.getByRole('heading', { level: 1, name: '我的训练', exact: true }).waitFor();
  assert.equal(studentPage.url().includes('invite='), false, 'Invite token must be stripped from URL');

  // Student cannot access coach API.
  const coachApiStatus = await studentPage.evaluate(async () => {
    const r = await fetch('/api/coach/overview?day=2026-11-25');
    return r.status;
  });
  assert.equal(coachApiStatus, 403, 'Student cookie must not access coach routes');

  // 5. Coach revokes student access -> student session is immediately invalidated on reload.
  await coachPage.getByRole('button', { name: '撤销邀请并下线设备' }).click();
  await coachPage.getByText('已撤销该学员邀请链接并下线全部已登录设备').waitFor();

  await studentPage.reload();
  await studentPage.getByRole('heading', { name: '练记 · 教练登录' }).waitFor();

  // 6. Coach logout clears session.
  await coachPage.getByRole('button', { name: '退出登录' }).click();
  await coachPage.getByRole('heading', { name: '练记 · 教练登录' }).waitFor();

  console.log('PASS TASK-009 Auth: trial disabled (403), HttpOnly coach login/logout, 7-day resettable student invite, student isolation (403), immediate device revocation');
} finally {
  if (browser) await browser.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
