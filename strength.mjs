import { randomUUID } from 'node:crypto';

export const LB_TO_KG = 0.45359237;
export const LOAD_UNITS = ['kg', 'lb', '%1RM', '自重'];
export const SET_LOG_UNITS = ['kg', 'lb'];
export const EXERCISE_CATEGORIES = [
  'lower_strength',
  'upper_strength',
  'power_conditioning',
  'prep_recovery',
  'core',
  'neck_specialty',
  'full_body_strength',
  'custom',
];

export const customExerciseSchema = `
CREATE TABLE IF NOT EXISTS custom_exercises(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  muscles TEXT NOT NULL,
  equipment TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL
);
`;

function check(ok, message, status = 400) {
  if (!ok) {
    throw Object.assign(new Error(message), { status });
  }
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function roundTo(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function cleanTagList(value, label) {
  if (value === undefined || value === null) return [];
  const rawList = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[，,、/]+/)
      : null;
  check(rawList !== null, `${label}格式无效`);
  const tags = Array.from(
    new Set(
      rawList
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );
  check(tags.length <= 10 && tags.every((tag) => tag.length <= 24), `${label}最多 10 项，每项不超过 24 字`);
  return tags;
}

export function normalizeExerciseItem(raw, allowedNames) {
  check(raw && typeof raw === 'object', '请检查动作、组数和训练量');
  check(
    allowedNames.has(raw.name) &&
      Number.isInteger(raw.sets) &&
      raw.sets >= 1 &&
      raw.sets <= 30 &&
      ['次', '秒'].includes(raw.unit) &&
      Number.isInteger(raw.qty) &&
      raw.qty >= 1 &&
      raw.qty <= 3600,
    '请检查动作、组数和训练量'
  );

  const rawLoad = parseOptionalNumber(raw.load);
  check(!Number.isNaN(rawLoad), '负重数值无效');

  let loadUnit = raw.loadUnit;
  if (loadUnit === undefined || loadUnit === null || loadUnit === '') {
    loadUnit = rawLoad !== null ? 'kg' : '自重';
  }
  check(LOAD_UNITS.includes(loadUnit), '负重单位无效');

  let load = rawLoad;
  if (loadUnit === '自重') {
    load = null;
  } else if (load !== null) {
    if (loadUnit === '%1RM') {
      check(load >= 1 && load <= 200, '%1RM 负荷须在 1–200 之间');
    } else {
      check(load >= 0 && load <= 2000, '负重须在 0–2000 之间');
    }
    load = roundTo(load, 2);
  }

  const targetRpe = parseOptionalNumber(raw.targetRpe);
  check(
    targetRpe === null ||
      (!Number.isNaN(targetRpe) &&
        targetRpe >= 1 &&
        targetRpe <= 10 &&
        Math.round(targetRpe * 2) === targetRpe * 2),
    '目标 RPE 须为 1–10 且支持 0.5 步长'
  );

  const restSec = parseOptionalNumber(raw.restSec);
  check(
    restSec === null || (Number.isInteger(restSec) && restSec >= 0 && restSec <= 1800),
    '组间歇须为 0–1800 秒整数'
  );

  const tempo = raw.tempo == null ? '' : String(raw.tempo).trim();
  check(tempo.length <= 16, '节奏 Tempo 最多 16 字');

  const cue = raw.cue == null ? '' : String(raw.cue).trim();
  check(cue.length <= 120, '动作提示最多 120 字');

  const item = {
    id: randomUUID(),
    name: raw.name,
    sets: raw.sets,
    qty: raw.qty,
    unit: raw.unit,
  };

  if (load !== null || loadUnit !== '自重') {
    item.load = load;
    item.loadUnit = loadUnit;
  }
  if (targetRpe !== null) item.targetRpe = targetRpe;
  if (restSec !== null) item.restSec = restSec;
  if (tempo) item.tempo = tempo;
  if (cue) item.cue = cue;

  return item;
}

export function normalizeSetLogs(rawSetLogs, planItems) {
  check(
    Array.isArray(rawSetLogs) && rawSetLogs.length === planItems.length,
    '逐组执行记录维度无效'
  );

  return rawSetLogs.map((row, itemIndex) => {
    const planItem = planItems[itemIndex];
    check(Array.isArray(row) && row.length === planItem.sets, '逐组执行记录组数无效');

    return row.map((entry) => {
      check(entry && typeof entry === 'object' && typeof entry.done === 'boolean', '逐组执行记录格式无效');
      const weight = parseOptionalNumber(entry.weight);
      check(weight === null || (!Number.isNaN(weight) && weight >= 0 && weight <= 2000), '实际重量须在 0–2000 之间');

      const unit = entry.unit === undefined || entry.unit === null || entry.unit === '' ? 'kg' : entry.unit;
      check(SET_LOG_UNITS.includes(unit), '实际重量单位无效');

      const reps = parseOptionalNumber(entry.reps);
      check(reps === null || (Number.isInteger(reps) && reps >= 0 && reps <= 3600), '实际次数/时长须为 0–3600 整数');

      const rpe = parseOptionalNumber(entry.rpe);
      check(
        rpe === null || (!Number.isNaN(rpe) && rpe >= 1 && rpe <= 10 && Math.round(rpe * 2) === rpe * 2),
        '单组 RPE 须为 1–10 且支持 0.5 步长'
      );

      const normalized = {
        done: entry.done,
        weight: weight === null ? null : roundTo(weight, 2),
        unit,
        reps,
      };
      if (rpe !== null) normalized.rpe = rpe;
      return normalized;
    });
  });
}

export function calculateEpley1RM(weightKg, reps) {
  if (!(weightKg > 0) || !Number.isInteger(reps) || reps < 1 || reps > 12) {
    return null;
  }
  if (reps === 1) {
    return roundTo(weightKg, 1);
  }
  return roundTo(weightKg * (1 + reps / 30), 1);
}

export function computeSessionMetrics(planItems, setLogs) {
  if (!Array.isArray(setLogs)) {
    return {
      totalVolumeKg: 0,
      exercises: planItems.map(() => ({ volumeKg: 0, bestE1rmKg: null })),
    };
  }

  let totalRawKg = 0;
  const exercises = planItems.map((planItem, itemIndex) => {
    const row = setLogs[itemIndex];
    if (!Array.isArray(row) || planItem.unit !== '次') {
      return { volumeKg: 0, bestE1rmKg: null };
    }

    let exerciseRawKg = 0;
    let bestE1rmKg = null;

    for (const entry of row) {
      if (!entry?.done) continue;
      if (!(entry.weight > 0) || !(entry.reps > 0)) continue;
      const weightKg = entry.unit === 'lb' ? entry.weight * LB_TO_KG : entry.weight;
      exerciseRawKg += weightKg * entry.reps;
      const e1rm = calculateEpley1RM(weightKg, entry.reps);
      if (e1rm !== null && (bestE1rmKg === null || e1rm > bestE1rmKg)) {
        bestE1rmKg = e1rm;
      }
    }

    totalRawKg += exerciseRawKg;
    return {
      volumeKg: roundTo(exerciseRawKg, 1),
      bestE1rmKg,
    };
  });

  return {
    totalVolumeKg: roundTo(totalRawKg, 1),
    exercises,
  };
}

function mapCustomRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    muscles: parseJson(row.muscles),
    equipment: parseJson(row.equipment),
    notes: row.notes || '',
    created: row.created,
    custom: true,
  };
}

export async function listCustomExercises(all) {
  const rows = await all(
    'SELECT id, name, category, muscles, equipment, notes, created FROM custom_exercises ORDER BY created DESC, id'
  );
  return rows.map(mapCustomRow);
}

export async function handleCustomExercises({ one, all, run }, route, body, isPost, builtinNames) {
  if (route === '/api/coach/exercises' && !isPost) {
    return { exercises: await listCustomExercises(all) };
  }

  if (route === '/api/coach/exercises' && isPost) {
    const name = String(body.name || '').trim();
    check(name.length > 0 && name.length <= 60, '动作名称须为 1–60 个字');
    check(!builtinNames.has(name), '动作名称已存在于系统动作库中', 409);

    const existing = await one('SELECT id FROM custom_exercises WHERE name = ?', name);
    check(!existing, '自定义动作名称已存在', 409);

    const category = body.category || 'custom';
    check(EXERCISE_CATEGORIES.includes(category), '训练类别无效');

    const muscles = cleanTagList(body.muscles, '目标肌群');
    const equipment = cleanTagList(body.equipment, '器械');
    const notes = body.notes == null ? '' : String(body.notes).trim();
    check(notes.length <= 300, '动作说明最多 300 字');

    const id = 'custom-' + randomUUID().slice(0, 12);
    const created = new Date().toISOString();
    await run(
      'INSERT INTO custom_exercises(id, name, category, muscles, equipment, notes, created) VALUES(?,?,?,?,?,?,?)',
      id,
      name,
      category,
      JSON.stringify(muscles),
      JSON.stringify(equipment),
      notes,
      created
    );

    return {
      exercise: {
        id,
        name,
        category,
        muscles,
        equipment,
        notes,
        created,
        custom: true,
      },
    };
  }

  if (route === '/api/coach/exercises/delete' && isPost) {
    const id = String(body.id || '').trim();
    check(Boolean(id), '请选择要删除的自定义动作');
    const deleted = await one('DELETE FROM custom_exercises WHERE id = ? RETURNING id', id);
    check(Boolean(deleted), '自定义动作不存在', 404);
    return { deleted: deleted.id };
  }

  check(false, '页面不存在', 404);
}
