import React,{useEffect,useRef,useState} from 'react';

function exportReport(report,team){
  const cells=v=>{let t=String(v??'');if(/^[\s]*[=+@-]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"'};
  const lines=[['日期','学员','训练内容','计划组数','完成组数','RPE','备注'],...report.rows.map(r=>[r.day,r.name,r.exercises,r.planned,r.done,r.rpe,r.note])];
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob(['\ufeff'+lines.map(row=>row.map(cells).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  link.download=team+'-'+report.first+'-训练周报.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
export function CoachDesk({api,students,student,day,onClose,onPublished}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [tab,setTab]=useState('team'),[data,setData]=useState({teams:[],templates:[]});
  const [team,setTeam]=useState(''),[template,setTemplate]=useState(''),[date,setDate]=useState(day);
  const [members,setMembers]=useState<number[]>([]),[name,setName]=useState(''),[templateName,setTemplateName]=useState('');
  const [message,msg]=useState(''),[busy,wait]=useState(false),[report,setReport]=useState(null),[reload,refresh]=useState(0);
  const current=data.teams.find(x=>x.id===team),plan=data.templates.find(x=>x.id===template);
  const who=id=>students.find(s=>s.id===id)?.name||String(id);
  async function resources(){const d=await api('coach/resources');setData(d);setTeam(v=>v||d.teams[0]?.id||'');setTemplate(v=>v||d.templates[0]?.id||'')}
  useEffect(()=>{dialog.current?.showModal();resources().catch(e=>msg(e.message))},[]);
  useEffect(()=>{let active=true;setReport(null);
    if(tab==='report'&&team&&date)api('coach/report?team='+encodeURIComponent(team)+'&day='+date).then(r=>{if(active)setReport(r)}).catch(e=>{if(active)msg(e.message)});
    return ()=>{active=false};
  },[tab,team,date,reload]);
  async function act(fn){wait(true);msg('');try{await fn()}catch(e){msg(e.message)}finally{wait(false)}}
  const teamSelect=<label>当前团队<select value={team} onChange={e=>{setTeam(e.target.value);msg('')}}>{data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>;
  return <dialog className="desk" ref={dialog} aria-label="团队工作台" onCancel={onClose}>
    <div className="deskhead"><h2>团队工作台</h2><button className="alt" onClick={onClose}>关闭</button></div>
    <nav>{[['team','团队名单'],['template','模板与分发'],['report','训练周报']].map(([key,title])=><button key={key} aria-pressed={tab===key} onClick={()=>{setTab(key);msg('')}}>{title}</button>)}</nav>
    {tab==='team'&&<><h3>建立训练团队</h3><label>团队名称<input value={name} maxLength={60} onChange={e=>setName(e.target.value)}/></label>
      <fieldset><legend>选择学员 · {members.length} 人</legend>{students.map(s=><label className="check" key={s.id}><input type="checkbox" checked={members.includes(s.id)} onChange={e=>setMembers(e.target.checked?[...members,s.id]:members.filter(id=>id!==s.id))}/>{s.name}</label>)}</fieldset>
      <button disabled={busy||!name.trim()||!members.length} onClick={()=>act(async()=>{const r=await api('coach/team',{name,members});await resources();setTeam(r.id);setMembers([]);setName('');msg('团队已建立')})}>建立团队</button>
      {!!current&&<><h3>成员名单</h3>{teamSelect}<p>{current.members.map(who).join('、')}</p></>}</>}
    {tab==='template'&&<><h3>保存训练模板</h3><p>取自 {who(student)} 在 {day} 已保存的日计划草稿。</p>
      <label>模板名称<input value={templateName} maxLength={60} onChange={e=>setTemplateName(e.target.value)}/></label>
      <button disabled={busy||!templateName.trim()||!student} onClick={()=>act(async()=>{const r=await api('coach/template',{day,student,name:templateName});await resources();setTemplate(r.id);setTemplateName('');msg('模板已保存')})}>保存为模板</button>
      <h3>发布到团队</h3>{teamSelect}<label>训练模板<select value={template} onChange={e=>setTemplate(e.target.value)}>{data.templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {plan&&<ul>{plan.items.map((x,i)=><li key={i}>{x.name} · {x.sets} 组 × {x.qty} {x.unit}</li>)}</ul>}
      <label>发布日期<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><p>{current?current.name+' · '+current.members.length+' 名学员。':''}仅填入空白训练日，已有草稿或计划会跳过。</p>
      <button disabled={busy||!plan||!current||!date} onClick={()=>act(async()=>{const r=await api('coach/distribute',{team,template,day:date});msg('已发布 '+r.published.length+' 人，跳过 '+r.skipped.length+' 人'+(r.skipped.length?'（'+r.skipped.map(who).join('、')+'）':''));onPublished(r.published,date)})}>确认团队发布</button></>}
    {tab==='report'&&<><h3>团队训练周报</h3>{teamSelect}<label>周内日期<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="alt" onClick={()=>refresh(x=>x+1)}>刷新周报</button>
      {!current&&<p>先建立团队，即可查看成员的周报。</p>}{report&&<><p>{report.first} 至 {report.last} · {current?.name}</p>
      <div className="metrics">{[['计划场次',report.planned],['已反馈场次',report.submitted],['平均 RPE',report.mean??'—']].map(([k,v])=><div key={k}><small>{k}</small><strong>{v}</strong></div>)}</div>
      {report.rows.length?<><div className="scrolltable"><table><thead><tr>{['日期','学员','动作','完成组数','RPE','备注'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{report.rows.map(r=><tr key={r.student+r.day}><td>{r.day}</td><td>{r.name}</td><td>{r.exercises}</td><td>{r.done}/{r.planned}</td><td>{r.rpe??'待反馈'}</td><td>{r.note}</td></tr>)}</tbody></table></div><button onClick={()=>exportReport(report,current.name)}>导出周报 CSV</button></>:<p>本周暂无已发布训练。</p>}</>}</>}
    {message&&<output role="status">{message}</output>}
  </dialog>
}