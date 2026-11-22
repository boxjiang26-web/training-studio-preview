import React from 'react';
function identity(s){
 const m=/^(.+)（([^（）]+测试·(?:晨练|晚练|组外))）$/.exec(s.name);
 return m?{key:'fixture:'+m[1],name:m[1],context:m[2]}:{key:'student:'+s.id,name:s.name,context:''};
}
export function Roster({students,sid,choose,counts}){
 const groups=new Map();
 for(const s of students){const id=identity(s);if(!groups.has(id.key))groups.set(id.key,[]);groups.get(id.key).push({...s,...id})}
 const selected=students.find(s=>s.id===sid),current=selected?groups.get(identity(selected).key):[];
 return <div className="roster"><label>当前学员<select aria-label="当前学员" value={sid} onChange={e=>choose(+e.target.value)}>{Array.from(groups.values()).sort((a,b)=>a[0].name.localeCompare(b[0].name,'zh-CN')).map(group=>{
 const s=group.find(x=>x.id===sid)||group[0],unread=group.reduce((n,x)=>n+(counts[x.id]||0),0);
 return <option key={s.key} value={s.id}>{s.name}{!s.context&&students.filter(x=>x.name===s.name).length>1?' · #'+s.id:''}{unread?' · 未读 '+unread:''}</option>})}</select></label>
 {current?.[0]?.context&&<label>训练档案<select aria-label="训练档案" value={sid} onChange={e=>choose(+e.target.value)}>{current.map(s=><option key={s.id} value={s.id}>{s.context}{counts[s.id]?' · 未读 '+counts[s.id]:''}</option>)}</select></label>}</div>
}
