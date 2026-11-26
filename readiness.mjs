export const readinessSchema = `
CREATE TABLE IF NOT EXISTS readiness(
  student INTEGER NOT NULL REFERENCES students(id),
  day TEXT NOT NULL,
  sleep INTEGER NOT NULL,
  fatigue INTEGER NOT NULL,
  soreness INTEGER NOT NULL,
  mood INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  score DOUBLE PRECISION NOT NULL,
  updated TEXT NOT NULL,
  PRIMARY KEY(student, day)
);
CREATE INDEX IF NOT EXISTS readiness_day ON readiness(day, score);
`;

function check(ok, message, status = 400) {
  if (!ok) {
    throw Object.assign(new Error(message), { status });
  }
}

function isValidDate(day) {
  return (
    typeof day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    new Date(`${day}T00:00:00Z`).toJSON()?.startsWith(day) === true
  );
}

function isScaleScore(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

export function isLowReadiness(row) {
  if (!row) return false;
  return row.score <= 2.5 || row.sleep <= 1 || row.fatigue <= 1 || row.soreness <= 1;
}

export async function handleReadiness({ one, all, run }, url, body, owner, isPost) {
  const sid = Number(isPost ? (body.student ?? owner) : (url.searchParams.get('student') || owner));
  check(owner === 0 || owner === sid, '无权访问此学员状态', 403);
  check(Number.isSafeInteger(sid) && Boolean(await one('SELECT id FROM students WHERE id = ?', sid)), '学员不存在', 404);

  if (!isPost) {
    const day = String(url.searchParams.get('day') || '');
    if (day) check(isValidDate(day), '日期无效');
    const today = day
      ? await one('SELECT * FROM readiness WHERE student = ? AND day = ?', sid, day)
      : null;
    const history = await all(
      'SELECT day, sleep, fatigue, soreness, mood, note, score, updated FROM readiness WHERE student = ? ORDER BY day DESC LIMIT 14',
      sid
    );
    return { today: today || null, history };
  }

  check(owner !== 0, '仅学员可提交晨起状态', 403);
  const day = String(body.day || '');
  check(isValidDate(day), '日期无效');
  check(
    isScaleScore(body.sleep) &&
      isScaleScore(body.fatigue) &&
      isScaleScore(body.soreness) &&
      isScaleScore(body.mood),
    '各项状态评分须为 1–5 整数'
  );
  const note = body.note == null ? '' : String(body.note).trim();
  check(note.length <= 300, '状态备注最多 300 字');

  const score = Math.round(((body.sleep + body.fatigue + body.soreness + body.mood) / 4) * 10) / 10;
  const updated = new Date().toISOString();

  await run(
    `INSERT INTO readiness(student, day, sleep, fatigue, soreness, mood, note, score, updated)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(student, day) DO UPDATE SET
       sleep = EXCLUDED.sleep,
       fatigue = EXCLUDED.fatigue,
       soreness = EXCLUDED.soreness,
       mood = EXCLUDED.mood,
       note = EXCLUDED.note,
       score = EXCLUDED.score,
       updated = EXCLUDED.updated`,
    sid,
    day,
    body.sleep,
    body.fatigue,
    body.soreness,
    body.mood,
    note,
    score,
    updated
  );

  return {
    day,
    sleep: body.sleep,
    fatigue: body.fatigue,
    soreness: body.soreness,
    mood: body.mood,
    note,
    score,
    updated,
    lowAlert: isLowReadiness({ score, sleep: body.sleep, fatigue: body.fatigue, soreness: body.soreness }),
  };
}
