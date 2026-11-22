import React,{useRef,useState,useEffect} from 'react';
export function TrainingMemory({api,student,name}){
 const ref=useRef(null),[rows,setRows]=useState([]),[busy,wait]=useState(false),[msg,show]=useState(''),[edits,edit]=useState({});
 async function call(action,args={}){wait(true);show('');try{const r=await api('coach/memory/'+action,{student,...args});setRows(r.rows);if(action==='review')edit(v=>{const next={...v};delete next[args.id];return next});if(action==='generate')show(r.rows.length?'建议已更新，相同依据仅保留一条。':'目前还没有可生成建议的训练记录。')}catch(e){show(e.message)}finally{wait(false)}}
 useEffect(()=>{setRows([]);edit({})},[student]);
 return <><button disabled={!student} onClick={()=>{ref.current.showModal();call('list')}}>训练记忆</button><dialog className="desk" ref={ref} aria-label="训练记忆"><div className="deskhead"><h2>{name} · 训练记忆</h2><button onClick={()=>ref.current.close()}>关闭</button></div>
 <p>生成后请核对依据。只有已接受的内容会供下次 AI 编排参考。</p><button disabled={busy} onClick={()=>call('generate')}>生成记忆建议</button>{msg&&<output>{msg}</output>}{!busy&&!rows.length&&<p>暂无记忆。</p>}
 {rows.map(r=><article key={r.id}><h3>{r.category} · {r.status}</h3><p style={{whiteSpace:'pre-line'}}>{r.evidence}</p><label style={{display:'grid'}}>记忆内容<textarea maxLength={1000} value={edits[r.id]??r.note} onChange={e=>edit({...edits,[r.id]:e.target.value})}/></label>
 {['保存修改','接受','拒绝'].map((title,i)=><button key={title} disabled={busy||!(edits[r.id]??r.note).trim()} onClick={()=>call('review',{id:r.id,rev:r.rev,note:edits[r.id]??r.note,status:[r.status,'已接受','已拒绝'][i]})}>{title}</button>)}</article>)}</dialog></>
}