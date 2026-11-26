import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createSqliteAdapter } from './db-sqlite.mjs';
import { executeCopilotTool } from './coach-copilot.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.STUDIO_URL || 'http://127.0.0.1:4186';

// 1. Direct unit tests on all 4 controlled copilot tools (anonymization, draft-only guardrail, memory candidate).
{
  const tmpDir = fs.mkdtempSync(path.join(root, '.tmp-verify-copilot-'));
  const db = createSqliteAdapter(tmpDir);
  try {
    const sid = db.createStudent('李明真名');
    db.upsertDraft(sid, '2026-11-20', 1, JSON.stringify([{ id: 'x1', name: '徒手深蹲', sets: 3, qty: 5, unit: '次', load: 100, loadUnit: 'kg' }]));
    db.insertPlanIfAbsent(sid, '2026-11-20', 1, JSON.stringify([{ id: 'x1', name: '徒手深蹲', sets: 3, qty: 5, unit: '次', load: 100, loadUnit: 'kg' }]));
    const plan = db.one('SELECT id FROM plans WHERE owner = ? AND day = ?', sid, '2026-11-20');
    db.run(
      'INSERT INTO feedback(id, plan, rpe, note, sets, set_logs) VALUES(?,?,?,?,?,?)',
      'fb-1',
      plan.id,
      8,
      '李明真名感觉右膝微酸',
      JSON.stringify([[true, true, true]]),
      JSON.stringify([[
        { done: true, weight: 100, unit: 'kg', reps: 5 },
        { done: true, weight: 100, unit: 'kg', reps: 5 },
        { done: true, weight: 100, unit: 'kg', reps: 5 },
      ]])
    );

    const ctx = { studentId: sid, studentName: '李明真名', defaultDay: '2026-11-26' };

    const summary = await executeCopilotTool(db, 'get_student_summary', { limitSessions: 5 }, ctx);
    assert.equal(summary.data.feedback[0].volumeKg, 1500);
    assert.equal(summary.data.feedback[0].e1rms[0].e1rmKg, 116.7);
    assert.equal(JSON.stringify(summary.data).includes('李明真名'), false, 'Real student name must be anonymized');

    const searched = await executeCopilotTool(db, 'search_exercises', { query: '深蹲', limit: 5 }, ctx);
    assert.ok(searched.data.exercises.length > 0);

    // Guardrail: save_day_draft must NOT overwrite a day that already has student feedback!
    const blocked = await executeCopilotTool(
      db,
      'save_day_draft',
      { day: '2026-11-20', items: [{ name: '平板支撑', sets: 2, qty: 45, unit: '秒' }] },
      ctx
    );
    assert.equal(blocked.data.ok, false);

    // Guardrail: save_day_draft writes ONLY to drafts and NEVER publishes to plans!
    const saved = await executeCopilotTool(
      db,
      'save_day_draft',
      { day: '2026-11-26', items: [{ name: '徒手深蹲', sets: 3, qty: 8, unit: '次', load: 60, loadUnit: 'kg', targetRpe: 7, restSec: 90 }] },
      ctx
    );
    assert.equal(saved.data.ok, true);
    assert.equal(saved.data.published, false);
    assert.ok(db.one('SELECT rev FROM drafts WHERE owner = ? AND day = ?', sid, '2026-11-26'));
    assert.equal(db.one('SELECT id FROM plans WHERE owner = ? AND day = ?', sid, '2026-11-26'), undefined);

    const mem = await executeCopilotTool(
      db,
      'add_memory_candidate',
      { category: '伤病注意', evidence: '2026-11-20 备注右膝微酸', note: '下肢安排控制膝关节负荷' },
      ctx
    );
    assert.equal(mem.data.ok, true);
    assert.equal(mem.data.status, '待审核');

    console.log('PASS copilot tool unit tests (anonymization, tonnage/1RM, feedback-overwrite block, draft-only guardrail, pending memory)');
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 2. End-to-end UI + API verification on running server.
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
const sid = (await req('students', coachToken, { name: `副驾驶学员-${tag}` })).data.id;
const sToken = (await req('trial', '', { student: sid })).data.token;

// Student cannot call coach copilot (403).
assert.equal((await req('coach/copilot', sToken, { student: sid, day: '2026-12-28', message: '总结', localOnly: true })).status, 403);

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base);
  await page.getByLabel('当前学员', { exact: true }).selectOption(String(sid));
  await page.getByLabel('训练日期').fill('2026-12-28');

  await page.getByRole('button', { name: 'AI 教练副驾驶' }).click();
  const dlg = page.getByRole('dialog', { name: 'AI 教练副驾驶' });
  await dlg.getByLabel('本地工具直出（免外部模型）').check();
  await dlg.getByRole('button', { name: '为当日生成一套低负荷恢复课草稿' }).click();
  await dlg.getByText(/save_day_draft/).waitFor();
  await dlg.getByRole('button', { name: '关闭' }).click();

  // Draft should now be loaded on coach daily editor (un-published!), while student sees no published plan!
  await page.getByRole('heading', { name: '日计划 · 草稿' }).waitFor();
  const studentDay = (await req('day?day=2026-12-28', sToken)).data;
  assert.equal(studentDay.plan, null, 'Copilot draft must remain invisible to student until coach publishes');

  console.log('PASS TASK-010 Copilot: 403 isolation, UI tool trace, draft saved & refreshed in coach desk without auto-publishing');
} finally {
  await browser.close();
}
