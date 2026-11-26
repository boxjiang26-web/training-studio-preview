import React,{useEffect,useRef,useState} from 'react';

const sample='\ufeff学员姓名,测评日期,测评项目,成绩,单位\r\n示例学员,2026-11-01,立定跳远,210,厘米\r\n示例学员,2026-11-15,立定跳远,218,厘米\r\n';
type Result={day:string,metric:string,score:number,unit:string};
function History({rows,onUpdate,onDelete}:{rows:Result[],onUpdate:(r:Result,score:number)=>Promise<void>,onDelete:(r:Result)=>Promise<void>}){
  const groups=new Map<string,Result[]>();
  const [editing,setEditing]=useState<string>('');
  const [draftScore,setDraftScore]=useState<string>('');
  for(const r of rows){
    const key=JSON.stringify([r.metric,r.unit]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key)!.push(r);
  }
  if(!rows.length)return <p>这名学员还没有测评成绩。</p>;
  return <div className="assessment-history">{Array.from(groups,([key,series])=><div key={key}><h4>{series[0].metric}{series[0].unit?'（'+series[0].unit+'）':''}</h4>
    <table><thead><tr><th>测评日期</th><th>成绩</th><th>较上次</th><th>操作</th></tr></thead><tbody>{series.map((r,i)=>{
      const rowKey=JSON.stringify([r.day,r.metric,r.unit]);
      const delta=i?Number((r.score-series[i-1].score).toPrecision(10)):null;
      const isEditing=editing===rowKey;
      return <tr key={r.day}><td>{r.day}</td><td>{isEditing?<input aria-label={'修改成绩 '+r.day} type="number" step="any" value={draftScore} onChange={e=>setDraftScore(e.target.value)}/>:r.score}</td><td>{delta===null?'首次':delta===0?'持平':(delta>0?'+':'')+delta}</td><td>{isEditing?<><button type="button" onClick={async()=>{await onUpdate(r,Number(draftScore));setEditing('')}}>保存成绩</button><button type="button" className="alt" onClick={()=>setEditing('')}>取消</button></>:<><button type="button" className="alt" onClick={()=>{setEditing(rowKey);setDraftScore(String(r.score))}}>修正</button><button type="button" className="alt" onClick={()=>onDelete(r)}>删除</button></>}</td></tr>
    }).reverse()}</tbody></table></div>)}</div>;
}
function ImportCsv({api,students,onClose,onSaved}){
  const ref=useRef<HTMLDialogElement>(null),upload=useRef(0);
  const [csv,setCsv]=useState(''),[matches,match]=useState({}),[preview,show]=useState(null);
  const [message,msg]=useState(''),[pending,wait]=useState(false),[busy,save]=useState(false),[finished,finish]=useState(false);
  useEffect(()=>{ref.current?.showModal()},[]);
  useEffect(()=>{
    let current=true;
    if(csv){wait(true);api('coach/assessments/preview',{csv,matches}).then(r=>{if(current)show(r)}).catch(e=>{if(current){show(null);msg(e.message)}}).finally(()=>{if(current)wait(false)})}
    return ()=>{current=false};
  },[csv,matches]);
  async function read(file){
    const seq=++upload.current;setCsv('');show(null);match({});msg('');finish(false);if(!file)return;
    try{
      if(file.size>131072)throw Error('请选择不超过 128 KB 的 CSV');
      const bytes=await file.arrayBuffer();let text;
      try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{text=new TextDecoder('gb18030',{fatal:true}).decode(bytes)}
      if(!text.trim())throw Error('文件为空');
      if(seq===upload.current){wait(true);setCsv(text)}
    }catch(e){if(seq===upload.current){msg(e.message);wait(false)}}
  }
  async function confirm(){
    save(true);msg('');
    try{const r=await api('coach/assessments/confirm',{csv,matches});finish(true);msg('已导入 '+r.inserted+' 条，跳过 '+r.skipped+' 条');onSaved()}
    catch(e){msg(e.message);match({...matches})}finally{save(false)}
  }
  return <dialog className="desk import-assessment" ref={ref} aria-label="测评导入" onCancel={onClose}><div className="deskhead"><h2>测评导入</h2><button className="alt" onClick={onClose}>关闭</button></div>
    <p>每行一条成绩，填写学员姓名、日期、项目和数值。单位可选。</p>
    <a href={'data:text/csv;charset=utf-8,'+encodeURIComponent(sample)} download="测评导入模板.csv">下载 CSV 模板</a>
    <label>上传 CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>read(e.target.files?.[0])}/></label>
    {preview&&!finished&&<><h3>预览与匹配</h3><div className="scrolltable"><table><thead><tr>{['序号','原姓名','归属学员','日期','项目','成绩','状态'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{preview.rows.map(r=><tr key={r.row}><td>{r.row}</td><td>{r.name}</td><td><select aria-label={'第'+r.row+'行归属学员'} disabled={busy} value={matches[r.row]??r.student} onChange={e=>{wait(true);msg('');match({...matches,[r.row]:Number(e.target.value)})}}>
      <option value="0">请选择学员</option><option value="-1">忽略此行</option>{students.map(s=><option key={s.id} value={s.id}>{s.name} · #{s.id}</option>)}</select></td>
      <td>{r.day||r.date}</td><td>{r.metric}</td><td>{r.value} {r.unit}</td><td>{r.status}</td></tr>)}</tbody></table></div>
      <p>共 {preview.rows.length} 条，待导入 {preview.ready} 条。</p><button onClick={confirm} disabled={pending||busy||preview.blocked||!preview.ready}>确认导入</button></>}
    {pending&&csv&&<small>正在预览…</small>}{message&&<output role="status">{message}</output>}
  </dialog>
}
export function AssessmentPanel({api,sid,students}){
  const [open,toggle]=useState(false),[history,expand]=useState(false),[version,refresh]=useState(0);
  const [record,setRecord]=useState<{sid:number,rows:Result[]}|null>(null),[err,setErr]=useState('');
  useEffect(()=>{let live=true;setRecord(null);setErr('');
    if(history&&sid)api('coach/assessments/history?student='+sid).then(d=>{if(live)setRecord({sid,rows:d.rows})}).catch(e=>{if(live)setErr(e.message)});
    return ()=>{live=false}
  },[history,sid,version]);
  return <div className="assessment-pane"><h3>体能测评</h3><button className="alt" onClick={()=>toggle(true)}>导入测评 CSV</button>
    {!!sid&&<button className="alt" aria-expanded={history} onClick={()=>expand(!history)}>历次测评</button>}
    {history&&!!sid&&(err?<aside>{err}</aside>:record?.sid===sid?<History rows={record.rows} onUpdate={async(r,score)=>{try{setErr('');await api('coach/assessments/update',{student:sid,day:r.day,metric:r.metric,unit:r.unit,score});refresh(v=>v+1)}catch(e){setErr((e as Error).message)}}} onDelete={async(r)=>{try{setErr('');await api('coach/assessments/delete',{student:sid,day:r.day,metric:r.metric,unit:r.unit});refresh(v=>v+1)}catch(e){setErr((e as Error).message)}}}/>:<p>正在读取…</p>)}
    {open&&<ImportCsv api={api} students={students} onClose={()=>toggle(false)} onSaved={()=>{refresh(v=>v+1);expand(true)}}/>}</div>
}