import React,{useEffect,useRef,useState} from 'react';
import catalog from './catalog.json';
const groups={lower_strength:'下肢力量',upper_strength:'上肢力量',power_conditioning:'爆发与体能',prep_recovery:'准备与恢复',core:'核心',neck_specialty:'颈部专项',full_body_strength:'全身力量'};
export const lookup=new Map(catalog.map(row=>[row.name,row]));
type Exercise=typeof catalog[number];
function Player({row}:{row:Exercise}){
 const [mode,setMode]=useState('video'),[failed,fail]=useState(false);
 function switchTo(next:string){fail(false);setMode(next)}
 if(!row.video)return <p>此动作暂无演示媒体。</p>;
 return <><div className="playbox">{failed?<p>演示暂时无法加载。<button onClick={()=>{fail(false)}}>重试</button></p>:mode==='gif'?<img alt={row.name+' 循环 GIF'} src={'/exercise-preview/'+row.id+'.gif'} onError={()=>fail(true)}/>:<video controls autoPlay muted loop playsInline poster={row.poster} src={row.video} onError={()=>fail(true)}/>}</div>
 <div className="switcher"><button aria-pressed={mode==='video'} onClick={()=>switchTo('video')}>完整视频</button><button aria-pressed={mode==='gif'} onClick={()=>switchTo('gif')}>循环 GIF · 前 5 秒</button></div></>;
}
export function Library({initial,onClose,onAdd}:{initial?:string,onClose:()=>void,onAdd?:(r:Exercise)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [term,search]=useState(''),[group,filter]=useState(''),[videos,videoOnly]=useState(false),[page,go]=useState(0);
 const [detail,select]=useState<Exercise|undefined>(initial?lookup.get(initial):undefined);
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close()},[]);
 const tokens=term.trim().toLowerCase().split(/\s+/);
 const found=catalog.filter(r=>(!group||r.category===group)&&(!videos||r.video)&&tokens.every(t=>[r.name,r.en,...r.muscles,...r.equipment].join(' ').toLowerCase().includes(t)));
 return <dialog ref={dialog} className="lib" onCancel={onClose} aria-label="动作资料库"><div className="libbar"><div><small>ReadyNex · 公开动作目录</small><h2>{detail?detail.name:'动作资料库'}</h2></div><button autoFocus onClick={onClose}>关闭</button></div>
 {detail?<div className="detail"><p>{detail.en}</p><Player key={detail.id} row={detail}/><p>{[groups[detail.category],detail.muscles.join('、'),detail.equipment.join('、')].filter(Boolean).join(' ／ ')}</p>
 {onAdd&&<button onClick={()=>onAdd(detail)}>加入当天计划</button>}{!initial&&<button onClick={()=>select(undefined)}>返回动作列表</button>}</div>:<>
 <div className="libfilters"><label>搜索动作<input type="search" placeholder="动作、器械或肌群" value={term} onChange={e=>{search(e.target.value);go(0)}}/></label><label>训练类别<select value={group} onChange={e=>{filter(e.target.value);go(0)}}><option value="">全部类别</option>{Object.entries(groups).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label className="check"><input type="checkbox" checked={videos} onChange={e=>{videoOnly(e.target.checked);go(0)}}/>有视频</label></div>
 <p>{found.length} 个动作</p><div className="filmgrid">{found.slice(page*12,page*12+12).map(r=><button key={r.id} className="film" onClick={()=>select(r)}><div className="cover">{r.poster&&<img loading="lazy" alt="" src={r.poster} onError={e=>{e.currentTarget.hidden=true}}/>}<span>{r.video?'▶ 演示':'动作资料'}</span></div><div className="caption"><small>{groups[r.category]}</small><b>{r.name}</b><small>{r.muscles.join(' · ')}</small></div></button>)}</div>
 {found.length===0?<p>没有匹配动作，请更换关键词。</p>:<nav><button disabled={!page} onClick={()=>go(page-1)}>上一页</button> {page+1} / {Math.ceil(found.length/12)} <button disabled={(page+1)*12>=found.length} onClick={()=>go(page+1)}>下一页</button></nav>}</>}</dialog>
}