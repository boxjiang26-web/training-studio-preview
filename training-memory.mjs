import {createHash,randomUUID} from 'node:crypto';
export const memorySchema=`CREATE TABLE IF NOT EXISTS training_memory(
 id TEXT PRIMARY KEY, student INTEGER NOT NULL REFERENCES students(id), fingerprint TEXT NOT NULL,
 category TEXT NOT NULL, evidence TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL, rev INTEGER NOT NULL,
 created TEXT NOT NULL, UNIQUE(student,fingerprint));`;
function requireValue(ok,error,status=400){if(!ok)throw Object.assign(Error(error),{status})}
export async function trainingMemory({one,all,run},action,b){
 const {student}=b;
 requireValue(Number.isInteger(student)&&await one('SELECT id FROM students WHERE id=?',student),'请选择学员');
 if(action==='generate'){
  const feedback=await all('SELECT p.day,f.rpe,f.note,f.sets FROM feedback f JOIN plans p ON p.id=f.plan WHERE p.owner=? ORDER BY p.day DESC,p.id DESC LIMIT 6',student);
  const assessments=await all('SELECT day,metric,unit,score FROM assessments WHERE student=? ORDER BY metric,unit,day DESC',student);
  async function suggest(category,evidence,note){
   const key=createHash('sha256').update(JSON.stringify([category,evidence])).digest('hex');
   await run('INSERT INTO training_memory VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(student,fingerprint) DO NOTHING',randomUUID(),student,key,category,evidence,note,'待审核',1,new Date().toISOString());
  }
  if(feedback.length){
   let done=0,total=0;for(const row of feedback){const sets=(typeof row.sets==='string'?JSON.parse(row.sets):row.sets).flat();done+=sets.filter(Boolean).length;total+=sets.length}
   const mean=(feedback.reduce((n,x)=>n+x.rpe,0)/feedback.length).toFixed(1);
   await suggest('训练负荷',feedback.map(x=>x.day+' RPE '+x.rpe).join('；')+'。已完成 '+done+'/'+total+' 组。','最近 '+feedback.length+' 场有反馈的训练平均 RPE 为 '+mean+'，完成 '+done+'/'+total+' 组。编排时参考这一负荷记录。');
   const comments=feedback.filter(x=>x.note.trim()).slice(0,3);
   if(comments.length)await suggest('学员反馈',comments.map(x=>x.day+' '+x.note.slice(0,240)).join('\n'),'学员最近一次在 '+comments[0].day+' 反馈：“'+comments[0].note.slice(0,220)+'”。下次编排时复核这条反馈是否仍适用。');
  }
  const groups=new Map();for(const row of assessments){const k=JSON.stringify([row.metric,row.unit]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row)}
  for(const series of groups.values()){if(series.length<2)continue;const [latest,previous]=series;const delta=Number((latest.score-previous.score).toPrecision(10));
   await suggest('测评变化',series.slice(0,2).reverse().map(x=>x.day+' '+x.metric+' '+x.score+' '+x.unit).join(' → '),latest.metric+'从 '+previous.score+' 变为 '+latest.score+' '+latest.unit+'（变化 '+(delta>0?'+':'')+delta+'）。编排时参考同项目、同单位的表现。');
  }
 }else if(action==='review'){
  requireValue(['待审核','已接受','已拒绝'].includes(b.status)&&typeof b.note==='string'&&b.note.trim()&&b.note.trim().length<=1000,'内容或状态无效');
  const row=await one('UPDATE training_memory SET note=?,status=?,rev=rev+1 WHERE student=? AND id=? AND rev=? RETURNING id',b.note.trim(),b.status,student,b.id,b.rev);
  requireValue(row,'记录已变化，请重新打开',409);
 }else requireValue(action==='list','操作不存在',404);
 return {rows:await all('SELECT id,category,evidence,note,status,rev FROM training_memory WHERE student=? ORDER BY created DESC,id',student)};
}