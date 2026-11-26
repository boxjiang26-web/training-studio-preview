import { computeSessionMetrics } from './strength.mjs';

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function dayAt(start, offsetDays) {
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export async function reviewWeeks(all, cycle) {
  const end = dayAt(cycle.start_day, cycle.weeks * 7);
  const published = await all(
    'SELECT idx, days FROM cycle_weeks WHERE cycle = ? AND published = 1',
    cycle.id
  );
  const plans = await all(
    `SELECT p.day, p.items, f.sets, f.set_logs, f.rpe
     FROM plans p
     LEFT JOIN feedback f ON f.plan = p.id
     WHERE p.owner = ? AND p.day >= ? AND p.day < ?
       AND p.rev = (
         SELECT MAX(q.rev) FROM plans q WHERE q.owner = p.owner AND q.day = p.day
       )
     ORDER BY p.day`,
    cycle.student,
    cycle.start_day,
    end
  );
  const byDate = new Map(plans.map((plan) => [plan.day, plan]));
  const tests = await all(
    'SELECT day, metric, unit, score FROM assessments WHERE student = ? AND day < ? ORDER BY day, metric, unit',
    cycle.student,
    end
  );

  const weeks = Array.from({ length: cycle.weeks }, (_, index) => ({
    start: dayAt(cycle.start_day, index * 7),
    published: false,
    sessions: 0,
    reported: 0,
    planned: 0,
    completed: 0,
    rpe: null,
    volumeKg: null,
    volumeDeltaPct: null,
    topE1rms: [],
    tests: [],
  }));

  for (const row of published) {
    const week = weeks[row.idx];
    const snapshot = parseJson(row.days);
    const days = snapshot.days || snapshot;
    const ratings = [];
    const e1rmByExercise = new Map();
    let weekVolumeRaw = 0;
    week.published = true;

    days.forEach((items, dayOffset) => {
      if (!items.length) return;
      week.sessions += 1;
      const plan = byDate.get(dayAt(week.start, dayOffset));
      const effectiveItems = plan ? parseJson(plan.items) : items;
      week.planned += effectiveItems.reduce((total, item) => total + item.sets, 0);
      if (plan?.sets != null) {
        week.reported += 1;
        week.completed += parseJson(plan.sets).flat().filter(Boolean).length;
        if (plan.rpe != null) ratings.push(plan.rpe);
        if (plan.set_logs != null) {
          const metrics = computeSessionMetrics(effectiveItems, parseJson(plan.set_logs));
          if (metrics.totalVolumeKg > 0) {
            weekVolumeRaw += metrics.totalVolumeKg;
          }
          effectiveItems.forEach((item, idx) => {
            const best = metrics.exercises[idx]?.bestE1rmKg;
            if (best == null) return;
            const prev = e1rmByExercise.get(item.name);
            if (prev == null || best > prev) {
              e1rmByExercise.set(item.name, best);
            }
          });
        }
      }
    });

    if (ratings.length) {
      week.rpe = Math.round((10 * ratings.reduce((a, b) => a + b, 0)) / ratings.length) / 10;
    }
    if (weekVolumeRaw > 0) {
      week.volumeKg = Math.round(weekVolumeRaw * 10) / 10;
    }
    week.topE1rms = Array.from(e1rmByExercise, ([exercise, e1rmKg]) => ({ exercise, e1rmKg }))
      .sort((a, b) => b.e1rmKg - a.e1rmKg)
      .slice(0, 5);
  }

  let prevVolume = null;
  for (const week of weeks) {
    if (week.volumeKg != null && week.volumeKg > 0) {
      if (prevVolume != null && prevVolume > 0) {
        week.volumeDeltaPct = Math.round(((week.volumeKg - prevVolume) / prevVolume) * 1000) / 10;
      }
      prevVolume = week.volumeKg;
    }
  }

  const priorByMetric = new Map();
  for (const test of tests) {
    const key = JSON.stringify([test.metric, test.unit]);
    const previous = priorByMetric.get(key);
    priorByMetric.set(key, test);
    if (test.day < cycle.start_day) continue;
    const weekIndex = Math.floor((Date.parse(test.day) - Date.parse(cycle.start_day)) / 604800000);
    weeks[weekIndex].tests.push({
      ...test,
      delta: previous ? Number((test.score - previous.score).toFixed(6)) : null,
    });
  }

  return weeks;
}

export async function previousReview(all, cycle) {
  const candidates = await all(
    `SELECT c.id, c.start_day, c.weeks, c.goal, r.note
     FROM training_cycles c
     LEFT JOIN cycle_reviews r ON r.cycle = c.id
     WHERE c.student = ? AND c.start_day < ?
     ORDER BY c.start_day DESC, c.id`,
    cycle.student,
    cycle.start_day
  );
  const previous = candidates
    .filter((item) => dayAt(item.start_day, item.weeks * 7) <= cycle.start_day)
    .sort((a, b) => dayAt(b.start_day, b.weeks * 7).localeCompare(dayAt(a.start_day, a.weeks * 7)))[0];

  if (!previous?.note) return null;
  return {
    goal: previous.goal,
    start: previous.start_day,
    end: dayAt(previous.start_day, previous.weeks * 7 - 1),
    note: previous.note,
  };
}
