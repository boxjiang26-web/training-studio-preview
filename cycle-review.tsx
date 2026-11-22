import React,{useEffect,useState} from 'react';
export function CycleReview({load,save}){
 const [data,D]=useState(null),[note,N]=useState(''),[msg,M]=useState(''),[busy,B]=useState(false);
 useEffect(()=>{let active=true;load().then(r=>{if(active){D(r);N(r.note)}}).catch(e=>active&&M(e.message));return()=>{active=false}},[]);
 return <details><summary>训练周期复盘</summary>{data&&<><div style={{overflowX:'auto'}}><table><thead><tr>{['训练周','计划与反馈','已确认完成 / 计划组数','平均 RPE','测评成绩与较上次变化'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{data.weeks.map((w,i)=><tr key={w.start}><th>第 {i+1} 周 · {w.start}</th><td>{w.published?w.reported+' / '+w.sessions+' 场已反馈':'未发布'}</td><td>{w.published?(w.reported?w.completed:'—')+' / '+w.planned:'—'}</td><td>{w.rpe??'—'}</td><td>{w.tests.length?w.tests.map(t=><div key={JSON.stringify([t.day,t.metric,t.unit])}>{t.day.slice(5)} {t.metric} {t.score}{t.unit}（{t.delta==null?'首次记录':(t.delta>0?'+':'')+t.delta+t.unit}）</div>):'无测评'}</td></tr>)}</tbody></table></div>
 <label>复盘结论<textarea maxLength={1200} value={note} onChange={e=>{N(e.target.value);M('')}}/></label>
 <button disabled={busy||note.trim()===data.note} onClick={async()=>{B(true);try{const r=await save(note,data.rev);D({...data,...r});N(r.note);M(r.note?'结论已确认，供下一周期生成草稿时参考':'已清除结论')}catch(e){M(e.message)}finally{B(false)}}}>确认复盘结论</button></>}{msg&&<output>{msg}</output>}</details>
}
