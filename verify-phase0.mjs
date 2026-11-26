import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertPlaceholders } from './db-postgres.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.STUDIO_URL || 'http://127.0.0.1:4186';

// 1. Verify PostgreSQL placeholder conversion is stateless and concurrency-safe.
{
  const queries = [
    'SELECT * FROM plans WHERE owner = ? AND day BETWEEN ? AND ?',
    'INSERT INTO feedback VALUES(?,?,?,?,?)',
    'SELECT id FROM students WHERE id = ?',
  ];
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      Promise.resolve().then(() => convertPlaceholders(queries[index % queries.length]))
    )
  );
  results.forEach((converted, index) => {
    const kind = index % queries.length;
    if (kind === 0) assert.equal(converted, 'SELECT * FROM plans WHERE owner = $1 AND day BETWEEN $2 AND $3');
    if (kind === 1) assert.equal(converted, 'INSERT INTO feedback VALUES($1,$2,$3,$4,$5)');
    if (kind === 2) assert.equal(converted, 'SELECT id FROM students WHERE id = $1');
  });
  console.log('PASS db-postgres placeholder conversion concurrency check');
}

// 2. Verify Dockerfile copies every local .mjs module reachable from server-postgres.mjs.
{
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const visited = new Set();
  const queue = ['server-postgres.mjs'];

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = fs.readFileSync(path.join(root, current), 'utf8');
    for (const match of source.matchAll(/from\s+['"]\.\/([^'"]+\.mjs)['"]/g)) {
      queue.push(match[1]);
    }
  }

  for (const mod of visited) {
    assert.ok(dockerfile.includes(mod), `Dockerfile is missing COPY for ${mod}`);
  }
  console.log('PASS Dockerfile covers all transitive .mjs modules:', [...visited].sort().join(', '));
}

// 3. Verify static asset gzip + ETag + 304 caching and API header/body validation.
{
  const first = await fetch(base + '/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag, 'Expected ETag on /app.js');
  assert.equal(first.headers.get('cache-control'), 'no-cache');

  const second = await fetch(base + '/app.js', { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);

  const coachRes = await fetch(base + '/api/trial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: '{}',
  });
  assert.equal(coachRes.status, 200, 'Expected charset Content-Type to be accepted');
  const { token: coachToken } = await coachRes.json();

  const badJsonRes = await fetch(base + '/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-studio-session': coachToken },
    body: '{invalid-json',
  });
  assert.equal(badJsonRes.status, 400, 'Invalid JSON should return 400 rather than 500');

  const badDateRes = await fetch(base + '/api/day?student=1&day=2026-02-31', {
    headers: { 'x-studio-session': coachToken },
  });
  assert.ok([400, 404].includes(badDateRes.status), 'Invalid calendar date should be rejected');

  console.log('PASS static ETag/304, charset JSON header, bad JSON 400, invalid date rejection');

  // 4. Verify cycle review counts feedback submitted on rev=2 after post-publish daily edit.
  const api = async (route, token, body) => {
    const res = await fetch(base + '/api/' + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-studio-session': token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    assert.ok(res.ok, `${route} failed (${res.status}): ${data.error}`);
    return data;
  };

  const studentName = `周期修订验收-${Date.now()}`;
  const { id: studentId } = await api('students', coachToken, { name: studentName });
  const { token: studentToken } = await api('trial', '', { student: studentId });

  const start = '2026-10-05'; // Monday
  const { id: cycleId } = await api('coach/cycle/create', coachToken, {
    student: studentId,
    goal: '周期 rev=2 复盘统计验证',
    start,
    weeks: 2,
  });

  const days = Array.from({ length: 7 }, () => []);
  days[0] = [{ name: '徒手深蹲', sets: 3, qty: 10, unit: '次' }];
  await api('coach/cycle/publish', coachToken, { student: studentId, cycle: cycleId, idx: 0, rev: 0, days });

  // Coach modifies day 1 on daily desk (rev=1 -> rev=2) with weighted load and republishes before student submits feedback.
  await api('draft', coachToken, {
    student: studentId,
    day: start,
    rev: 1,
    items: [{ name: '徒手深蹲', sets: 4, qty: 5, unit: '次', load: 100, loadUnit: 'kg' }],
  });
  await api('publish', coachToken, { student: studentId, day: start, rev: 2 });

  const dayView = await api(`day?day=${start}`, studentToken);
  assert.equal(dayView.plan.rev, 2);
  await api('feedback', studentToken, {
    day: start,
    plan: dayView.plan.id,
    rpe: 7,
    note: '第二版计划完成',
    sets: [[true, true, true, false]],
    setLogs: [[
      { done: true, weight: 100, unit: 'kg', reps: 5 },
      { done: true, weight: 100, unit: 'kg', reps: 5 },
      { done: true, weight: 100, unit: 'kg', reps: 5 },
      { done: false, weight: 100, unit: 'kg', reps: 5 },
    ]],
  });

  // Also publish week 2 with higher volume to verify weekly volume delta & topE1rms.
  const daysW2 = Array.from({ length: 7 }, () => []);
  daysW2[0] = [{ name: '徒手深蹲', sets: 3, qty: 5, unit: '次', load: 110, loadUnit: 'kg' }];
  await api('coach/cycle/publish', coachToken, { student: studentId, cycle: cycleId, idx: 1, rev: 0, days: daysW2 });
  const w2Start = '2026-10-12';
  const w2Day = await api(`day?day=${w2Start}`, studentToken);
  await api('feedback', studentToken, {
    day: w2Start,
    plan: w2Day.plan.id,
    rpe: 8,
    note: '第二周加重完成',
    setLogs: [[
      { done: true, weight: 110, unit: 'kg', reps: 5 },
      { done: true, weight: 110, unit: 'kg', reps: 5 },
      { done: true, weight: 110, unit: 'kg', reps: 5 },
    ]],
  });

  const review = await api('coach/cycle/review', coachToken, { student: studentId, cycle: cycleId });
  assert.equal(review.weeks[0].reported, 1, 'Feedback on rev=2 must be counted in cycle review');
  assert.equal(review.weeks[0].planned, 4, 'Planned sets should reflect rev=2');
  assert.equal(review.weeks[0].completed, 3, 'Completed sets should reflect rev=2 feedback');
  assert.equal(review.weeks[0].rpe, 7, 'Average RPE should include rev=2 feedback');
  assert.equal(review.weeks[0].volumeKg, 1500, 'Week 1 volume should equal 3 * 100 * 5 = 1500 kg');
  assert.equal(review.weeks[0].topE1rms[0].e1rmKg, 116.7, 'Week 1 e1RM should equal 116.7 kg');
  assert.equal(review.weeks[1].volumeKg, 1650, 'Week 2 volume should equal 3 * 110 * 5 = 1650 kg');
  assert.equal(review.weeks[1].volumeDeltaPct, 10, 'Week 2 volume delta should be +10%');
  assert.equal(review.weeks[1].topE1rms[0].e1rmKg, 128.3, 'Week 2 e1RM should equal 128.3 kg');

  console.log('PASS cycle review accurately reflects rev=2 edits, weekly tonnage (+10%), and Epley 1RM');
}
