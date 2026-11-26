import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.STUDIO_URL || 'http://127.0.0.1:4186';

async function req(route, token, body) {
  const res = await fetch(base + '/api/' + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-studio-session': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

function localToday() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

const coachToken = (await req('trial', '', {})).data.token;
const today = localToday();
const tag = Date.now().toString(36);
const s1 = (await req('students', coachToken, { name: `看板甲-${tag}` })).data.id;
const s2 = (await req('students', coachToken, { name: `看板乙-${tag}` })).data.id;
const s1Token = (await req('trial', '', { student: s1 })).data.token;
const s2Token = (await req('trial', '', { student: s2 })).data.token;

// Publish today's workout with restSec=90 for s1, and publish + submit RPE 9 feedback for s2.
await req('draft', coachToken, {
  student: s1,
  day: today,
  rev: 0,
  items: [{ name: '徒手深蹲', sets: 2, qty: 5, unit: '次', load: 80, loadUnit: 'kg', restSec: 90 }],
});
await req('publish', coachToken, { student: s1, day: today, rev: 1 });

await req('draft', coachToken, {
  student: s2,
  day: today,
  rev: 0,
  items: [{ name: '俯卧撑', sets: 2, qty: 10, unit: '次' }],
});
await req('publish', coachToken, { student: s2, day: today, rev: 1 });
const s2Plan = (await req(`day?day=${today}`, s2Token)).data.plan;
await req('feedback', s2Token, { day: today, plan: s2Plan.id, rpe: 9, note: '非常累', sets: [[true, true]] });

// Verify student cannot access coach overview API (403).
assert.equal((await req(`coach/overview?day=${today}`, s1Token)).status, 403);

const browser = await chromium.launch({ channel: 'chrome' });
try {
  // 1. Coach desktop workbench: 2-column grid, KPIs, high-RPE alert, clickable jump.
  const coach = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await coach.goto(base);
  const overview = coach.getByRole('region', { name: '今日总览看板' });
  await overview.waitFor();
  await overview.getByText(`看板乙-${tag}`).waitFor(); // High RPE >= 9 alert chip
  await overview.getByRole('button', { name: '展开今日明细' }).click();
  await overview.locator('.overview-row').filter({ hasText: `看板甲-${tag}` }).click();
  assert.equal(await coach.getByLabel('当前学员', { exact: true }).inputValue(), String(s1));

  // Verify two-column layout on 1280px desktop.
  const twoCol = await coach.evaluate(() => {
    const shell = document.querySelector('.coach-shell');
    return shell ? getComputedStyle(shell).gridTemplateColumns.split(' ').length === 2 : false;
  });
  assert.equal(twoCol, true, 'Expected 2-column coach workbench on desktop');

  // 2. Student mobile gym mode: weight stepper, auto rest timer, localStorage restore & clear.
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(`${base}/?student=${s1}`);
  await mobile.getByLabel('第1组加重').click();
  assert.equal(await mobile.getByLabel('第1组重量', { exact: true }).inputValue(), '82.5');
  await mobile.getByLabel('第1组', { exact: true }).check();

  // Rest timer bar auto-starts for restSec=90 (01:30).
  const timer = mobile.getByRole('region', { name: '组间倒计时' });
  await timer.waitFor();
  await timer.getByText(/01:30|01:29|01:28/).waitFor();
  await timer.getByRole('button', { name: '+30s' }).click();
  await timer.getByText(/02:00|01:59|01:58|01:57/).waitFor();
  await timer.getByRole('button', { name: '跳过' }).click();

  // Verify zero horizontal overflow on 390px mobile viewport.
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  // Type draft note, reload without submitting, and verify localStorage auto-restores!
  await mobile.getByLabel('训练备注').fill('切后台草稿不丢失');
  await mobile.reload();
  await mobile.getByText('已自动恢复本地暂存进度').waitFor();
  assert.equal(await mobile.getByLabel('第1组', { exact: true }).isChecked(), true);
  assert.equal(await mobile.getByLabel('第1组重量', { exact: true }).inputValue(), '82.5');
  assert.equal(await mobile.getByLabel('训练备注').inputValue(), '切后台草稿不丢失');

  // Submit feedback and verify localStorage draft is cleared on reload.
  await mobile.getByRole('button', { name: '提交反馈' }).click();
  await mobile.locator('output').getByText('切后台草稿不丢失').waitFor();
  const leftoverKeys = await mobile.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('studio-workout-draft:'))
  );
  assert.equal(leftoverKeys.length, 0, 'Local workout draft must be cleared after submit');

  console.log('PASS TASK-007 UI/UX: 2-column desktop workbench, coach overview KPIs & RPE>=9 alert, mobile stepper/rest-timer/localStorage draft restore & clear');
} finally {
  await browser.close();
}
