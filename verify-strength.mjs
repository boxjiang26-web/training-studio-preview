import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { testRoster } from './test-roster.mjs';
import { calculateEpley1RM, computeSessionMetrics } from './strength.mjs';

const base = process.env.STUDIO_URL || 'http://127.0.0.1:4186';

// 1. Unit checks for Epley 1RM & tonnage math (kg, lb, >12 reps, seconds, unchecked sets).
{
  assert.equal(calculateEpley1RM(100, 1), 100);
  assert.equal(calculateEpley1RM(100, 5), 116.7);
  assert.equal(calculateEpley1RM(105, 4), 119);
  assert.equal(calculateEpley1RM(100, 13), null);
  assert.equal(calculateEpley1RM(0, 5), null);

  const metrics = computeSessionMetrics(
    [
      { name: '深蹲', sets: 3, qty: 5, unit: '次' },
      { name: '平板支撑', sets: 2, qty: 60, unit: '秒' },
    ],
    [
      [
        { done: true, weight: 100, unit: 'kg', reps: 5 },
        { done: true, weight: 220.46, unit: 'lb', reps: 5 },
        { done: false, weight: 120, unit: 'kg', reps: 5 },
      ],
      [
        { done: true, weight: 20, unit: 'kg', reps: 60 },
        { done: true, weight: 20, unit: 'kg', reps: 60 },
      ],
    ]
  );
  assert.equal(metrics.totalVolumeKg, 1000);
  assert.equal(metrics.exercises[0].volumeKg, 1000);
  assert.equal(metrics.exercises[0].bestE1rmKg, 116.7);
  assert.equal(metrics.exercises[1].volumeKg, 0);
  assert.equal(metrics.exercises[1].bestE1rmKg, null);
  console.log('PASS strength math unit checks (Epley 1RM, kg/lb tonnage, >12 rep skip, seconds skip)');
}

async function req(route, token, body) {
  const res = await fetch(base + '/api/' + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-studio-session': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

const testName = await testRoster(base);
const coachToken = (await req('trial', '', {})).data.token;
const studentAName = testName('力量', '甲');
const studentBName = testName('力量', '乙');
const studentA = (await req('students', coachToken, { name: studentAName })).data.id;
const studentB = (await req('students', coachToken, { name: studentBName })).data.id;
const studentAToken = (await req('trial', '', { student: studentA })).data.token;
const studentBToken = (await req('trial', '', { student: studentB })).data.token;

const customName = `箱式深蹲-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: 'chrome' });

try {
  // 2. Permission check: student cannot create custom exercise.
  const deniedCreate = await req('coach/exercises', studentAToken, { name: '越权动作' });
  assert.equal(deniedCreate.status, 403);

  // 3. Coach UI: create custom exercise in Library, add to daily plan with structured strength fields, save & publish.
  const coachPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await coachPage.goto(base);
  await coachPage.getByLabel('当前学员', { exact: true }).selectOption(String(studentA));

  await coachPage.getByRole('button', { name: '从动作库选择' }).click();
  const libDialog = coachPage.getByRole('dialog', { name: '动作资料库' });
  await libDialog.getByText('新建自定义动作', { exact: true }).click();
  await libDialog.getByLabel('自定义动作名称').fill(customName);
  await libDialog.getByLabel('动作分类').selectOption('lower_strength');
  await libDialog.getByLabel('目标肌群（逗号分隔）').fill('股四头肌、臀大肌');
  await libDialog.getByLabel('使用器械（逗号分隔）').fill('杠铃、深蹲箱');
  await libDialog.getByLabel('动作说明').fill('坐箱停顿 1 秒后爆发站起');
  await libDialog.getByRole('button', { name: '保存自定义动作' }).click();
  await libDialog.getByRole('heading', { name: customName }).waitFor();

  // Duplicate custom exercise name should be rejected with 409.
  const dupCreate = await req('coach/exercises', coachToken, { name: customName });
  assert.equal(dupCreate.status, 409);

  await libDialog.getByRole('button', { name: '加入当天计划' }).click();

  // Fill structured strength prescription fields.
  const editor = coachPage.locator('.plan-editor-item').first();
  await editor.getByLabel('每组', { exact: true }).fill('5');
  await editor.getByLabel('负荷类型').selectOption('kg');
  await editor.getByLabel('负荷', { exact: true }).fill('100');
  await editor.getByLabel('目标 RPE').fill('8.5');
  await editor.getByLabel('间歇(秒)').fill('180');
  await editor.getByLabel('节奏 Tempo').fill('3-1-1-0');
  await editor.getByLabel('提示备注').fill('保持核心紧绷');

  await coachPage.getByRole('button', { name: '保存草稿' }).click();
  await coachPage.getByText('已保存草稿', { exact: true }).waitFor();
  await coachPage.getByRole('button', { name: '发布计划' }).click();
  await coachPage.getByText('计划已发布', { exact: true }).waitFor();

  const planDay = await coachPage.getByLabel('训练日期').inputValue();

  // 4. Verify template save & team distribution preserve all structured strength fields.
  const teamId = (await req('coach/team', coachToken, { name: '力量模板组-' + Date.now().toString(36), members: [studentB] })).data.id;
  const tplId = (await req('coach/template', coachToken, { student: studentA, day: planDay, name: '力量模板-' + Date.now().toString(36) })).data.id;
  const dist = await req('coach/distribute', coachToken, { team: teamId, template: tplId, day: planDay });
  assert.equal(dist.status, 200);
  assert.deepEqual(dist.data.published, [studentB]);

  const studentBDay = (await req(`day?day=${planDay}`, studentBToken)).data;
  assert.equal(studentBDay.plan.items[0].name, customName);
  assert.equal(studentBDay.plan.items[0].load, 100);
  assert.equal(studentBDay.plan.items[0].loadUnit, 'kg');
  assert.equal(studentBDay.plan.items[0].targetRpe, 8.5);
  assert.equal(studentBDay.plan.items[0].restSec, 180);
  assert.equal(studentBDay.plan.items[0].tempo, '3-1-1-0');
  assert.equal(studentBDay.plan.items[0].cue, '保持核心紧绷');

  // 5. Student mobile view: check layout width, prescription tags, custom exercise notes, per-set actual logs, live tonnage & 1RM.
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(`${base}/?student=${studentA}`);
  await mobile.getByText('100 kg · 目标 RPE 8.5 · 间歇 180 秒 · 节奏 3-1-1-0').waitFor();
  await mobile.getByText('教练提示：保持核心紧绷').waitFor();

  // Mobile layout must not overflow horizontally.
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  // Student can preview custom exercise notes.
  await mobile.getByRole('button', { name: '查看动作示范' }).click();
  const studentLib = mobile.getByRole('dialog', { name: '动作资料库' });
  await studentLib.getByText('坐箱停顿 1 秒后爆发站起').waitFor();
  await studentLib.getByRole('button', { name: '关闭' }).click();

  // Pre-filled values should be 100 kg x 5 reps; adjust set 3 to 105 kg x 4 reps.
  assert.equal(await mobile.getByLabel('第1组重量', { exact: true }).inputValue(), '100');
  assert.equal(await mobile.getByLabel('第1组次数', { exact: true }).inputValue(), '5');
  await mobile.getByLabel('第3组重量', { exact: true }).fill('105');
  await mobile.getByLabel('第3组次数', { exact: true }).fill('4');

  for (const box of await mobile.getByRole('checkbox').all()) {
    await box.check();
  }

  // Live metrics before submit: 500 + 500 + 420 = 1420 kg; best e1RM = 105 * (1 + 4/30) = 119 kg.
  await mobile.locator('.session-metrics').getByText('1420 kg').waitFor();
  await mobile.locator('.ex-metric').getByText('本动作容量 1420 kg · 预估 1RM 119 kg').waitFor();

  await mobile.getByLabel('整体用力程度 RPE').selectOption('8');
  await mobile.getByLabel('训练备注').fill('顶组 105kg 动作稳定');
  await mobile.getByRole('button', { name: '提交反馈' }).click();
  await mobile.locator('output').getByText(/总容量 1420 kg/).waitFor();

  // Verify backend persisted setLogs & metrics, and idempotent retry / conflict check.
  const savedDay = (await req(`day?day=${planDay}`, studentAToken)).data;
  assert.equal(savedDay.feedback.metrics.totalVolumeKg, 1420);
  assert.equal(savedDay.feedback.metrics.exercises[0].bestE1rmKg, 119);
  assert.equal(savedDay.feedback.setLogs[0][2].weight, 105);
  assert.equal(savedDay.feedback.setLogs[0][2].reps, 4);

  const retrySame = await req('feedback', studentAToken, {
    day: planDay,
    plan: savedDay.plan.id,
    sets: savedDay.feedback.sets,
    setLogs: savedDay.feedback.setLogs,
    rpe: 8,
    note: '顶组 105kg 动作稳定',
  });
  assert.equal(retrySame.status, 200);
  assert.equal(retrySame.data.id, savedDay.feedback.id);

  const retryConflict = await req('feedback', studentAToken, {
    day: planDay,
    plan: savedDay.plan.id,
    sets: savedDay.feedback.sets,
    setLogs: [[
      { done: true, weight: 110, unit: 'kg', reps: 5 },
      { done: true, weight: 100, unit: 'kg', reps: 5 },
      { done: true, weight: 105, unit: 'kg', reps: 4 },
    ]],
    rpe: 8,
    note: '顶组 105kg 动作稳定',
  });
  assert.equal(retryConflict.status, 409);

  // 6. Coach readback reflects volume & 1RM accurately.
  await coachPage.getByRole('button', { name: '刷新记录' }).click();
  await coachPage.locator('output').getByText(/总容量 1420 kg/).waitFor();
  await coachPage.locator('.ex-metric').getByText('本动作容量 1420 kg · 预估 1RM 119 kg').waitFor();

  // 7. Delete custom exercise via Library UI and confirm historical plan still loads intact.
  await coachPage.getByRole('button', { name: '动作库', exact: true }).click();
  const lib2 = coachPage.getByRole('dialog', { name: '动作资料库' });
  await lib2.getByLabel('搜索动作').fill(customName);
  await lib2.locator('button.film').first().click();
  await lib2.getByRole('button', { name: '删除自定义动作' }).click();
  await lib2.getByText('已删除自定义动作：' + customName).waitFor();
  await lib2.getByRole('button', { name: '关闭' }).click();

  await mobile.reload();
  await mobile.locator('article strong', { hasText: customName }).waitFor();
  await mobile.locator('output').getByText(/总容量 1420 kg/).waitFor();

  console.log('PASS custom exercises CRUD, structured strength prescription, template inheritance, mobile per-set weight/reps, tonnage 1420 kg & Epley 1RM 119 kg');
} finally {
  await browser.close();
}
