import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { cycleReport } from './cycle-reports.mjs';
import { previousReview, reviewWeeks } from './cycle-review.mjs';
import { generateWeek } from './ai-week.mjs';
import { listCustomExercises, normalizeExerciseItem } from './strength.mjs';

const BUILTIN_NAMES = new Set([
  '徒手深蹲',
  '髋部拉伸',
  '俯卧撑',
  '平板支撑',
  '弹力带划船',
  ...JSON.parse(fs.readFileSync(new URL('./catalog.json', import.meta.url), 'utf8')).map((x) => x.name),
]);

export const cycleSchema = `
CREATE TABLE IF NOT EXISTS training_cycles(
  id TEXT PRIMARY KEY,
  student INTEGER NOT NULL REFERENCES students(id),
  goal TEXT NOT NULL,
  start_day TEXT NOT NULL,
  weeks INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cycle_weeks(
  cycle TEXT NOT NULL REFERENCES training_cycles(id),
  idx INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  published INTEGER NOT NULL,
  days TEXT NOT NULL,
  PRIMARY KEY(cycle, idx)
);
CREATE TABLE IF NOT EXISTS cycle_reports(
  cycle TEXT PRIMARY KEY REFERENCES training_cycles(id),
  content TEXT NOT NULL,
  version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cycle_reviews(
  cycle TEXT PRIMARY KEY REFERENCES training_cycles(id),
  note TEXT NOT NULL,
  rev INTEGER NOT NULL
);
`;

function check(ok, message, status = 400) {
  if (!ok) {
    throw Object.assign(new Error(message), { status });
  }
}

export function shift(day, offsetDays) {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export async function publishedWeeks(all, owner) {
  check(owner > 0, '请选择学员视图', 403);
  const rows = await all(
    `SELECT c.goal, c.start_day, w.idx
     FROM training_cycles c
     JOIN cycle_weeks w ON w.cycle = c.id
     WHERE c.student = ? AND w.published = 1
     ORDER BY c.start_day, w.idx`,
    owner
  );
  return rows.map((row) => ({
    goal: row.goal,
    week: shift(row.start_day, 7 * row.idx),
    number: row.idx + 1,
  }));
}

function unpack(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(value) ? { days: value } : value;
}

function decodeJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function roundHalf(value) {
  return Math.round(value * 2) / 2;
}

function scaleExerciseItem(item, percent, scaleTarget) {
  if (scaleTarget === 'load') {
    if (item.load != null && item.load > 0 && item.loadUnit && item.loadUnit !== '自重') {
      const scaled = roundHalf((item.load * percent) / 100);
      const maxVal = item.loadUnit === '%1RM' ? 200 : 2000;
      const minVal = item.loadUnit === '%1RM' ? 1 : 0.5;
      return {
        ...item,
        load: Math.max(minVal, Math.min(maxVal, scaled)),
      };
    }
    return { ...item };
  }

  return {
    ...item,
    qty: Math.max(1, Math.min(3600, Math.round((item.qty * percent) / 100))),
  };
}

function stripId(item) {
  const { id: _ignored, ...rest } = item;
  return rest;
}

export async function cycles({ one, all, run }, action, body) {
  const { student } = body;
  const person =
    Number.isInteger(student) && (await one('SELECT id, name FROM students WHERE id = ?', student));
  check(Boolean(person), '学员不存在');

  if (action === 'create') {
    check(typeof body.goal === 'string' && body.goal.trim() && body.goal.length <= 300, '请输入周期目标');
    check(
      /^\d{4}-\d{2}-\d{2}$/.test(body.start) &&
        new Date(body.start).toJSON()?.slice(0, 10) === body.start &&
        new Date(body.start).getUTCDay() === 1,
      '开始日期须为周一'
    );
    check(Number.isInteger(body.weeks) && body.weeks >= 2 && body.weeks <= 52, '周期长度为 2–52 周');
    const id = randomUUID();
    await run(
      'INSERT INTO training_cycles VALUES(?,?,?,?,?)',
      id,
      student,
      body.goal.trim(),
      body.start,
      body.weeks
    );
    return { id };
  }

  if (action === 'list') {
    return {
      cycles: await all(
        'SELECT * FROM training_cycles WHERE student = ? ORDER BY start_day DESC, id',
        student
      ),
    };
  }

  const cycle = await one(
    'SELECT * FROM training_cycles WHERE student = ? AND id = ?',
    student,
    body.cycle || ''
  );
  check(Boolean(cycle), '周期不存在', 404);

  if (action === 'delete') {
    await run('DELETE FROM cycle_reports WHERE cycle = ?', cycle.id);
    await run('DELETE FROM cycle_reviews WHERE cycle = ?', cycle.id);
    await run('DELETE FROM cycle_weeks WHERE cycle = ?', cycle.id);
    await run('DELETE FROM training_cycles WHERE id = ?', cycle.id);
    return { deleted: cycle.id };
  }

  if (['preview-report', 'send-report'].includes(action)) {
    return cycleReport({ one, all, run }, action, cycle, person, body);
  }

  if (action === 'review') {
    const row = await one('SELECT note, rev FROM cycle_reviews WHERE cycle = ?', cycle.id);
    return {
      weeks: await reviewWeeks(all, cycle),
      note: row?.note || '',
      rev: row?.rev || 0,
    };
  }

  if (action === 'confirm-review') {
    check(
      typeof body.note === 'string' && body.note.length <= 1200 && Number.isInteger(body.reviewRev),
      '请检查复盘内容'
    );
    const note = body.note.trim();
    const saved = body.reviewRev
      ? await one(
          'UPDATE cycle_reviews SET note = ?, rev = rev + 1 WHERE cycle = ? AND rev = ? RETURNING note, rev',
          note,
          cycle.id,
          body.reviewRev
        )
      : await one(
          'INSERT INTO cycle_reviews(cycle, note, rev) VALUES(?,?,1) ON CONFLICT(cycle) DO NOTHING RETURNING note, rev',
          cycle.id,
          note
        );
    check(Boolean(saved), '结论已更新，请重新打开周期', 409);
    return saved;
  }

  check(Number.isInteger(body.idx) && body.idx >= 0 && body.idx < cycle.weeks, '周次无效');
  const getWeek = (idx) =>
    one('SELECT rev, published, days FROM cycle_weeks WHERE cycle = ? AND idx = ?', cycle.id, idx);
  const row = await getWeek(body.idx);

  if (action === 'load') {
    return row
      ? { ...row, ...unpack(row.days) }
      : { rev: 0, published: 0, days: Array.from({ length: 7 }, () => []) };
  }

  check(!row?.published && body.rev === (row?.rev || 0), '本周已发布或版本已更新，请重新打开', 409);

  if (action === 'generate') {
    const week = shift(cycle.start_day, body.idx * 7);
    const first = shift(week, -7);
    const last = shift(week, -1);
    const sessions = await all(
      `SELECT p.day, p.items, f.rpe, f.note, f.sets
       FROM plans p
       LEFT JOIN feedback f ON f.plan = p.id
       WHERE p.owner = ? AND p.day BETWEEN ? AND ?
         AND p.rev = (SELECT MAX(q.rev) FROM plans q WHERE q.owner = p.owner AND q.day = p.day)
       ORDER BY p.day`,
      student,
      first,
      last
    );

    const previous = sessions.map((session) => {
      const items = decodeJson(session.items);
      return {
        day: session.day,
        plan: items.map(({ name, sets, qty, unit, load, loadUnit, targetRpe, restSec, tempo }) => ({
          name,
          sets,
          qty,
          unit,
          ...(load != null ? { load, loadUnit } : {}),
          ...(targetRpe != null ? { targetRpe } : {}),
          ...(restSec != null ? { restSec } : {}),
          ...(tempo ? { tempo } : {}),
        })),
        planned: items.reduce((sum, item) => sum + item.sets, 0),
        completed: session.sets == null ? null : decodeJson(session.sets).flat().filter(Boolean).length,
        rpe: session.rpe,
        note: (session.note || '').replaceAll(person.name, '学员').slice(0, 240),
      };
    });

    const memories = (
      await all(
        "SELECT note FROM training_memory WHERE student = ? AND status = '已接受' ORDER BY created, id",
        student
      )
    ).map((item) => item.note.replaceAll(person.name, '学员'));

    const review = await previousReview(all, cycle);
    if (review) {
      review.note = review.note.replaceAll(person.name, '学员');
      review.goal = review.goal.replaceAll(person.name, '学员');
    }

    const context = {
      previousReview: review,
      cycleWeek: body.idx + 1,
      cycleLength: cycle.weeks,
      previousStart: first,
      previousEnd: last,
      previous,
      memories,
    };

    const customExercises = await listCustomExercises(all);
    const recentExerciseNames = previous.flatMap((s) => s.plan.map((item) => item.name));
    const result = await generateWeek(cycle.goal, person, week, context, {
      customExercises,
      recentExerciseNames,
    });
    const snapshot = {
      days: result.days,
      reference: { reason: result.reason.slice(0, 1200), ...context },
    };
    const json = JSON.stringify(snapshot);
    const saved = row
      ? await one(
          'UPDATE cycle_weeks SET days = ?, rev = rev + 1 WHERE cycle = ? AND idx = ? AND rev = ? AND published = 0 RETURNING rev',
          json,
          cycle.id,
          body.idx,
          body.rev
        )
      : await one(
          'INSERT INTO cycle_weeks VALUES(?,?,1,0,?) ON CONFLICT(cycle, idx) DO NOTHING RETURNING rev',
          cycle.id,
          body.idx,
          json
        );
    check(Boolean(saved), '周草稿已变化，请重新打开', 409);
    return { ...snapshot, rev: saved.rev, published: 0 };
  }

  if (action === 'copy') {
    const prev = body.idx > 0 && (await getWeek(body.idx - 1));
    check(Boolean(prev), '上一周尚未保存安排');
    check(
      Number.isInteger(body.percent) && body.percent >= 25 && body.percent <= 200,
      '训练量比例为 25–200%'
    );
    const scaleTarget = body.scaleTarget === undefined ? 'qty' : body.scaleTarget;
    check(['qty', 'load'].includes(scaleTarget), '调整目标无效');

    return {
      days: unpack(prev.days).days.map((dayItems) =>
        dayItems.map((item) => scaleExerciseItem(item, body.percent, scaleTarget))
      ),
    };
  }

  check(['save', 'publish'].includes(action), '操作无效');
  const days = body.days;
  check(
    Array.isArray(days) && days.length === 7 && days.every((items) => Array.isArray(items) && items.length <= 50),
    '请检查每日动作和训练量'
  );

  const customRows = await all('SELECT name FROM custom_exercises');
  const allowedNames = new Set([...BUILTIN_NAMES, ...customRows.map((item) => item.name)]);
  const clean = days.map((dayItems) =>
    dayItems.map((item) => stripId(normalizeExerciseItem(item, allowedNames)))
  );

  const published = action === 'publish' ? 1 : 0;
  if (published) {
    check(clean.some((items) => items.length > 0), '请至少编排一个训练日');
  }

  const reference = row && !body.discardReference ? unpack(row.days).reference : null;
  const data = JSON.stringify({ days: clean, reference });
  const saved = row
    ? await one(
        'UPDATE cycle_weeks SET days = ?, rev = rev + 1, published = ? WHERE cycle = ? AND idx = ? AND rev = ? AND published = 0 RETURNING rev',
        data,
        published,
        cycle.id,
        body.idx,
        body.rev
      )
    : await one(
        'INSERT INTO cycle_weeks VALUES(?,?,1,?,?) ON CONFLICT(cycle, idx) DO NOTHING RETURNING rev',
        cycle.id,
        body.idx,
        published,
        data
      );
  check(Boolean(saved), '周草稿已变化，请重新打开', 409);

  if (published) {
    for (const [dayOffset, dayItems] of clean.entries()) {
      if (!dayItems.length) continue;
      const date = shift(cycle.start_day, 7 * body.idx + dayOffset);
      const itemsJson = JSON.stringify(dayItems.map((item) => ({ ...item, id: randomUUID() })));
      const draft = await one(
        'INSERT INTO drafts VALUES(?,?,1,?) ON CONFLICT(owner, day) DO NOTHING RETURNING owner',
        student,
        date,
        itemsJson
      );
      check(
        Boolean(draft) && !(await one('SELECT id FROM plans WHERE owner = ? AND day = ? LIMIT 1', student, date)),
        `${date} 已有计划或草稿，本周未发布`,
        409
      );
      await run('INSERT INTO plans(owner, day, rev, items) VALUES(?,?,1,?)', student, date, itemsJson);
    }
  }

  return { days: clean, reference, rev: saved.rev, published };
}
