import {createHash} from 'node:crypto';
import {reviewWeeks} from './cycle-review.mjs';
export async function cycleReport({one,all,run},action,c,person,body){
 const review=await one('SELECT note FROM cycle_reviews WHERE cycle=?',c.id);
 const report={name:person.name,goal:c.goal,start:c.start_day,weeks:await reviewWeeks(all,c),note:review?.note||''};
 const content=JSON.stringify(report),version=createHash('sha256').update(c.id+content).digest('hex');
 const old=await one('SELECT version FROM cycle_reports WHERE cycle=?',c.id);
 if(action==='send-report'){
   if(!report.note)throw Object.assign(Error('请先确认周期复盘结论'),{status:400});
   if(body.version!==version)throw Object.assign(Error('报告内容已变化，请重新预览'),{status:409});
   if(old?.version!==version)await run('INSERT INTO cycle_reports(cycle,content,version) VALUES(?,?,?) ON CONFLICT(cycle) DO UPDATE SET content=excluded.content,version=excluded.version',c.id,content,version);
 }
 return {report,version,sent:action==='send-report'||old?.version===version};
}
export async function studentReports(all,owner){
 if(!(owner>0))throw Object.assign(Error('请选择学员视图'),{status:403});
 const rows=await all('SELECT r.cycle,r.content FROM cycle_reports r JOIN training_cycles c ON c.id=r.cycle WHERE c.student=? ORDER BY c.start_day DESC,c.id',owner);
 return rows.map(row=>({cycle:row.cycle,report:JSON.parse(row.content)}));
}
