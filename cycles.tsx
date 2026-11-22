import React,{useEffect,useRef,useState} from 'react';
import {CycleReview} from './cycle-review';
import catalog from './catalog.json';
const moves=Array.from(new Set(['徒手深蹲','髋部拉伸','俯卧撑','平板支撑','弹力带划船',...catalog.map(x=>x.name)]));
function shifted(s,n){const d=new Date(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function StudentWeeks({api,choose}){
 const [weeks,set]=useState([]);useEffect(()=>{let live=true;const refresh=()=>api('cycle-weeks').then(r=>{if(live)set(r)}).catch(()=>{});refresh();window.addEventListener('focus',refresh);return()=>{live=false;window.removeEventListener('focus',refresh)}},[]);
 return weeks.length?<label>已发布周期周<select value="" onChange={e=>e.target.value&&choose(e.target.value)}><option value="">跳转到训练周</option>{weeks.map((w,i)=><option key={i} value={w.week}>{w.goal} · 第 {w.number} 周 · {w.week}</option>)}</select></label>:null
}
export function CycleDesk({api,student,name,day,close,onPublish}){
 const dialog=useRef(null),[list,L]=useState([]),[id,I]=useState(''),[idx,J]=useState(0),[draft,D]=useState(null),[dirty,U]=useState(false);
 const [goal,G]=useState(''),[start,S]=useState(shifted(day,-((new Date(day).getUTCDay()+6)%7))),[length,N]=useState(4),[pct,P]=useState(100),[busy,B]=useState(false),[msg,M]=useState('');
 const cycle=list.find(x=>x.id===id),week=cycle?shifted(cycle.start_day,idx*7):'';
 const call=(path,args={})=>api('coach/cycle/'+path,{student,cycle:id,idx,rev:draft?.rev||0,...args});
 async function act(fn){B(true);M('');try{await fn()}catch(e){M(e.message)}finally{B(false)}}
 async function refresh(prefer=''){const r=await call('list');L(r.cycles);I(prefer||r.cycles[0]?.id||'');J(0)}
 useEffect(()=>{dialog.current.showModal();act(()=>refresh())},[]);
 useEffect(()=>{let live=true;D(null);U(false);if(id)call('load').then(r=>{if(live)D(r)}).catch(e=>live&&M(e.message));return()=>{live=false}},[id,idx]);
 function leave(){return !dirty||confirm('放弃本周未保存的修改？')}
 function update(i,a){D({...draft,days:draft.days.map((v,j)=>i===j?a:v)});U(true);M('')}
 async function save(action){const r=await call(action,{days:draft.days,discardReference:draft.discardReference===true});D(r);U(false);M(action==='publish'?'本周已发布':'周草稿已保存');if(action==='publish')onPublish(week)}
 return <dialog ref={dialog} className="desk" aria-label="多周训练周期" onCancel={e=>{e.preventDefault();if(!busy&&leave())close()}}>
 <div className="deskhead"><h2>{name} · 多周训练周期</h2><button disabled={busy} onClick={()=>leave()&&close()}>关闭</button></div>
 <fieldset disabled={busy}><legend>新建周期</legend><label>周期目标<input maxLength={300} value={goal} onChange={e=>G(e.target.value)}/></label><label>开始周一<input type="date" value={start} onChange={e=>S(e.target.value)}/></label><label>周期周数<input type="number" min={2} max={52} value={length} onChange={e=>N(+e.target.value)}/></label><button disabled={!goal.trim()} onClick={()=>leave()&&act(async()=>{const r=await call('create',{goal,start,weeks:length});await refresh(r.id);G('')})}>建立周期</button></fieldset>
 {!!cycle&&<><label>当前周期<select disabled={busy} value={id} onChange={e=>{if(leave()){I(e.target.value);J(0);M('')}}}>{list.map(c=><option key={c.id} value={c.id}>{c.goal} · {c.start_day}</option>)}</select></label>
 <CycleReview key={student+id} load={()=>call('review')} save={(note,reviewRev)=>call('confirm-review',{note,reviewRev})}/>
 <label>编排周次<select disabled={busy} value={idx} onChange={e=>{if(leave()){J(+e.target.value);M('')}}}>{Array.from({length:cycle.weeks},(_,i)=><option key={i} value={i}>第 {i+1} 周 · {shifted(cycle.start_day,7*i)}</option>)}</select></label></>}
 {draft&&cycle&&<><p>{week} 至 {shifted(week,6)} · {draft.published?'已发布':dirty?'有未保存修改':'周草稿'}</p><fieldset disabled={busy||!!draft.published}><legend>每日训练</legend>
 <p>生成时会将周期目标、上周计划与反馈、RPE 、已确认的上周期复盘和已接受的记忆发送给 DeepSeek。</p>
 <button onClick={()=>{if((dirty||draft.days.some(a=>a.length))&&!confirm('重新生成并替换本周草稿？'))return;act(async()=>{M('正在生成周期周草稿…');const r=await call('generate');D(r);U(false);M('AI 草稿已保存，请逐日审核')})}}>AI 生成本周草稿</button>
 {draft.reference&&<details><summary>本周编排依据</summary><p>{draft.reference.reason}</p>{draft.reference.previousReview&&<p>上周期复盘 · {draft.reference.previousReview.goal} · {draft.reference.previousReview.note}</p>}<small>{draft.reference.previousStart} 至 {draft.reference.previousEnd}</small>{!draft.reference.previous.length&&<p>上周没有已发布训练。</p>}{draft.reference.previous.map(x=><p key={x.day}>{x.day} · {x.completed==null?'待反馈':x.completed+'/'+x.planned+' 组 · RPE '+x.rpe}</p>)}{draft.reference.memories.map((m,i)=><p key={i}>已确认记忆 · {m}</p>)}</details>}
 {idx>0&&<><label>每组次数或时长比例 (%)<input type="number" min={25} max={200} value={pct} onChange={e=>P(+e.target.value)}/></label><button onClick={()=>{if((dirty||draft.days.some(a=>a.length))&&!confirm('用上一周的安排替换本周编辑内容？'))return;act(async()=>{const r=await call('copy',{percent:pct});D({...draft,days:r.days,reference:null,discardReference:true});U(true);M('已复制，可继续逐日调整')})}}>复用上一周</button></>}
 <datalist id="cycle-moves">{moves.map(m=><option key={m} value={m}/>)}</datalist>
 {draft.days.map((a,i)=><article key={i}><h3>周{'一二三四五六日'[i]} · {shifted(week,i)}</h3>{!a.length&&<small>休息日</small>}{a.map((x,j)=>{const change=(k,v)=>update(i,a.map((y,n)=>n===j?{...y,[k]:v}:y));return <div key={j}><label>动作<input list="cycle-moves" value={x.name} onChange={e=>change('name',e.target.value)}/></label><label>组数<input type="number" value={x.sets} onChange={e=>change('sets',+e.target.value)}/></label><label>每组<input type="number" value={x.qty} onChange={e=>change('qty',+e.target.value)}/></label><label>单位<select value={x.unit} onChange={e=>change('unit',e.target.value)}><option>次</option><option>秒</option></select></label><button onClick={()=>update(i,a.filter((_,n)=>n!==j))}>移除</button></div>})}<button onClick={()=>update(i,[...a,{name:moves[0],sets:3,qty:10,unit:'次'}])}>添加动作</button></article>)}
 <button onClick={()=>act(()=>save('save'))}>保存周草稿</button><button onClick={()=>act(()=>save('publish'))}>确认发布本周</button></fieldset></>}{msg&&<output>{msg}</output>}</dialog>
}