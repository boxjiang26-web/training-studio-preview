import {studentReports} from './cycle-reports.mjs';
import {publishedWeeks} from './cycles.mjs';
import {messageSchema,messages} from './messages.mjs';
import {coachSchema,coachTools} from './coach-tools.mjs';
import { allowPreview } from './preview-access.mjs';
import { serveGif } from './exercise-media.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const root = path.dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const hash = value => createHash('sha256').update(value).digest('hex');
const check = (ok, message, status = 400) => { if (!ok) throw Object.assign(Error(message), { status }); };
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
const byId = new Map(catalog.map(row => [row.id, row]));
const catalogNames = new Set(catalog.map(row => row.name));
const moves = ['徒手深蹲', '髋部拉伸', '俯卧撑', '平板支撑', '弹力带划船'];
const sql = query => query.replace(/\?/g, () => `$${++sql.index}`);
async function query(text, values = []) { sql.index = 0; return pool.query(sql(text), values); }
const one = async (text, ...values) => (await query(text, values)).rows[0];
const all = async (text, ...values) => (await query(text, values)).rows;
const run = async (text, ...values) => query(text, values);

await pool.query(`CREATE TABLE IF NOT EXISTS students(id SERIAL PRIMARY KEY, name TEXT NOT NULL, invite TEXT, expires BIGINT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, owner INTEGER NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts(owner INTEGER NOT NULL, day TEXT NOT NULL, rev INTEGER NOT NULL, items JSONB NOT NULL, PRIMARY KEY(owner, day));
CREATE TABLE IF NOT EXISTS plans(id SERIAL PRIMARY KEY, owner INTEGER NOT NULL, day TEXT NOT NULL, rev INTEGER NOT NULL, items JSONB NOT NULL, UNIQUE(owner, day, rev));
CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, plan INTEGER UNIQUE NOT NULL, rpe INTEGER NOT NULL, note TEXT NOT NULL, sets JSONB NOT NULL);`);

await pool.query(coachSchema+messageSchema(true));
async function api(url, body, owner, isPost) {
  const route = url.pathname;
  if (route === '/api/trial' && isPost) {
    const id = body.student ?? 0;
    check(Number.isInteger(id) && (id === 0 || await one('SELECT id FROM students WHERE id=?', id)), '学员不存在', 404);
    const token = randomBytes(32).toString('hex');
    await run('DELETE FROM sessions WHERE expires<=?', Date.now());
    await run('INSERT INTO sessions VALUES(?,?,?)', hash(token), id, Date.now() + 7 * 86400000);
    return { token };
  }
  check(owner !== undefined, '请刷新试验页面', 401);
 if(route==='/api/cycle-reports'&&!isPost)return studentReports(all,owner);
 if(route==='/api/cycle-weeks'&&!isPost)return publishedWeeks(all,owner);
 if(route.startsWith('/api/messages/'))return messages({one,all,run},url,body,owner,isPost);
 if(['/api/coach/ai/generate','/api/coach/cycle/generate'].includes(route)&&isPost)return coachTools({one,all,run},route,body,url,isPost,owner);
  if(route.startsWith('/api/coach/')){
    const client=await pool.connect();
    const execute=(text,...values)=>{let n=0;return client.query(text.replace(/\?/g,()=>'$'+(++n)),values)};
    try{
      await client.query('BEGIN');
      const result=await coachTools({run:execute,one:async(...args)=>(await execute(...args)).rows[0],all:async(...args)=>(await execute(...args)).rows},route,body,url,isPost,owner);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  if (route === '/api/me' && !isPost) return { studentId:owner, coach: owner === 0, name: owner === 0 ? '教练' : (await one('SELECT name FROM students WHERE id=?', owner)).name, moves, students: owner === 0 ? await all('SELECT id,name FROM students ORDER BY id DESC') : [] };
  if (route === '/api/students' && isPost) {
    check(owner === 0, '仅教练可用', 403);
    const name = String(body.name || '').trim(); check(name && name.length <= 60, '请输入学员姓名');
    const row = await one('INSERT INTO students(name) VALUES(?) RETURNING id', name); return { id: row.id };
  }
  const sid = Number(isPost ? (body.student ?? owner) : (url.searchParams.get('student') || owner));
  check(owner === 0 || owner === sid, '无权访问此学员', 403);
  check(await one('SELECT id FROM students WHERE id=?', sid), '学员不存在', 404);
  const day = String((isPost ? body.day : url.searchParams.get('day')) || '');
  check(/^\d{4}-\d{2}-\d{2}$/.test(day), '日期无效');
  if (route === '/api/calendar' && !isPost) {
    const end = (await one("SELECT ($1::date + interval '6 days')::text AS last", day)).last;
    const days = new Map();
    const published = await all(`SELECT p.day,p.rev,p.items,f.rpe FROM plans p LEFT JOIN feedback f ON f.plan=p.id WHERE p.owner=? AND p.day BETWEEN ? AND ? AND p.rev=(SELECT MAX(rev) FROM plans WHERE owner=p.owner AND day=p.day)`, sid, day, end);
    const names = row => row.items.map(item => item.name);
    for (const row of published) days.set(row.day, { day: row.day, names: names(row), published: true, revision: row.rev, rpe: row.rpe });
    if (owner === 0) for (const draft of await all('SELECT day,rev,items FROM drafts WHERE owner=? AND day BETWEEN ? AND ?', sid, day, end)) {
      const entry = days.get(draft.day) || { day: draft.day, published: false };
      if (entry.revision !== draft.rev) days.set(draft.day, { ...entry, dirty: true, names: names(draft) });
    }
    const history = owner === 0 ? [] : (await all('SELECT p.day,p.items,f.rpe FROM feedback f JOIN plans p ON p.id=f.plan WHERE p.owner=? ORDER BY p.day DESC', sid)).map(row => ({ day: row.day, names: names(row), rpe: row.rpe }));
    return { days: [...days.values()], history };
  }
  const draft = await one('SELECT * FROM drafts WHERE owner=? AND day=?', sid, day);
  const plan = await one('SELECT * FROM plans WHERE owner=? AND day=? ORDER BY rev DESC LIMIT 1', sid, day);
  const fb = plan && await one('SELECT * FROM feedback WHERE plan=?', plan.id);
  if (route === '/api/day' && !isPost) return { draft: owner === 0 && draft ? { rev: draft.rev, items: draft.items } : null, plan: plan ? { id: plan.id, rev: plan.rev, items: plan.items } : null, feedback: fb ? { ...fb, sets: fb.sets } : null };
  if (route === '/api/feedback' && isPost) {
    check(owner !== 0, '仅学员可提交', 403); check(plan?.id === body.plan, '计划已更新，请刷新', 409);
    check(Number.isInteger(body.rpe) && body.rpe >= 1 && body.rpe <= 10 && typeof body.note === 'string' && body.note.length <= 1000, '反馈格式无效');
    check(Array.isArray(body.sets) && body.sets.length === plan.items.length && body.sets.every((row, i) => Array.isArray(row) && row.length === plan.items[i].sets && row.every(value => typeof value === 'boolean')), '组数无效');
    if (fb) { check(fb.note === body.note && fb.rpe === body.rpe && JSON.stringify(fb.sets) === JSON.stringify(body.sets), '已提交过另一条反馈', 409); return { id: fb.id }; }
    const id = randomUUID(); await run('INSERT INTO feedback VALUES(?,?,?,?,?)', id, plan.id, body.rpe, body.note, JSON.stringify(body.sets)); return { id };
  }
  check(owner === 0, '仅教练可用', 403);
  if (route === '/api/draft' && isPost) {
    check(body.rev === (draft?.rev || 0), '草稿已更新，请刷新', 409);
    check(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 50 && body.items.every(i => (moves.includes(i.name) || catalogNames.has(i.name)) && Number.isInteger(i.sets) && i.sets >= 1 && i.sets <= 30 && ['次', '秒'].includes(i.unit) && Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= 3600), '请检查动作、组数和训练量');
    const items = body.items.map(({ name, sets, qty, unit }) => ({ id: randomUUID(), name, sets, qty, unit }));
    await run('INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(owner,day) DO UPDATE SET rev=EXCLUDED.rev,items=EXCLUDED.items', sid, day, body.rev + 1, JSON.stringify(items)); return {};
  }
  if (route === '/api/publish' && isPost) { check(draft && draft.rev === body.rev, '请先保存并刷新草稿', 409); check(!fb || plan.rev === draft.rev, '学员已完成本次训练，不能覆盖记录', 409); await run('INSERT INTO plans(owner,day,rev,items) VALUES(?,?,?,?) ON CONFLICT(owner,day,rev) DO NOTHING', sid, day, draft.rev, JSON.stringify(draft.items)); return {}; }
  throw Object.assign(Error('页面不存在'), { status: 404 });
}

const server = http.createServer(async (req, res) => { try {
  const u = new URL(req.url, 'http://localhost'); res.setHeader('Cache-Control', 'no-store');
  if (u.pathname === '/healthz') { res.end('ok'); return; }
  if (!allowPreview(req, res)) return;
  const preview = /^\/exercise-preview\/(ready-ex-[0-9]+)\.gif$/.exec(u.pathname); if (preview && req.method === 'GET') { await serveGif(byId.get(preview[1]), process.env.DATA_DIR || root, res); return; }
  if (!u.pathname.startsWith('/api/')) { const file = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' }[u.pathname]; check(typeof file === 'string', '页面不存在', 404); res.setHeader('Content-Type', ({ 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript', 'style.css': 'text/css' })[file]); res.end(fs.readFileSync(path.join(root, file))); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); const post = req.method === 'POST'; check(post || req.method === 'GET', '请求方式无效', 405);
  let body = {}; if (post) { check(req.headers['content-type'] === 'application/json', '请求格式无效', 415); const parts = []; let size=0;for await (const chunk of req){ size+=chunk.length;check(size<=(u.pathname.startsWith('/api/coach/assessments/')?320000:65536),'请求过大',413);parts.push(chunk); } body = JSON.parse(Buffer.concat(parts).toString() || '{}'); }
  const token = String(req.headers['x-studio-session'] || ''); const owner = (await one('SELECT owner FROM sessions WHERE token=? AND expires>?', hash(token), Date.now()))?.owner;
  res.end(JSON.stringify(await api(u, body, owner, post)));
} catch (error) { res.statusCode = error.status || 500; res.end(JSON.stringify({ error: error.status ? error.message : '请求处理失败' })); } });
server.listen(Number(process.env.PORT || 4186), process.env.HOST || '127.0.0.1', () => console.log('训练工作台已启动'));
