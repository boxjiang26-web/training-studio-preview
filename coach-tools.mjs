import {cycles,cycleSchema} from './cycles.mjs';
import {trainingMemory,memorySchema} from './training-memory.mjs';
import {aiWeek,aiSchema} from './ai-week.mjs';
import {assessments,assessmentSchema} from './assessments.mjs';
import {randomUUID} from 'node:crypto';

export const coachSchema=cycleSchema+memorySchema+aiSchema+assessmentSchema+`
CREATE TABLE IF NOT EXISTS training_teams(id TEXT PRIMARY KEY,name TEXT NOT NULL,members TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS training_templates(id TEXT PRIMARY KEY,name TEXT NOT NULL,items TEXT NOT NULL);
`;
const decode=v=>typeof v==='string'?JSON.parse(v):v;
function requireValue(ok,message,status=400){if(!ok)throw Object.assign(Error(message),{status})}
function cleanName(value){requireValue(typeof value==='string'&&value.trim().length>0&&value.trim().length<=60,'名称须为 1–60 个字');return value.trim()}
function checkDay(day){requireValue(typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&new Date(day).toJSON()?.slice(0,10)===day,'请选择有效日期')}
export async function coachTools({one,all,run},route,body,url,post,owner){
  requireValue(owner===0,'仅教练可用',403);
  if(route.startsWith('/api/coach/cycle/')&&post)return cycles({one,all,run},route.split('/').pop(),body);
  if(route.startsWith('/api/coach/memory/')&&post)return trainingMemory({one,all,run},route.split('/').pop(),body);
  if(route.startsWith('/api/coach/ai/')&&post)return aiWeek({one,all},route.split('/').pop(),body,owner);
  if(route==='/api/coach/personal-report'&&!post){
    const id=Number(url.searchParams.get('student')),start=url.searchParams.get('start'),end=url.searchParams.get('end');
    checkDay(start);checkDay(end);requireValue(start<=end,'结束日期应在开始日期之后');
    const student=await one('SELECT id,name FROM students WHERE id=?',id);requireValue(student,'学员不存在',404);
    const plans=await all(`SELECT p.day,p.items,f.sets,f.rpe FROM plans p LEFT JOIN feedback f ON f.plan=p.id WHERE p.owner=? AND p.day BETWEEN ? AND ? AND p.rev=(SELECT MAX(q.rev) FROM plans q WHERE q.owner=p.owner AND q.day=p.day) ORDER BY p.day`,id,start,end);
    const sessions=plans.map(p=>({day:p.day,total:decode(p.items).reduce((n,x)=>n+x.sets,0),done:p.sets?decode(p.sets).flat().filter(Boolean).length:0,rpe:p.rpe}));
    const scores=await all('SELECT day,metric,unit,score FROM assessments WHERE student=? AND day BETWEEN ? AND ? ORDER BY metric,unit,day',id,start,end);
    return {student,start,end,sessions,scores};
  }

  if(route.startsWith('/api/coach/assessments/'))return assessments({all,one},route,body,url,post);
  if(route==='/api/coach/resources'&&!post){
    const teams=(await all('SELECT * FROM training_teams ORDER BY name,id')).map(t=>({...t,members:decode(t.members)}));
    const templates=(await all('SELECT * FROM training_templates ORDER BY name,id')).map(t=>({...t,items:decode(t.items)}));
    return {teams,templates};
  }
  if(route==='/api/coach/team'&&post){
    const name=cleanName(body.name);
    requireValue(Array.isArray(body.members)&&body.members.length>0&&body.members.length<=200,'请选择 1–200 名学员');
    const members=[...new Set(body.members)],known=new Set((await all('SELECT id FROM students')).map(s=>s.id));
    requireValue(members.every(id=>known.has(id)),'学员不存在');
    const id=randomUUID();await run('INSERT INTO training_teams VALUES(?,?,?)',id,name,JSON.stringify(members));return {id};
  }
  if(route==='/api/coach/template'&&post){
    checkDay(body.day);const name=cleanName(body.name);
    const draft=await one('SELECT items FROM drafts WHERE owner=? AND day=?',body.student,body.day);
    requireValue(draft,'请先在个人日计划中保存草稿');
    const id=randomUUID();await run('INSERT INTO training_templates VALUES(?,?,?)',id,name,JSON.stringify(decode(draft.items)));return {id};
  }
  const teamId=post?body.team:url.searchParams.get('team');
  const team=await one('SELECT members FROM training_teams WHERE id=?',teamId||'');
  requireValue(team,'请先选择团队');const members=decode(team.members);
  if(route==='/api/coach/distribute'&&post){
    checkDay(body.day);const template=await one('SELECT items FROM training_templates WHERE id=?',body.template||'');
    requireValue(template,'请选择训练模板');const published=[],skipped=[];
    for(const id of members){
      const items=JSON.stringify(decode(template.items).map(x=>({...x,id:randomUUID()})));
      const occupied=await one('SELECT id FROM plans WHERE owner=? AND day=? LIMIT 1',id,body.day);
      if(occupied){skipped.push(id);continue}
      const inserted=await one('INSERT INTO drafts(owner,day,rev,items) VALUES(?,?,1,?) ON CONFLICT(owner,day) DO NOTHING RETURNING owner',id,body.day,items);
      if(!inserted){skipped.push(id);continue}
      await run('INSERT INTO plans(owner,day,rev,items) VALUES(?,?,1,?)',id,body.day,items);published.push(id);
    }
    return {published,skipped};
  }
  if(route==='/api/coach/report'&&!post){
    const day=url.searchParams.get('day');checkDay(day);
    const start=new Date(day);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
    const first=start.toISOString().slice(0,10),last=end.toISOString().slice(0,10);
    const placeholders=members.map(()=>'?').join(',');
    const records=await all(`SELECT s.name,p.owner,p.day,p.items,f.rpe,f.sets,f.note FROM plans p JOIN students s ON s.id=p.owner LEFT JOIN feedback f ON f.plan=p.id WHERE p.owner IN (${placeholders}) AND p.day BETWEEN ? AND ? AND p.rev=(SELECT MAX(q.rev) FROM plans q WHERE q.owner=p.owner AND q.day=p.day) ORDER BY p.day,s.name,p.owner`,...members,first,last);
    const rows=records.map(r=>({name:r.name,student:r.owner,day:r.day,exercises:decode(r.items).map(x=>x.name).join('、'),planned:decode(r.items).reduce((s,x)=>s+x.sets,0),done:r.sets?decode(r.sets).flat().filter(Boolean).length:0,rpe:r.rpe,note:r.note}));
    const submitted=rows.filter(r=>r.rpe!=null);
    return {first,last,rows,planned:rows.length,submitted:submitted.length,mean:submitted.length?Math.round(submitted.reduce((s,r)=>s+r.rpe,0)*10/submitted.length)/10:null};
  }
  requireValue(false,'页面不存在',404);
}