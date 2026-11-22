import {parse} from 'csv-parse/sync';

export const assessmentSchema=`CREATE TABLE IF NOT EXISTS assessments(
  student INTEGER NOT NULL REFERENCES students(id), day TEXT NOT NULL, metric TEXT NOT NULL,
  unit TEXT NOT NULL, score DOUBLE PRECISION NOT NULL, PRIMARY KEY(student,metric,unit,day));`;
const headers={name:['学员','姓名','学员姓名','name','student'],date:['日期','测评日期','date'],metric:['项目','测评项目','metric','test'],value:['成绩','分数','score','value'],unit:['单位','unit']};
function reject(message,status=400){throw Object.assign(Error(message),{status})}
function parseTable(csv){
  if(typeof csv!=='string'||Buffer.byteLength(csv)>131072)reject('CSV 须小于等于 128 KB');
  let table;
  try{table=parse(csv,{bom:true,skip_empty_lines:true,trim:true})}catch(e){reject('CSV 格式有误，请检查第 '+(e.lines||1)+' 行的列数、引号与逗号')}
  if(table.length<2||table.length>301)reject('每次请导入 1–300 条测评');
  const labels=table.shift().map(x=>x.trim().toLowerCase());
  const columns={};
  for(const [key,aliases] of Object.entries(headers)){
    const matches=labels.flatMap((label,i)=>aliases.includes(label)?[i]:[]);
    if(matches.length>1)reject('列名重复：'+aliases[0]);
    if(!matches.length&&key!=='unit')reject('缺少必填列：'+aliases[0]);
    columns[key]=matches[0];
  }
  return table.map((line,i)=>({...Object.fromEntries(Object.entries(columns).map(([k,index])=>[k,(line[index]||'').trim()])),row:i+1}));
}
function cleanDate(value){
  const m=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);if(!m)return '';
  const date=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  return new Date(date).toJSON()?.slice(0,10)===date?date:'';
}
export async function assessments({all,one},route,body,url,post){
  if(route==='/api/coach/assessments/history'&&!post){
    const student=Number(url.searchParams.get('student'));
    if(!await one('SELECT id FROM students WHERE id=?',student))reject('学员不存在',404);
    return {rows:await all('SELECT day,metric,unit,score FROM assessments WHERE student=? ORDER BY metric,unit,day',student)};
  }
  const commit=route==='/api/coach/assessments/confirm';
  if(!post||(!commit&&route!=='/api/coach/assessments/preview'))reject('页面不存在',404);
  const students=await all('SELECT id,name FROM students'),seen=new Map();
  const rows=parseTable(body.csv);
  for(const row of rows){
    const matches=students.filter(s=>s.name.trim().normalize('NFKC')===row.name.normalize('NFKC'));
    row.student=body.matches?.[row.row]??(matches.length===1?matches[0].id:0);
    row.day=cleanDate(row.date);row.score=Number(row.value);
    if(row.student===-1){row.status='忽略';continue}
    if(!students.some(s=>s.id===row.student)){row.status=matches.length>1?'重名，需匹配':'需匹配';continue}
    if(!row.day||!row.metric||row.metric.length>80||row.unit.length>24||!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(row.value)||!Number.isFinite(row.score)||Math.abs(row.score)>1e12){
      row.status='日期、项目、单位或成绩无效';continue;
    }
    const key=JSON.stringify([row.student,row.metric,row.unit,row.day]);
    const existing=seen.has(key)?seen.get(key):(await one('SELECT score FROM assessments WHERE student=? AND metric=? AND unit=? AND day=?',row.student,row.metric,row.unit,row.day))?.score;
    row.status=existing==null?'待导入':Number(existing)===row.score?'已重复':'同日成绩冲突';
    if(row.status==='待导入')seen.set(key,row.score);
  }
  const ready=rows.filter(r=>r.status==='待导入');
  const blocked=rows.some(r=>!['待导入','已重复','忽略'].includes(r.status));
  if(!commit)return {rows,ready:ready.length,blocked};
  if(blocked)reject('存在未匹配或冲突行，请重新预览',409);
  let inserted=0;
  for(const r of ready){
    const args=[r.student,r.metric,r.unit,r.day];
    const saved=await one('INSERT INTO assessments(student,metric,unit,day,score) VALUES(?,?,?,?,?) ON CONFLICT(student,metric,unit,day) DO NOTHING RETURNING student',...args,r.score);
    if(saved)inserted++;
    else if(Number((await one('SELECT score FROM assessments WHERE student=? AND metric=? AND unit=? AND day=?',...args)).score)!==r.score)reject('成绩发生变化，请重新预览',409);
  }
  return {inserted,skipped:rows.length-inserted};
}