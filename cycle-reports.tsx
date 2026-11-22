import React,{useEffect,useState} from 'react';
function Report({r}){
 return <div className="reportbody"><h3>{r.goal}</h3><p>{r.name} · {r.start} 起 · 共 {r.weeks.length} 周</p><h4>教练复盘结论</h4><p>{r.note||'教练尚未确认结论'}</p>{r.weeks.map((w,i)=><article key={w.start}><h4>第 {i+1} 周 · {w.start}</h4><p>{w.published?'反馈 '+w.reported+' / '+w.sessions+' 场 · 已确认完成 '+(w.reported?w.completed:'—')+' / '+w.planned+' 组':'计划未发布'} · 平均 RPE {w.rpe??'—'}</p>{w.tests.length?w.tests.map(t=><p key={JSON.stringify([t.day,t.metric,t.unit])}>{t.day} · {t.metric} {t.score}{t.unit} · {t.delta==null?'首次记录':'较上次 '+(t.delta>0?'+':'')+t.delta+t.unit}</p>):<small>本周无测评</small>}</article>)}</div>
}
export function CoachReports({api,student}){
 const [open,O]=useState(false),[cycles,C]=useState([]),[id,I]=useState(''),[data,D]=useState(null),[msg,M]=useState(''),[busy,B]=useState(false);
 useEffect(()=>{if(!open)return;let live=true;api('coach/cycle/list',{student}).then(r=>{if(live){C(r.cycles);I(r.cycles[0]?.id||'');if(!r.cycles.length)M('这份档案还没有训练周期')}}).catch(e=>live&&M(e.message));return()=>{live=false}},[open]);
 useEffect(()=>{if(!id||!open)return;let live=true;api('coach/cycle/preview-report',{student,cycle:id}).then(r=>live&&D(r)).catch(e=>live&&M(e.message));return()=>{live=false}},[id,open]);
 return <><button onClick={()=>{O(!open);I('');D(null);M('');C([])}} disabled={busy||!student}>{open?'收起周期报告':'周期报告'}</button>{open&&<section><h2>周期报告预览</h2><label>报告周期<select disabled={busy} value={id} onChange={e=>{D(null);M('');I(e.target.value)}}>{cycles.map(c=><option key={c.id} value={c.id}>{c.start_day} · {c.goal}</option>)}</select></label>{data&&<><Report r={data.report}/><button disabled={busy||data.sent||!data.report.note} onClick={async()=>{B(true);M('');try{D(await api('coach/cycle/send-report',{student,cycle:id,version:data.version}))}catch(e){M(e.message)}finally{B(false)}}}>{data.sent?'已发送给学员':'确认发送给学员'}</button></>}{msg&&<output>{msg}</output>}</section>}</>
}
export function StudentReports({api}){
 const [rows,R]=useState([]),[msg,M]=useState('');
 useEffect(()=>{let live=true;function refresh(){api('cycle-reports').then(r=>{if(live){R(r);M('')}}).catch(e=>live&&M(e.message))}refresh();window.addEventListener('focus',refresh);return()=>{live=false;window.removeEventListener('focus',refresh)}},[]);
 return <section><h2>我的周期报告</h2>{rows.map(x=><details key={x.cycle}><summary>{x.report.goal} · {x.report.start}</summary><Report r={x.report}/></details>)}{!rows.length&&!msg&&<small>还没有收到教练发送的报告</small>}{msg&&<output>{msg}</output>}</section>
}
