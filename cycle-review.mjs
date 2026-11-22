function json(value){return typeof value==='string'?JSON.parse(value):value}
function dayAt(start,n){const d=new Date(start);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export async function reviewWeeks(all,c){
  const end=dayAt(c.start_day,c.weeks*7);
  const published=await all('SELECT idx,days FROM cycle_weeks WHERE cycle=? AND published=1',c.id);
  const plans=await all('SELECT p.day,p.items,f.sets,f.rpe FROM plans p LEFT JOIN feedback f ON f.plan=p.id WHERE p.owner=? AND p.day>=? AND p.day<? AND p.rev=1 ORDER BY p.day',c.student,c.start_day,end);
  const byDate=new Map(plans.map(p=>[p.day,p]));
  const tests=await all('SELECT day,metric,unit,score FROM assessments WHERE student=? AND day<? ORDER BY day,metric,unit',c.student,end);
  const weeks=Array.from({length:c.weeks},(_,i)=>({start:dayAt(c.start_day,i*7),published:false,sessions:0,reported:0,planned:0,completed:0,rpe:null,tests:[]}));
  for(const row of published){
    const w=weeks[row.idx],snapshot=json(row.days),days=snapshot.days||snapshot,ratings=[];
    w.published=true;
    days.forEach((items,i)=>{
      if(!items.length)return;
      w.sessions++;w.planned+=items.reduce((n,x)=>n+x.sets,0);
      const p=byDate.get(dayAt(w.start,i));
      if(p?.sets!=null){w.reported++;w.completed+=json(p.sets).flat().filter(Boolean).length;if(p.rpe!=null)ratings.push(p.rpe)}
    });
    if(ratings.length)w.rpe=Math.round(10*ratings.reduce((a,b)=>a+b,0)/ratings.length)/10;
  }
  const prior=new Map();
  for(const t of tests){
    const key=JSON.stringify([t.metric,t.unit]),last=prior.get(key);prior.set(key,t);
    if(t.day<c.start_day)continue;
    const idx=Math.floor((Date.parse(t.day)-Date.parse(c.start_day))/604800000);
    weeks[idx].tests.push({...t,delta:last?Number((t.score-last.score).toFixed(6)):null});
  }
  return weeks;
}
export async function previousReview(all,c){
  const candidates=await all('SELECT c.id,c.start_day,c.weeks,c.goal,r.note FROM training_cycles c LEFT JOIN cycle_reviews r ON r.cycle=c.id WHERE c.student=? AND c.start_day<? ORDER BY c.start_day DESC,c.id',c.student,c.start_day);
  const prev=candidates.filter(x=>dayAt(x.start_day,x.weeks*7)<=c.start_day).sort((a,b)=>dayAt(b.start_day,b.weeks*7).localeCompare(dayAt(a.start_day,a.weeks*7)))[0];
  return prev?.note?{goal:prev.goal,start:prev.start_day,end:dayAt(prev.start_day,prev.weeks*7-1),note:prev.note}:null;
}
