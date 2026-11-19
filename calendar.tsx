import React,{useEffect,useState} from 'react';

function shift(day:string,offset:number){
  const d=new Date(day+'T12:00:00');
  d.setDate(d.getDate()+offset);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
export function Calendar({api,coach,sid,day,choose,version,today}){
  const start=shift(day,-((new Date(day+'T12:00:00').getDay()+6)%7));
  const [result,setResult]=useState<any>(null);
  const [error,setError]=useState('');
  const [historyOpen,openHistory]=useState(false);
  useEffect(()=>{
    let active=true, latest=0;
    async function refresh(){
      const seq=++latest;
      try {
        const data=await api('calendar?day='+start+(coach?'&student='+sid:''));
        if(active&&seq===latest){setResult({start,data});setError('')}
      }catch(e){if(active&&seq===latest)setError(e.message)}
    }
    refresh();window.addEventListener('focus',refresh);
    return ()=>{active=false;window.removeEventListener('focus',refresh)};
  },[sid,start,version,coach]);
  const data=result?.start===start?result.data:null;
  return <section className="calendar"><div className="cal-top"><div><h2>{coach?'周计划':'训练日历'}</h2><small>{start} 至 {shift(start,6)}</small></div><div><button className="alt" onClick={()=>choose(shift(day,-7))}>上一周</button><button className="alt" onClick={()=>choose(today)}>今天</button><button className="alt" onClick={()=>choose(shift(day,7))}>下一周</button></div></div>
    {error&&<aside role="alert">{error}</aside>}
    <div className="days">{Array.from({length:7},(_,i)=>{
      const key=shift(start,i),entry=data?.days.find(s=>s.day===key);
      return <button type="button" key={key} data-day={key} aria-pressed={day===key} className={'tile '+(entry?'scheduled':'')} onClick={()=>choose(key)}>
        <span>周{'一二三四五六日'[i]}</span><b>{key.slice(5).replace('-','/')}</b>
        <span className="summary">{entry?entry.names.join('、'):data?'未安排':'读取中…'}</span>
        {entry&&<small>{entry.dirty?(entry.published?'有新草稿':'草稿'):'已发布'}{entry.rpe!=null?' · 已反馈 RPE '+entry.rpe:entry.published?' · 待反馈':''}</small>}
      </button>})}</div>
    <div className="cal-top"><label>训练日期<input type="date" value={day} onChange={e=>e.target.value&&choose(e.target.value)}/></label>
    {!coach&&<button className="alt" aria-expanded={historyOpen} onClick={()=>openHistory(!historyOpen)}>训练记录</button>}</div>
    {!coach&&historyOpen&&<div className="history">{!data?'读取中…':data.history.length===0?'还没有已提交的训练记录。':data.history.map(h=><button key={h.day} onClick={()=>{choose(h.day);openHistory(false)}}>{h.day} · {h.names.join('、')} · RPE {h.rpe}</button>)}</div>}
  </section>
}