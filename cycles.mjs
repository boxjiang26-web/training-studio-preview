import {generateWeek} from './ai-week.mjs';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
const names=new Set(['徒手深蹲','髋部拉伸','俯卧撑','平板支撑','弹力带划船',...JSON.parse(fs.readFileSync(new URL('./catalog.json',import.meta.url),'utf8')).map(x=>x.name)]);
export const cycleSchema=`CREATE TABLE IF NOT EXISTS training_cycles(id TEXT PRIMARY KEY,student INTEGER NOT NULL REFERENCES students(id),goal TEXT NOT NULL,start_day TEXT NOT NULL,weeks INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cycle_weeks(cycle TEXT NOT NULL REFERENCES training_cycles(id),idx INTEGER NOT NULL,rev INTEGER NOT NULL,published INTEGER NOT NULL,days TEXT NOT NULL,PRIMARY KEY(cycle,idx));`;
function check(ok,msg,status=400){if(!ok)throw Object.assign(Error(msg),{status})}
export function shift(day,n){const d=new Date(day);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export async function publishedWeeks(all,owner){
 check(owner>0,'请选择学员视图',403);
 return (await all('SELECT c.goal,c.start_day,w.idx FROM training_cycles c JOIN cycle_weeks w ON w.cycle=c.id WHERE c.student=? AND w.published=1 ORDER BY c.start_day,w.idx',owner)).map(r=>({goal:r.goal,week:shift(r.start_day,7*r.idx),number:r.idx+1}));
}
function unpack(raw){const value=JSON.parse(raw);return Array.isArray(value)?{days:value}:value}
export async function cycles({one,all,run},action,b){
 const {student}=b;const person=Number.isInteger(student)&&await one('SELECT id,name FROM students WHERE id=?',student);check(person,'学员不存在');
 if(action==='create'){
  check(typeof b.goal==='string'&&b.goal.trim()&&b.goal.length<=300,'请输入周期目标');
  check(/^\d{4}-\d{2}-\d{2}$/.test(b.start)&&new Date(b.start).toJSON()?.slice(0,10)===b.start&&new Date(b.start).getUTCDay()===1,'开始日期须为周一');
  check(Number.isInteger(b.weeks)&&b.weeks>=2&&b.weeks<=52,'周期长度为 2–52 周');
  const id=randomUUID();await run('INSERT INTO training_cycles VALUES(?,?,?,?,?)',id,student,b.goal.trim(),b.start,b.weeks);return {id};
 }
 if(action==='list')return {cycles:await all('SELECT * FROM training_cycles WHERE student=? ORDER BY start_day DESC,id',student)};
 const c=await one('SELECT * FROM training_cycles WHERE student=? AND id=?',student,b.cycle||'');check(c,'周期不存在',404);
 check(Number.isInteger(b.idx)&&b.idx>=0&&b.idx<c.weeks,'周次无效');
 const get=i=>one('SELECT rev,published,days FROM cycle_weeks WHERE cycle=? AND idx=?',c.id,i);
 const row=await get(b.idx);
 if(action==='load')return row?{...row,...unpack(row.days)}:{rev:0,published:0,days:Array.from({length:7},()=>[])};
 check(!row?.published&&b.rev===(row?.rev||0),'本周已发布或版本已更新，请重新打开',409);
 if(action==='generate'){
  const week=shift(c.start_day,b.idx*7),first=shift(week,-7),last=shift(week,-1);
  const sessions=await all(`SELECT p.day,p.items,f.rpe,f.note,f.sets FROM plans p LEFT JOIN feedback f ON f.plan=p.id
    WHERE p.owner=? AND p.day BETWEEN ? AND ? AND p.rev=(SELECT MAX(q.rev) FROM plans q WHERE q.owner=p.owner AND q.day=p.day) ORDER BY p.day`,student,first,last);
  const decode=v=>typeof v==='string'?JSON.parse(v):v;
  const previous=sessions.map(x=>({day:x.day,plan:decode(x.items).map(({name,sets,qty,unit})=>({name,sets,qty,unit})),planned:decode(x.items).reduce((n,a)=>n+a.sets,0),completed:x.sets==null?null:decode(x.sets).flat().filter(Boolean).length,rpe:x.rpe,note:(x.note||'').replaceAll(person.name,'学员').slice(0,240)}));
  const memories=(await all("SELECT note FROM training_memory WHERE student=? AND status='已接受' ORDER BY created,id",student)).map(x=>x.note.replaceAll(person.name,'学员'));
  const context={cycleWeek:b.idx+1,cycleLength:c.weeks,previousStart:first,previousEnd:last,previous,memories};
  const result=await generateWeek(c.goal,person,week,context);
  const snapshot={days:result.days,reference:{reason:result.reason.slice(0,1200),...context}};
  const json=JSON.stringify(snapshot);
  const saved=row?await one('UPDATE cycle_weeks SET days=?,rev=rev+1 WHERE cycle=? AND idx=? AND rev=? AND published=0 RETURNING rev',json,c.id,b.idx,b.rev):await one('INSERT INTO cycle_weeks VALUES(?,?,1,0,?) ON CONFLICT(cycle,idx) DO NOTHING RETURNING rev',c.id,b.idx,json);
  check(saved,'周草稿已变化，请重新打开',409);return {...snapshot,rev:saved.rev,published:0};
 }
 if(action==='copy'){
  const prev=b.idx>0&&await get(b.idx-1);check(prev,'上一周尚未保存安排');
  check(Number.isInteger(b.percent)&&b.percent>=25&&b.percent<=200,'训练量比例为 25–200%');
  return {days:unpack(prev.days).days.map(day=>day.map(x=>({...x,qty:Math.max(1,Math.min(3600,Math.round(x.qty*b.percent/100)))})))};
 }
 check(['save','publish'].includes(action),'操作无效');
 const days=b.days;
 check(Array.isArray(days)&&days.length===7&&days.every(a=>Array.isArray(a)&&a.length<=50&&a.every(x=>x&&names.has(x.name)&&Number.isInteger(x.sets)&&x.sets>=1&&x.sets<=30&&Number.isInteger(x.qty)&&x.qty>=1&&x.qty<=3600&&['次','秒'].includes(x.unit))),'请检查每日动作和训练量');
 const published=action==='publish'?1:0;
 if(published)check(days.some(x=>x.length),'请至少编排一个训练日');
 const clean=days.map(a=>a.map(({name,sets,qty,unit})=>({name,sets,qty,unit})));const reference=row&&!b.discardReference?unpack(row.days).reference:null;const data=JSON.stringify({days:clean,reference});
 const saved=row?await one('UPDATE cycle_weeks SET days=?,rev=rev+1,published=? WHERE cycle=? AND idx=? AND rev=? AND published=0 RETURNING rev',data,published,c.id,b.idx,b.rev):await one('INSERT INTO cycle_weeks VALUES(?,?,1,?,?) ON CONFLICT(cycle,idx) DO NOTHING RETURNING rev',c.id,b.idx,published,data);
 check(saved,'周草稿已变化，请重新打开',409);
 if(published)for(const [i,a] of clean.entries()){if(!a.length)continue;const date=shift(c.start_day,7*b.idx+i),items=JSON.stringify(a.map(x=>({...x,id:randomUUID()})));
  const draft=await one('INSERT INTO drafts VALUES(?,?,1,?) ON CONFLICT(owner,day) DO NOTHING RETURNING owner',student,date,items);
  check(draft&&!await one('SELECT id FROM plans WHERE owner=? AND day=? LIMIT 1',student,date),date+' 已有计划或草稿，本周未发布',409);
  await run('INSERT INTO plans(owner,day,rev,items) VALUES(?,?,1,?)',student,date,items);
 }
 return {days:clean,reference,rev:saved.rev,published};
}