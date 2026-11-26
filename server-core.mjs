import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { studentReports } from './cycle-reports.mjs';
import { publishedWeeks } from './cycles.mjs';
import { messages } from './messages.mjs';
import { coachTools } from './coach-tools.mjs';
import { allowPreview } from './preview-access.mjs';
import { serveGif } from './exercise-media.mjs';
import {
  computeSessionMetrics,
  handleCustomExercises,
  listCustomExercises,
  normalizeExerciseItem,
  normalizeSetLogs,
} from './strength.mjs';
import { handleReadiness } from './readiness.mjs';
import { runCoachCopilot } from './coach-copilot.mjs';
import {
  extractSessionToken,
  handleAuthRoute,
  isPasswordAuthEnabled,
  isTrialAuthEnabled,
  issueStudentInvite,
  revokeStudentAccess,
} from './auth.mjs';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MOVES = ['徒手深蹲', '髋部拉伸', '俯卧撑', '平板支撑', '弹力带划船'];
const STATIC_FILES = {
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', contentType: 'text/css; charset=utf-8' },
};

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'catalog.json'), 'utf8'));
const catalogById = new Map(catalog.map((row) => [row.id, row]));
const catalogNames = new Set(catalog.map((row) => row.name));
const builtinNames = new Set([...DEFAULT_MOVES, ...catalogNames]);

const staticCache = new Map();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function check(ok, message, status = 400) {
  if (!ok) {
    throw Object.assign(new Error(message), { status });
  }
}

function decodeJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function isValidDate(day) {
  return (
    typeof day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    new Date(`${day}T00:00:00Z`).toJSON()?.startsWith(day) === true
  );
}

function addDays(day, offsetDays) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isJsonContentType(headerValue) {
  if (typeof headerValue !== 'string') return false;
  const mediaType = headerValue.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json';
}

function loadStaticAsset(fileName) {
  const fullPath = path.join(ROOT_DIR, fileName);
  const stat = fs.statSync(fullPath);
  const cached = staticCache.get(fileName);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }
  const raw = fs.readFileSync(fullPath);
  const gzipped = zlib.gzipSync(raw, { level: zlib.constants.Z_BEST_SPEED });
  const etag = `"${sha256(raw).slice(0, 16)}"`;
  const entry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    raw,
    gzipped,
    etag,
  };
  staticCache.set(fileName, entry);
  return entry;
}

function serveStaticAsset(pathname, req, res) {
  const target = STATIC_FILES[pathname];
  check(Boolean(target), '页面不存在', 404);
  const asset = loadStaticAsset(target.file);
  res.setHeader('Content-Type', target.contentType);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', asset.etag);
  res.setHeader('Vary', 'Accept-Encoding');

  if (req.headers['if-none-match'] === asset.etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (acceptEncoding.includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    res.end(asset.gzipped);
    return;
  }

  res.end(asset.raw);
}

async function readJsonBody(req, pathname) {
  check(isJsonContentType(req.headers['content-type']), '请求格式无效', 415);
  const maxBytes = pathname.startsWith('/api/coach/assessments/') ? 320000 : 65536;
  const parts = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    check(size <= maxBytes, '请求过大', 413);
    parts.push(chunk);
  }

  const rawText = Buffer.concat(parts).toString('utf8');
  if (!rawText) return {};
  try {
    return JSON.parse(rawText);
  } catch {
    check(false, '请求 JSON 格式无效', 400);
  }
}

async function handleApi(db, url, body, owner, isPost, req, res, rawToken) {
  const route = url.pathname;

  if (route.startsWith('/api/auth/')) {
    return handleAuthRoute(db, route, body, isPost, req, res, owner, rawToken);
  }

  if (route === '/api/trial' && isPost) {
    check(isTrialAuthEnabled(), '当前已启用正式认证，试验切换已关闭', 403);
    const id = body.student ?? 0;
    check(
      Number.isInteger(id) && (id === 0 || Boolean(await db.one('SELECT id FROM students WHERE id = ?', id))),
      '学员不存在',
      404
    );
    const token = randomBytes(32).toString('hex');
    await db.run('DELETE FROM sessions WHERE expires <= ?', Date.now());
    await db.run('INSERT INTO sessions VALUES(?,?,?)', sha256(token), id, Date.now() + 7 * 86400000);
    return { token };
  }

  check(owner !== undefined, isPasswordAuthEnabled() ? '请先登录工作台' : '请刷新试验页面', 401);

  if (route === '/api/cycle-reports' && !isPost) {
    return studentReports(db.all, owner);
  }
  if (route === '/api/cycle-weeks' && !isPost) {
    return publishedWeeks(db.all, owner);
  }
  if (route === '/api/readiness') {
    return isPost
      ? db.transaction(true, (tx) => handleReadiness(tx, url, body, owner, true))
      : handleReadiness(db, url, body, owner, false);
  }
  if (route.startsWith('/api/messages/')) {
    return messages(db, url, body, owner, isPost);
  }
  if (['/api/coach/ai/generate', '/api/coach/cycle/generate'].includes(route) && isPost) {
    return coachTools(db, route, body, url, isPost, owner);
  }
  if (route === '/api/coach/copilot' && isPost) {
    return runCoachCopilot(db, body, owner);
  }
  if (route === '/api/coach/exercises' || route === '/api/coach/exercises/delete') {
    check(owner === 0, '仅教练可用', 403);
    return db.transaction(isPost, (tx) => handleCustomExercises(tx, route, body, isPost, builtinNames));
  }
  if (route === '/api/coach/student/invite' && isPost) {
    check(owner === 0, '仅教练可用', 403);
    return db.transaction(true, (tx) => issueStudentInvite(tx, body.student));
  }
  if (route === '/api/coach/student/revoke' && isPost) {
    check(owner === 0, '仅教练可用', 403);
    return db.transaction(true, (tx) => revokeStudentAccess(tx, body.student));
  }
  if (route.startsWith('/api/coach/')) {
    return db.transaction(isPost, (tx) => coachTools(tx, route, body, url, isPost, owner));
  }

  if (route === '/api/me' && !isPost) {
    const isCoach = owner === 0;
    const studentRow = isCoach ? null : await db.one('SELECT name FROM students WHERE id = ?', owner);
    const customExercises = await listCustomExercises(db.all);
    return {
      studentId: owner,
      coach: isCoach,
      name: isCoach ? '教练' : studentRow.name,
      moves: DEFAULT_MOVES,
      customExercises,
      students: isCoach ? await db.all('SELECT id, name FROM students WHERE archived = 0 ORDER BY id DESC') : [],
      archivedStudents: isCoach
        ? await db.all('SELECT id, name FROM students WHERE archived = 1 ORDER BY id DESC')
        : [],
    };
  }

  if (route === '/api/students' && isPost) {
    check(owner === 0, '仅教练可用', 403);
    const name = String(body.name || '').trim();
    check(name.length > 0 && name.length <= 60, '请输入学员姓名');
    const id = await db.createStudent(name);
    return { id };
  }

  const sid = Number(isPost ? (body.student ?? owner) : (url.searchParams.get('student') || owner));
  check(owner === 0 || owner === sid, '无权访问此学员', 403);
  check(Boolean(await db.one('SELECT id FROM students WHERE id = ?', sid)), '学员不存在', 404);

  const day = String((isPost ? body.day : url.searchParams.get('day')) || '');
  check(isValidDate(day), '日期无效');

  if (route === '/api/calendar' && !isPost) {
    const end = addDays(day, 6);
    const days = new Map();
    const published = await db.all(
      `SELECT p.day, p.rev, p.items, f.rpe
       FROM plans p
       LEFT JOIN feedback f ON f.plan = p.id
       WHERE p.owner = ? AND p.day BETWEEN ? AND ?
         AND p.rev = (SELECT MAX(rev) FROM plans WHERE owner = p.owner AND day = p.day)`,
      sid,
      day,
      end
    );
    const extractNames = (row) => decodeJson(row.items).map((item) => item.name);

    for (const row of published) {
      days.set(row.day, {
        day: row.day,
        names: extractNames(row),
        published: true,
        revision: row.rev,
        rpe: row.rpe,
      });
    }

    if (owner === 0) {
      const drafts = await db.all(
        'SELECT day, rev, items FROM drafts WHERE owner = ? AND day BETWEEN ? AND ?',
        sid,
        day,
        end
      );
      for (const draftRow of drafts) {
        const entry = days.get(draftRow.day) || { day: draftRow.day, published: false };
        if (entry.revision !== draftRow.rev) {
          days.set(draftRow.day, { ...entry, dirty: true, names: extractNames(draftRow) });
        }
      }
    }

    const history =
      owner === 0
        ? []
        : (
            await db.all(
              'SELECT p.day, p.items, f.rpe FROM feedback f JOIN plans p ON p.id = f.plan WHERE p.owner = ? ORDER BY p.day DESC',
              sid
            )
          ).map((row) => ({ day: row.day, names: extractNames(row), rpe: row.rpe }));

    return { days: [...days.values()], history };
  }

  if (route === '/api/day' && !isPost) {
    const draft = await db.one('SELECT * FROM drafts WHERE owner = ? AND day = ?', sid, day);
    const plan = await db.one('SELECT * FROM plans WHERE owner = ? AND day = ? ORDER BY rev DESC LIMIT 1', sid, day);
    const fb = plan ? await db.one('SELECT * FROM feedback WHERE plan = ?', plan.id) : null;
    const planItems = plan ? decodeJson(plan.items) : null;
    const setLogs = fb?.set_logs ? decodeJson(fb.set_logs) : null;
    return {
      draft: owner === 0 && draft ? { rev: draft.rev, items: decodeJson(draft.items) } : null,
      plan: plan ? { id: plan.id, rev: plan.rev, items: planItems } : null,
      feedback: fb
        ? {
            id: fb.id,
            plan: fb.plan,
            rpe: fb.rpe,
            note: fb.note,
            sets: decodeJson(fb.sets),
            setLogs,
            metrics: setLogs ? computeSessionMetrics(planItems, setLogs) : null,
          }
        : null,
    };
  }

  if (route === '/api/feedback' && isPost) {
    check(owner !== 0, '仅学员可提交', 403);
    return db.transaction(true, async (tx) => {
      const plan = await tx.one('SELECT * FROM plans WHERE owner = ? AND day = ? ORDER BY rev DESC LIMIT 1', sid, day);
      const fb = plan ? await tx.one('SELECT * FROM feedback WHERE plan = ?', plan.id) : null;
      check(plan?.id === body.plan, '计划已更新，请刷新', 409);
      check(
        Number.isInteger(body.rpe) &&
          body.rpe >= 1 &&
          body.rpe <= 10 &&
          typeof body.note === 'string' &&
          body.note.length <= 1000,
        '反馈格式无效'
      );
      const items = decodeJson(plan.items);

      let normalizedSetLogs = null;
      let effectiveSets = body.sets;
      if (body.setLogs !== undefined && body.setLogs !== null) {
        normalizedSetLogs = normalizeSetLogs(body.setLogs, items);
        const derivedSets = normalizedSetLogs.map((row) => row.map((entry) => entry.done));
        if (effectiveSets === undefined) {
          effectiveSets = derivedSets;
        } else {
          check(JSON.stringify(effectiveSets) === JSON.stringify(derivedSets), '逐组勾选与执行记录不一致');
        }
      }

      check(
        Array.isArray(effectiveSets) &&
          effectiveSets.length === items.length &&
          effectiveSets.every(
            (row, index) =>
              Array.isArray(row) &&
              row.length === items[index].sets &&
              row.every((checked) => typeof checked === 'boolean')
          ),
        '组数无效'
      );

      const setsJson = JSON.stringify(effectiveSets);
      const setLogsJson = normalizedSetLogs ? JSON.stringify(normalizedSetLogs) : null;

      if (fb) {
        const storedSets = JSON.stringify(decodeJson(fb.sets));
        const storedSetLogs = fb.set_logs ? JSON.stringify(decodeJson(fb.set_logs)) : null;
        const setLogsMatch = body.setLogs === undefined ? true : storedSetLogs === setLogsJson;
        check(
          fb.note === body.note &&
            fb.rpe === body.rpe &&
            storedSets === setsJson &&
            setLogsMatch,
          '已提交过另一条反馈',
          409
        );
        return {
          id: fb.id,
          metrics: fb.set_logs ? computeSessionMetrics(items, decodeJson(fb.set_logs)) : null,
        };
      }
      const id = randomUUID();
      await tx.run(
        'INSERT INTO feedback(id, plan, rpe, note, sets, set_logs) VALUES(?,?,?,?,?,?)',
        id,
        plan.id,
        body.rpe,
        body.note,
        setsJson,
        setLogsJson
      );
      return {
        id,
        metrics: normalizedSetLogs ? computeSessionMetrics(items, normalizedSetLogs) : null,
      };
    });
  }

  check(owner === 0, '仅教练可用', 403);

  if (route === '/api/draft' && isPost) {
    return db.transaction(true, async (tx) => {
      const draft = await tx.one('SELECT * FROM drafts WHERE owner = ? AND day = ?', sid, day);
      check(body.rev === (draft?.rev || 0), '草稿已更新，请刷新', 409);
      check(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 50, '请检查动作、组数和训练量');
      const customRows = await tx.all('SELECT name FROM custom_exercises');
      const allowedNames = new Set([...builtinNames, ...customRows.map((row) => row.name)]);
      const items = body.items.map((item) => normalizeExerciseItem(item, allowedNames));
      await tx.upsertDraft(sid, day, body.rev + 1, JSON.stringify(items));
      return {};
    });
  }

  if (route === '/api/publish' && isPost) {
    return db.transaction(true, async (tx) => {
      const draft = await tx.one('SELECT * FROM drafts WHERE owner = ? AND day = ?', sid, day);
      const plan = await tx.one('SELECT * FROM plans WHERE owner = ? AND day = ? ORDER BY rev DESC LIMIT 1', sid, day);
      const fb = plan ? await tx.one('SELECT * FROM feedback WHERE plan = ?', plan.id) : null;
      check(Boolean(draft) && draft.rev === body.rev, '请先保存并刷新草稿', 409);
      check(!fb || plan.rev === draft.rev, '学员已完成本次训练，不能覆盖记录', 409);
      const itemsJson = typeof draft.items === 'string' ? draft.items : JSON.stringify(draft.items);
      await tx.insertPlanIfAbsent(sid, day, draft.rev, itemsJson);
      return {};
    });
  }

  check(false, '页面不存在', 404);
}

export function startServer(db, options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
  const port = Number(options.port ?? process.env.PORT ?? 4186);
  const host = options.host || process.env.HOST || '127.0.0.1';

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/healthz') {
        res.setHeader('Cache-Control', 'no-store');
        res.end('ok');
        return;
      }

      if (!allowPreview(req, res)) return;

      const previewMatch = /^\/exercise-preview\/(ready-ex-[0-9]+)\.gif$/.exec(url.pathname);
      if (previewMatch && req.method === 'GET') {
        await serveGif(catalogById.get(previewMatch[1]), dataDir, res);
        return;
      }

      if (!url.pathname.startsWith('/api/')) {
        serveStaticAsset(url.pathname, req, res);
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const isPost = req.method === 'POST';
      check(isPost || req.method === 'GET', '请求方式无效', 405);

      const body = isPost ? await readJsonBody(req, url.pathname) : {};
      const token = extractSessionToken(req);
      const session = token
        ? await db.one('SELECT owner FROM sessions WHERE token = ? AND expires > ?', sha256(token), Date.now())
        : null;
      const result = await handleApi(db, url, body, session?.owner, isPost, req, res, token);
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error.status || 500;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error.status ? error.message : '请求处理失败' }));
    }
  });

  server.listen(port, host, () => {
    console.log('训练工作台已启动');
  });

  return server;
}
