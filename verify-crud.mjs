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

const coachToken = (await req('trial', '', {})).data.token;
const tag = Date.now().toString(36);
const s1 = (await req('students', coachToken, { name: `CRUD甲-${tag}` })).data.id;
const s2 = (await req('students', coachToken, { name: `CRUD乙-${tag}` })).data.id;
const s1Token = (await req('trial', '', { student: s1 })).data.token;

// Permission isolation: student cannot call any coach CRUD endpoint.
for (const [route, payload] of [
  ['coach/student/update', { student: s1, name: '非法改名' }],
  ['coach/student/archive', { student: s1, archived: true }],
  ['coach/team/delete', { team: 'none' }],
  ['coach/template/delete', { template: 'none' }],
  ['coach/assessments/delete', { student: s1, day: '2026-11-01', metric: '深蹲', unit: 'kg' }],
  ['coach/cycle/delete', { student: s1, cycle: 'none' }],
]) {
  assert.equal((await req(route, s1Token, payload)).status, 403, `${route} must reject student with 403`);
}

// Not-found checks (404).
assert.equal((await req('coach/student/update', coachToken, { student: 999999, name: '不存在' })).status, 404);
assert.equal((await req('coach/team/delete', coachToken, { team: 'missing-team' })).status, 404);
assert.equal((await req('coach/template/delete', coachToken, { template: 'missing-tpl' })).status, 404);
assert.equal((await req('coach/cycle/delete', coachToken, { student: s1, cycle: 'missing-cycle' })).status, 404);

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', (d) => d.accept());
  await page.goto(base);

  // 1. Student rename + archive + restore via UI.
  await page.getByLabel('当前学员', { exact: true }).selectOption(String(s1));
  await page.getByText('管理学员档案', { exact: true }).click();
  const renamed = `CRUD甲改名-${tag}`;
  await page.getByLabel('修改学员姓名').fill(renamed);
  await page.getByRole('button', { name: '保存改名' }).click();
  await page.waitForFunction(
    (name) => document.querySelector('select[aria-label="当前学员"]')?.selectedOptions[0]?.textContent?.includes(name),
    renamed
  );

  await page.getByRole('button', { name: '归档当前学员' }).click();
  await page.getByText(`${renamed} · #${s1}`).waitFor();
  assert.equal((await req('me', coachToken)).data.students.some((x) => x.id === s1), false);
  await page.getByRole('button', { name: '恢复档案' }).first().click();
  await page.waitForFunction(
    (name) => document.querySelector('select[aria-label="当前学员"]')?.selectedOptions[0]?.textContent?.includes(name),
    renamed
  );
  assert.equal((await req('me', coachToken)).data.students.some((x) => x.id === s1), true);

  // 2. Prepare draft, create team + template, then update & delete via UI.
  const day = await page.getByLabel('训练日期').inputValue();
  await req('draft', coachToken, {
    student: s1,
    day,
    rev: 0,
    items: [{ name: '徒手深蹲', sets: 3, qty: 10, unit: '次' }],
  });

  await page.getByRole('button', { name: '团队工作台' }).click();
  const desk = page.getByRole('dialog', { name: '团队工作台' });
  await desk.getByLabel('团队名称', { exact: true }).fill(`旧团队-${tag}`);
  await desk.getByLabel(renamed, { exact: true }).check();
  await desk.getByRole('button', { name: '建立团队' }).click();
  await desk.getByText('团队已建立').waitFor();

  await desk.getByRole('button', { name: '编辑当前团队' }).click();
  await desk.getByLabel('新团队标题').fill(`新团队-${tag}`);
  await desk.getByLabel(`调整成员 CRUD乙-${tag}`).check();
  await desk.getByRole('button', { name: '保存团队修改' }).click();
  await desk.getByText('团队已更新').waitFor();
  await desk.getByText(`CRUD乙-${tag}`).first().waitFor();

  await desk.getByRole('button', { name: '模板与分发' }).click();
  await desk.getByLabel('模板名称', { exact: true }).fill(`旧模板-${tag}`);
  await desk.getByRole('button', { name: '保存为模板' }).click();
  await desk.getByText('模板已保存').waitFor();

  // Modify draft so we can test overwriting template from current draft.
  await req('draft', coachToken, {
    student: s1,
    day,
    rev: 1,
    items: [{ name: '俯卧撑', sets: 4, qty: 12, unit: '次' }],
  });

  await desk.getByText('编辑或删除模板', { exact: true }).click();
  await desk.getByLabel('新模板标题').fill(`新模板-${tag}`);
  await desk.getByRole('button', { name: '重命名模板' }).click();
  await desk.getByText('模板已重命名').waitFor();
  await desk.getByRole('button', { name: '用当前草稿覆盖' }).click();
  await desk.getByText('模板动作已更新为当前草稿').waitFor();
  await desk.getByText('俯卧撑 · 4 组 × 12 次').waitFor();

  await desk.getByRole('button', { name: '删除模板' }).click();
  await desk.getByText('模板已删除').waitFor();

  await desk.getByRole('button', { name: '团队名单' }).click();
  await desk.getByRole('button', { name: '删除团队' }).click();
  await desk.getByText('团队已删除').waitFor();
  await desk.getByRole('button', { name: '关闭' }).click();

  // 3. Assessment single-record edit & delete via UI.
  await req('coach/assessments/confirm', coachToken, {
    csv: `姓名,日期,项目,成绩,单位\n${renamed},2026-11-01,纵跳,50,厘米\n${renamed},2026-11-10,纵跳,55,厘米`,
  });
  await page.getByRole('button', { name: '历次测评' }).click();
  const hist = page.locator('.assessment-history');
  await hist.getByText('55', { exact: true }).waitFor();
  await hist.getByRole('button', { name: '修正' }).first().click();
  await hist.getByLabel('修改成绩 2026-11-10').fill('58');
  await hist.getByRole('button', { name: '保存成绩' }).click();
  await hist.getByText('+8', { exact: true }).waitFor();

  await hist.getByRole('button', { name: '删除' }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.assessment-history tbody tr').length === 1);

  // 4. Cycle delete via UI (and confirm published plan survives).
  const cycleRes = await req('coach/cycle/create', coachToken, {
    student: s1,
    goal: `待删周期-${tag}`,
    start: '2026-11-02',
    weeks: 2,
  });
  const days = Array.from({ length: 7 }, () => []);
  days[0] = [{ name: '徒手深蹲', sets: 2, qty: 8, unit: '次' }];
  await req('coach/cycle/publish', coachToken, {
    student: s1,
    cycle: cycleRes.data.id,
    idx: 0,
    rev: 0,
    days,
  });

  await page.getByRole('button', { name: '多周训练周期' }).click();
  const cycDlg = page.getByRole('dialog', { name: '多周训练周期' });
  await cycDlg.getByRole('button', { name: '删除周期' }).click();
  await cycDlg.getByText('周期已删除').waitFor();
  await cycDlg.getByRole('button', { name: '关闭' }).click();

  // Historical published daily plan remains intact after cycle deletion.
  const survivingPlan = (await req('day?day=2026-11-02', s1Token)).data.plan;
  assert.equal(survivingPlan.items[0].name, '徒手深蹲');

  console.log('PASS TASK-005 CRUD: student rename/archive/restore, team & template edit/delete, assessment edit/delete, cycle delete with surviving plan, 403/404 boundaries');
} finally {
  await browser.close();
}
