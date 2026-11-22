import React,{useEffect,useRef,useState} from 'react';
export function useUnread(api,me){
 const [counts,set]=useState<Record<number,number>>({});
 useEffect(()=>{if(!me)return;let active=true,seq=0;
 async function load(){const n=++seq;try{const r=await api('messages/unread');if(active&&n===seq)set(Object.fromEntries(r.counts.map(x=>[x.student,Number(x.count)])))}catch{}}
 load();const timer=setInterval(load,3000);window.addEventListener('message-count',load);
 return()=>{active=false;clearInterval(timer);window.removeEventListener('message-count',load)}},[me]);return counts;
}
function merge(old,rows){const items=new Map(old.map(m=>[m.id,m]));rows.forEach(m=>items.set(m.id,m));return Array.from(items.values()).sort((a,b)=>a.id-b.id)}
function Chat({api,coach,student,name,close}){
 const dialog=useRef(null),[rows,setRows]=useState([]),[older,more]=useState(false),[text,write]=useState(''),[busy,wait]=useState(false),[error,err]=useState('');
 const token=useRef(''),first=useRef(0),list=useRef(null),tail=useRef(0),alive=useRef(true);
 async function load(before=0){try{
 const r=await api('messages/thread?student='+student+(before?'&before='+before:''));
 if(!alive.current)return;
 const gap=!before&&r.older&&tail.current>0&&r.rows[0]?.id>tail.current; if(before||!first.current||gap){more(r.older);first.current=r.rows[0]?.id||0}
 setRows(prev=>merge(gap?[]:prev,r.rows));
 }catch(e){if(alive.current)err(e.message)}}
 useEffect(()=>{dialog.current.showModal();alive.current=true;load();const timer=setInterval(()=>{if(!document.hidden)load()},2500);return()=>{alive.current=false;clearInterval(timer)}},[]);
 useEffect(()=>{if(!rows.length)return;const latest=rows[rows.length-1].id,box=list.current;
 if(latest!==tail.current&&(!tail.current||box.scrollHeight-box.scrollTop-box.clientHeight<200||rows[rows.length-1].sender===(coach?'coach':'student')))box.scrollTop=box.scrollHeight;
 tail.current=latest;
 const ids=rows.filter(m=>!m.seen&&m.sender!==(coach?'coach':'student')).map(m=>m.id);
 async function mark(){if(document.hidden)return;try{for(let i=0;i<ids.length;i+=50)await api('messages/read',{student,ids:ids.slice(i,i+50)});if(ids.length)window.dispatchEvent(new Event('message-count'))}catch(e){if(alive.current)err(e.message)}}
 mark();document.addEventListener('visibilitychange',mark);return()=>document.removeEventListener('visibilitychange',mark)
 },[rows]);
 async function send(e){e.preventDefault();if(!text.trim()||busy)return;wait(true);err('');
 try{token.current||=(globalThis.crypto.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));await api('messages/send',{student,body:text,requestId:token.current});write('');token.current='';await load()}catch(e){err(e.message)}finally{wait(false)}}
 return <dialog ref={dialog} className="desk chat" aria-label="训练对话" onCancel={close}><div className="deskhead"><h2>{coach?name:'教练'} · 训练对话</h2><button onClick={close}>关闭</button></div>
 <div ref={list} className="chatlog">{older&&<button className="alt" onClick={()=>load(first.current)}>查看更早消息</button>}{!rows.length&&<p>暂无消息</p>}{rows.map(m=>{const mine=m.sender===(coach?'coach':'student');return <div className={mine?'bubble mine':'bubble'} key={m.id}><small>{mine?'我':coach?name:'教练'} · {new Date(m.created).toLocaleString('zh-CN')}</small><p>{m.body}</p>{mine&&<small>{m.seen?'已读':'未读'}</small>}</div>})}</div>
 <form onSubmit={send}><label style={{display:'grid'}}>消息内容<textarea value={text} disabled={busy} maxLength={2000} onChange={e=>{write(e.target.value);token.current=''}}/></label><button disabled={busy||!text.trim()}>发送消息</button></form>{error&&<aside>{error}</aside>}</dialog>
}
export function MessageEntry({api,coach,student,name,count}){
 const [open,set]=useState(false);return <><button disabled={coach&&!student} onClick={()=>set(true)}>{coach?'学员消息':'教练消息'}{count?' · '+count+' 条未读':''}</button>{open&&<Chat {...{api,coach,student,name}} close={()=>set(false)}/>}</>
}