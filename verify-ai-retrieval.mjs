import assert from 'node:assert/strict';
import { selectCandidateExercises, searchExercises } from './exercise-retriever.mjs';
import { normalizeAiDays } from './ai-week.mjs';

const base = process.env.STUDIO_URL || 'http://127.0.0.1:4186';

// 1. Retriever precision tests across goals, constraints, and custom exercises.
{
  const custom = [
    {
      id: 'custom-rehab-1',
      name: '单腿离心下蹲康复',
      category: 'prep_recovery',
      muscles: ['股四头肌', '膝稳定'],
      equipment: ['徒手'],
      notes: '慢速离心 4 秒',
      custom: true,
    },
  ];

  // Lower-body goal should recall predominantly lower_strength / power_conditioning + custom exercise.
  const lower = selectCandidateExercises({
    goal: '提高下肢深蹲力量与立定跳远爆发力，杠铃为主',
    customExercises: custom,
    limit: 50,
  });
  assert.equal(lower.length, 50);
  assert.ok(lower.some((item) => item.name === '单腿离心下蹲康复'), 'Custom exercise must always be surfaced');
  const lowerCategoryCount = lower.filter((item) =>
    ['lower_strength', 'power_conditioning'].includes(item.category)
  ).length;
  assert.ok(lowerCategoryCount >= 20, `Expected >=20 lower/power candidates, got ${lowerCategoryCount}`);

  // No-equipment home goal should prioritize bodyweight movements.
  const home = selectCandidateExercises({
    goal: '居家无器械徒手核心稳定与恢复训练',
    customExercises: custom,
    limit: 40,
  });
  const bodyweightCount = home.filter(
    (item) => !item.equipment.length || item.equipment.some((eq) => /徒手|自重|无/.test(eq))
  ).length;
  assert.ok(bodyweightCount >= 20, `Expected >=20 bodyweight candidates for home goal, got ${bodyweightCount}`);

  // Recent exercise continuity should always keep recently performed exercises.
  const recent = selectCandidateExercises({
    goal: '上肢推拉平衡训练',
    recentExerciseNames: ['超负荷离心深蹲'],
    limit: 40,
  });
  assert.ok(recent.some((item) => item.name === '超负荷离心深蹲'), 'Recent exercise must be retained');

  // Search helper should find custom and catalog exercises cleanly.
  const found = searchExercises({ query: '单腿离心下蹲康复', customExercises: custom });
  assert.equal(found.length, 1);
  assert.equal(found[0].custom, true);

  console.log('PASS exercise retriever precision (lower/barbell, home bodyweight, custom priority, recent continuity)');
}

// 2. Structured AI output parser & validation tests.
{
  const allowed = new Set(['徒手深蹲', '单腿离心下蹲康复']);
  const valid = normalizeAiDays(
    [
      [
        {
          name: '单腿离心下蹲康复',
          sets: 3,
          qty: 8,
          unit: '次',
          load: 40,
          loadUnit: 'kg',
          targetRpe: 7.5,
          restSec: 120,
          tempo: '4-1-1-0',
          cue: '膝盖对准脚尖',
        },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ],
    allowed
  );
  assert.ok(valid);
  assert.equal(valid[0][0].load, 40);
  assert.equal(valid[0][0].targetRpe, 7.5);
  assert.equal(valid[0][0].restSec, 120);
  assert.equal(valid[0][0].tempo, '4-1-1-0');

  // Reject hallucinated exercise name not in allowed pool.
  const bad = normalizeAiDays(
    [[{ name: '虚构的动作名称', sets: 3, qty: 10, unit: '次' }], [], [], [], [], [], []],
    allowed
  );
  assert.equal(bad, null);
  console.log('PASS AI structured strength normalization & hallucinated-exercise rejection');
}

// 3. API integration: /api/coach/ai/load exposes newly created custom exercise.
{
  const req = async (route, token, body) => {
    const res = await fetch(base + '/api/' + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-studio-session': token },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };

  const coachToken = (await req('trial', '', {})).data.token;
  const studentId = (await req('students', coachToken, { name: `AI检索验收-${Date.now().toString(36)}` })).data.id;
  const exName = `AI自定义动作-${Date.now().toString(36)}`;
  assert.equal((await req('coach/exercises', coachToken, { name: exName, category: 'core' })).status, 200);
  const loaded = await req('coach/ai/load', coachToken, { student: studentId, week: '2026-12-07' });
  assert.equal(loaded.status, 200);
  assert.ok(loaded.data.moves.includes(exName), '/api/coach/ai/load must expose custom exercises');
  console.log('PASS /api/coach/ai/load includes custom exercises');
}
