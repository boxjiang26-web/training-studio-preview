import {studentReports} from './cycle-reports.mjs';
import {publishedWeeks} from './cycles.mjs';
import {messageSchema,messages} from './messages.mjs';
import {coachSchema,coachTools} from './coach-tools.mjs';
import {allowPreview} from './preview-access.mjs';
import {serveGif} from './exercise-media.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)), dir=process.env.DATA_DIR||path.join(root,'data');
fs.mkdirSync(dir,{recursive:true});
const hash=v=>createHash('sha256').update(v).digest('hex');
const db=new DatabaseSync(path.join(dir,'studio.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY,name TEXT,invite TEXT,expires INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,owner INTEGER,expires INTEGER);
CREATE TABLE IF NOT EXISTS drafts(owner INTEGER,day TEXT,rev INTEGER,items TEXT,PRIMARY KEY(owner,day));
CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY,owner INTEGER,day TEXT,rev INTEGER,items TEXT,UNIQUE(owner,day,rev));
CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,plan INTEGER UNIQUE,rpe INTEGER,note TEXT,sets TEXT);
`);
const one=(sql,...v)=>db.prepare(sql).get(...v), all=(sql,...v)=>db.prepare(sql).all(...v), run=(sql,...v)=>db.prepare(sql).run(...v);
const check=(ok,msg,status=400)=>{if(!ok)throw Object.assign(Error(msg),{status})};
const moves=['徒手深蹲','髋部拉伸','俯卧撑','平板支撑','弹力带划船'];
const catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));
const byId=new Map(catalog.map(row=>[row.id,row]));
const catalogNames=new Set(catalog.map(row=>row.name));
db.exec(coachSchema+messageSchema());
async function api(url,b,owner,isPost,res){
 const route=url.pathname;
 if(route==='/api/trial'&&isPost){
 const id=b.student??0;
 check(Number.isInteger(id)&&(id===0||one('SELECT id FROM students WHERE id=?',id)),'学员不存在',404);
 const token=randomBytes(32).toString('hex');
 run('DELETE FROM sessions WHERE expires<=?',Date.now());
 run('INSERT INTO sessions VALUES(?,?,?)',hash(token),id,Date.now()+7*86400000);
 return {token};}
 check(owner!==undefined,'请刷新试验页面',401);
 if(route==='/api/cycle-reports'&&!isPost)return studentReports(all,owner);
 if(route==='/api/cycle-weeks'&&!isPost)return publishedWeeks(all,owner);
 if(route.startsWith('/api/messages/'))return messages({one,all,run},url,b,owner,isPost);
 if(['/api/coach/ai/generate','/api/coach/cycle/generate'].includes(route)&&isPost)return coachTools({one,all,run},route,b,url,isPost,owner);
 if(route.startsWith('/api/coach/')){
   db.exec(isPost?'BEGIN IMMEDIATE':'BEGIN');
   try{const result=await coachTools({one,all,run},route,b,url,isPost,owner);db.exec('COMMIT');return result}
   catch(error){db.exec('ROLLBACK');throw error}
 }
 if(route==='/api/me'&&!isPost)return {studentId:owner,coach:owner===0,name:owner===0?'教练':one('SELECT name FROM students WHERE id=?',owner).name,moves,students:owner===0?all('SELECT id,name FROM students ORDER BY id DESC'):[]};
 if(route==='/api/students'&&isPost){check(owner===0,'仅教练可用',403);const name=String(b.name||'').trim();check(name&&name.length<=60,'请输入学员姓名');const id=Number(run('INSERT INTO students(name) VALUES(?)',name).lastInsertRowid);return {id};}
 const sid=Number(isPost?(b.student??owner):url.searchParams.get('student')||owner);
 check(owner===0||owner===sid,'无权访问此学员',403);check(one('SELECT id FROM students WHERE id=?',sid),'学员不存在',404);
 const day=String((isPost?b.day:url.searchParams.get('day'))||'');check(/^\d{4}-\d{2}-\d{2}$/.test(day)&&new Date(day).toJSON()?.startsWith(day),'日期无效');
 if(route==='/api/calendar'&&!isPost){
   const end=one("SELECT date(?, '+6 days') AS last",day).last;
   const days=new Map();
   const published=all(`SELECT p.day,p.rev,p.items,f.rpe FROM plans p LEFT JOIN feedback f ON f.plan=p.id
     WHERE p.owner=? AND p.day BETWEEN ? AND ? AND p.rev=(SELECT MAX(rev) FROM plans WHERE owner=p.owner AND day=p.day)`,sid,day,end);
   const names=row=>JSON.parse(row.items).map(item=>item.name);
   for(const row of published)days.set(row.day,{day:row.day,names:names(row),published:true,revision:row.rev,rpe:row.rpe});
   if(owner===0){
     for(const draft of all('SELECT day,rev,items FROM drafts WHERE owner=? AND day BETWEEN ? AND ?',sid,day,end)){
       const entry=days.get(draft.day)||{day:draft.day,published:false};
       if(entry.revision!==draft.rev)days.set(draft.day,{...entry,dirty:true,names:names(draft)});
     }
   }
   const history=owner===0?[]:all('SELECT p.day,p.items,f.rpe FROM feedback f JOIN plans p ON p.id=f.plan WHERE p.owner=? ORDER BY p.day DESC',sid)
     .map(row=>({day:row.day,names:names(row),rpe:row.rpe}));
   return {days:[...days.values()],history};
 }
 const draft=one('SELECT * FROM drafts WHERE owner=? AND day=?',sid,day);
 const plan=one('SELECT * FROM plans WHERE owner=? AND day=? ORDER BY rev DESC LIMIT 1',sid,day);
 const fb=plan&&one('SELECT * FROM feedback WHERE plan=?',plan.id);
 if(route==='/api/day'&&!isPost)return {draft:owner===0&&draft?{rev:draft.rev,items:JSON.parse(draft.items)}:null,plan:plan?{id:plan.id,rev:plan.rev,items:JSON.parse(plan.items)}:null,feedback:fb?{...fb,sets:JSON.parse(fb.sets)}:null};
 if(route==='/api/feedback'&&isPost){check(owner!==0,'仅学员可提交',403);check(plan?.id===b.plan,'计划已更新，请刷新',409);check(Number.isInteger(b.rpe)&&b.rpe>=1&&b.rpe<=10&&typeof b.note==='string'&&b.note.length<=1000,'反馈格式无效');const items=JSON.parse(plan.items);
 check(Array.isArray(b.sets)&&b.sets.length===items.length&&b.sets.every((row,i)=>Array.isArray(row)&&row.length===items[i].sets&&row.every(v=>typeof v==='boolean')),'组数无效');
 if(fb){check(fb.note===b.note&&fb.rpe===b.rpe&&fb.sets===JSON.stringify(b.sets),'已提交过另一条反馈',409);return {id:fb.id};}
 const id=randomUUID();run('INSERT INTO feedback VALUES(?,?,?,?,?)',id,plan.id,b.rpe,b.note,JSON.stringify(b.sets));return {id};}
 check(owner===0,'仅教练可用',403);
 if(route==='/api/draft'&&isPost){check(b.rev===(draft?.rev||0),'草稿已更新，请刷新',409);
 check(Array.isArray(b.items)&&b.items.length>0&&b.items.length<=50&&b.items.every(i=>(moves.includes(i.name)||catalogNames.has(i.name))&&Number.isInteger(i.sets)&&i.sets>=1&&i.sets<=30&&['次','秒'].includes(i.unit)&&Number.isInteger(i.qty)&&i.qty>=1&&i.qty<=3600),'请检查动作、组数和训练量');
 const items=b.items.map(({name,sets,qty,unit})=>({id:randomUUID(),name,sets,qty,unit}));run('INSERT OR REPLACE INTO drafts VALUES(?,?,?,?)',sid,day,b.rev+1,JSON.stringify(items));return {};}
 if(route==='/api/publish'&&isPost){check(draft&&draft.rev===b.rev,'请先保存并刷新草稿',409);check(!fb||plan.rev===draft.rev,'学员已完成本次训练，不能覆盖记录',409);run('INSERT OR IGNORE INTO plans(owner,day,rev,items) VALUES(?,?,?,?)',sid,day,draft.rev,draft.items);return {};}
 check(false,'页面不存在',404);
}
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(u.pathname==='/healthz'){res.end('ok');return}
 if(!allowPreview(req,res))return;
 const preview=/^\/exercise-preview\/(ready-ex-[0-9]+)\.gif$/.exec(u.pathname);
 if(preview&&req.method==='GET'){await serveGif(byId.get(preview[1]),dir,res);return}
 if(!u.pathname.startsWith('/api/')){const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[u.pathname];check(typeof file==='string','页面不存在',404);res.setHeader('Content-Type',({'index.html':'text/html; charset=utf-8','app.js':'text/javascript','style.css':'text/css'})[file]);return res.end(fs.readFileSync(path.join(root,file)));}
 res.setHeader('Content-Type','application/json; charset=utf-8');const post=req.method==='POST';check(post||req.method==='GET','请求方式无效',405);
 let body={};if(post){check(req.headers['content-type']==='application/json','请求格式无效',415);let parts=[],size=0;for await(const chunk of req){size+=chunk.length;check(size<=(u.pathname.startsWith('/api/coach/assessments/')?320000:65536),'请求过大',413);parts.push(chunk);}body=JSON.parse(Buffer.concat(parts).toString()||'{}');}
 const token=String(req.headers['x-studio-session']||'');
 const sessionHash=hash(token);const owner=one('SELECT owner FROM sessions WHERE token=? AND expires>?',sessionHash,Date.now())?.owner;
 res.end(JSON.stringify(await api(u,body,owner,post,res)));}catch(e){res.statusCode=e.status||500;res.end(JSON.stringify({error:e.status?e.message:'请求处理失败'}));}
}).listen(Number(process.env.PORT||4186),process.env.HOST||'127.0.0.1',()=>console.log('训练工作台已启动'));