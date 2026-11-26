import {cycles,cycleSchema} from './cycles.mjs';
import {trainingMemory,memorySchema} from './training-memory.mjs';
import {aiWeek,aiSchema} from './ai-week.mjs';
import {assessments,assessmentSchema} from './assessments.mjs';
import {computeSessionMetrics} from './strength.mjs';
import {isLowReadiness} from './readiness.mjs';
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
  if(route==='/api/coach/overview'&&!post){
    const day=url.searchParams.get('day');checkDay(day);
    const weekAgoDate=new Date(day+'T00:00:00Z');weekAgoDate.setUTCDate(weekAgoDate.getUTCDate()-6);
    const weekAgo=weekAgoDate.toISOString().slice(0,10);
    const activeStudents=await all('SELECT id,name FROM students WHERE archived=0 ORDER BY id DESC');
    const todayPlans=await all(`SELECT p.owner,p.items,f.rpe,f.sets,f.set_logs FROM plans p LEFT JOIN feedback f ON f.plan=p.id WHERE p.day=? AND p.rev=(SELECT MAX(q.rev) FROM plans q WHERE q.owner=p.owner AND q.day=p.day)`,day);
    const todayDrafts=await all('SELECT owner FROM drafts WHERE day=?',day);
    const highRpeRows=await all(`SELECT s.id,s.name,p.day,f.rpe FROM feedback f JOIN plans p ON p.id=f.plan JOIN students s ON s.id=p.owner WHERE s.archived=0 AND p.day BETWEEN ? AND ? AND f.rpe>=9 ORDER BY p.day DESC,f.rpe DESC LIMIT 12`,weekAgo,day);
    const unreadRows=await all("SELECT student,COUNT(*) AS count FROM messages WHERE sender='student' AND seen=0 GROUP BY student");
    const pendingMemRow=await one("SELECT COUNT(*) AS count FROM training_memory m JOIN students s ON s.id=m.student WHERE s.archived=0 AND m.status='待审核'");
    const readinessRows=await all('SELECT r.student,s.name,r.day,r.sleep,r.fatigue,r.soreness,r.mood,r.score FROM readiness r JOIN students s ON s.id=r.student WHERE s.archived=0 AND r.day=?',day);
    const readinessByStudent=new Map(readinessRows.map(r=>[r.student,r]));
    const lowReadinessAlerts=readinessRows.filter(isLowReadiness).map(r=>({id:r.student,name:r.name,day:r.day,score:r.score,sleep:r.sleep,fatigue:r.fatigue,soreness:r.soreness}));
    const planByStudent=new Map(todayPlans.map(p=>[p.owner,p]));
    const draftSet=new Set(todayDrafts.map(d=>d.owner));
    const unreadByStudent=new Map(unreadRows.map(r=>[r.student,Number(r.count)]));
    let pendingToday=0,completedToday=0;
    const rosterToday=activeStudents.map(s=>{
      const p=planByStudent.get(s.id);
      let status='rest',rpe=null,volumeKg=null;
      if(p){
        if(p.rpe!=null){
          status='completed';completedToday++;rpe=p.rpe;
          if(p.set_logs){const m=computeSessionMetrics(decode(p.items),decode(p.set_logs));if(m.totalVolumeKg>0)volumeKg=m.totalVolumeKg}
        }else{status='pending';pendingToday++}
      }else if(draftSet.has(s.id)){status='draft'}
      return {id:s.id,name:s.name,status,rpe,volumeKg,readinessScore:readinessByStudent.get(s.id)?.score??null,unread:unreadByStudent.get(s.id)||0};
    });
    const unreadMessages=unreadRows.reduce((sum,r)=>sum+Number(r.count),0);
    return {day,totalStudents:activeStudents.length,pendingToday,completedToday,highRpeAlerts:highRpeRows,lowReadinessAlerts,unreadMessages,pendingMemories:Number(pendingMemRow?.count||0),rosterToday};
  }
  if(route==='/api/coach/personal-report'&&!post){
    const id=Number(url.searchParams.get('student')),start=url.searchParams.get('start'),end=url.searchParams.get('end');
    checkDay(start);checkDay(end);requireValue(start<=end,'结束日期应在开始日期之后');
    const student=await one('SELECT id,name FROM students WHERE id=?',id);requireValue(student,'学员不存在',404);
    const plans=await all(`SELECT p.day,p.items,f.sets,f.set_logs,f.rpe FROM plans p LEFT JOIN feedback f ON f.plan=p.id WHERE p.owner=? AND p.day BETWEEN ? AND ? AND p.rev=(SELECT MAX(q.rev) FROM plans q WHERE q.owner=p.owner AND q.day=p.day) ORDER BY p.day`,id,start,end);
    const e1rmByKey=new Map();
    let totalVolumeRaw=0;
    const sessions=plans.map(p=>{
      const items=decode(p.items);
      const setLogs=p.set_logs?decode(p.set_logs):null;
      const metrics=setLogs?computeSessionMetrics(items,setLogs):null;
      const volumeKg=metrics&&metrics.totalVolumeKg>0?metrics.totalVolumeKg:null;
      if(volumeKg!=null)totalVolumeRaw+=volumeKg;
      if(metrics){
        items.forEach((item,idx)=>{
          const ex=metrics.exercises[idx];
          if(ex?.bestE1rmKg==null)return;
          const key=p.day+'\0'+item.name;
          const prev=e1rmByKey.get(key);
          if(!prev||ex.bestE1rmKg>prev.e1rmKg){
            e1rmByKey.set(key,{day:p.day,exercise:item.name,e1rmKg:ex.bestE1rmKg,volumeKg:ex.volumeKg});
          }
        });
      }
      return {day:p.day,total:items.reduce((n,x)=>n+x.sets,0),done:p.sets?decode(p.sets).flat().filter(Boolean).length:0,rpe:p.rpe,volumeKg};
    });
    const e1rmSeries=Array.from(e1rmByKey.values()).sort((a,b)=>a.exercise.localeCompare(b.exercise,'zh-CN')||a.day.localeCompare(b.day));
    const totalVolumeKg=totalVolumeRaw>0?Math.round(totalVolumeRaw*10)/10:null;
    const scores=await all('SELECT day,metric,unit,score FROM assessments WHERE student=? AND day BETWEEN ? AND ? ORDER BY metric,unit,day',id,start,end);
    return {student,start,end,sessions,scores,totalVolumeKg,e1rmSeries};
  }

  if(route.startsWith('/api/coach/assessments/'))return assessments({all,one,run},route,body,url,post);
  if(route==='/api/coach/student/update'&&post){
    const sid=Number(body.student),name=cleanName(body.name);
    const updated=await one('UPDATE students SET name=? WHERE id=? RETURNING id,name',name,sid);
    requireValue(updated,'学员不存在',404);
    return updated;
  }
  if(route==='/api/coach/student/archive'&&post){
    const sid=Number(body.student),archived=body.archived?1:0;
    const updated=await one('UPDATE students SET archived=? WHERE id=? RETURNING id,archived',archived,sid);
    requireValue(updated,'学员不存在',404);
    return {id:updated.id,archived:Boolean(updated.archived)};
  }
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
  if(route==='/api/coach/team/update'&&post){
    const name=cleanName(body.name);
    requireValue(Array.isArray(body.members)&&body.members.length>0&&body.members.length<=200,'请选择 1–200 名学员');
    const members=[...new Set(body.members)],known=new Set((await all('SELECT id FROM students')).map(s=>s.id));
    requireValue(members.every(id=>known.has(id)),'学员不存在');
    const updated=await one('UPDATE training_teams SET name=?,members=? WHERE id=? RETURNING id',name,JSON.stringify(members),body.team||'');
    requireValue(updated,'团队不存在',404);
    return {id:updated.id,name,members};
  }
  if(route==='/api/coach/team/delete'&&post){
    const deleted=await one('DELETE FROM training_teams WHERE id=? RETURNING id',body.team||'');
    requireValue(deleted,'团队不存在',404);
    return {deleted:deleted.id};
  }
  if(route==='/api/coach/template'&&post){
    checkDay(body.day);const name=cleanName(body.name);
    const draft=await one('SELECT items FROM drafts WHERE owner=? AND day=?',body.student,body.day);
    requireValue(draft,'请先在个人日计划中保存草稿');
    const id=randomUUID();await run('INSERT INTO training_templates VALUES(?,?,?)',id,name,JSON.stringify(decode(draft.items)));return {id};
  }
  if(route==='/api/coach/template/update'&&post){
    const existing=await one('SELECT * FROM training_templates WHERE id=?',body.template||'');
    requireValue(existing,'模板不存在',404);
    const name=body.name!==undefined?cleanName(body.name):existing.name;
    let itemsJson=existing.items;
    if(body.student&&body.day){
      checkDay(body.day);
      const draft=await one('SELECT items FROM drafts WHERE owner=? AND day=?',body.student,body.day);
      requireValue(draft,'请先在个人日计划中保存草稿');
      itemsJson=JSON.stringify(decode(draft.items));
    }
    await run('UPDATE training_templates SET name=?,items=? WHERE id=?',name,itemsJson,existing.id);
    return {id:existing.id,name,items:decode(itemsJson)};
  }
  if(route==='/api/coach/template/delete'&&post){
    const deleted=await one('DELETE FROM training_templates WHERE id=? RETURNING id',body.template||'');
    requireValue(deleted,'模板不存在',404);
    return {deleted:deleted.id};
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