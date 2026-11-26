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
const s1 = (await req('students', coachToken, { name: `状态甲-${tag}` })).data.id;
const s2 = (await req('students', coachToken, { name: `状态乙-${tag}` })).data.id;
const s1Token = (await req('trial', '', { student: s1 })).data.token;
const s2Token = (await req('trial', '', { student: s2 })).data.token;

// Security checks: coach cannot post as student; s2 cannot read or write s1 readiness.
assert.equal((await req('readiness', coachToken, { student: s1, day: today, sleep: 3, fatigue: 3, soreness: 3, mood: 3 })).status, 403);
assert.equal((await req(`readiness?student=${s1}&day=${today}`, s2Token)).status, 403);
assert.equal((await req('readiness', s2Token, { student: s1, day: today, sleep: 3, fatigue: 3, soreness: 3, mood: 3 })).status, 403);

const browser = await chromium.launch({ channel: 'chrome' });
try {
  // 1. Student submits low morning readiness check-in on mobile (390px).
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(`${base}/?student=${s1}`);
  const box = mobile.getByRole('region', { name: '晨起状态打卡' });
  await box.locator('summary').click();
  await box.getByLabel('睡眠质量').selectOption('2');
  await box.getByLabel('精力恢复').selectOption('1');
  await box.getByLabel('肌肉轻松度').selectOption('2');
  await box.getByLabel('训练状态').selectOption('2');
  await box.getByLabel('状态备注').fill('昨晚失眠且大腿偏酸');
  await box.getByRole('button', { name: '提交状态打卡' }).click();
  await box.getByText(/状态已记录 · 综合分 1.8（偏低，已提醒教练关注）/).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  // 2. Coach desktop overview immediately surfaces low-readiness alert & history.
  const coach = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await coach.goto(base);
  const overview = coach.getByRole('region', { name: '今日总览看板' });
  await overview.getByText(new RegExp(`状态甲-${tag}.*状态分 1.8`)).waitFor();

  await coach.getByLabel('当前学员', { exact: true }).selectOption(String(s1));
  await coach.getByRole('button', { name: '状态监控' }).click();
  await coach.getByText(/昨晚失眠且大腿偏酸/).waitFor();

  console.log('PASS TASK-008 Readiness: mobile morning check-in (1.8), coach low-readiness alert chip, history readback, 403 isolation');
} finally {
  await browser.close();
}
