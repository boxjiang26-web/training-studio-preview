import React,{useRef,useState} from 'react';
import {jsPDF} from 'jspdf';
function lines(r){
 const submitted=r.sessions.filter(s=>s.rpe!=null);
 const total=r.sessions.reduce((a,s)=>a+s.total,0),done=r.sessions.reduce((a,s)=>a+s.done,0);
 const result=[['个人训练报告',r.student.name],['报告周期',r.start+' 至 '+r.end],['训练概况',r.sessions.length+' 场计划 · '+submitted.length+' 场反馈 · 完成 '+done+'/'+total+' 组'],['平均 RPE',submitted.length?(submitted.reduce((a,s)=>a+s.rpe,0)/submitted.length).toFixed(1):'暂无反馈'],['训练完成与 RPE','完成组数 / 计划组数']];
 for(const s of r.sessions)result.push([s.day,s.done+' / '+s.total+' 组 · '+(s.rpe==null?'待反馈':'RPE '+s.rpe)]);
 if(!r.sessions.length)result.push(['','所选期间没有已发布训练']);
 result.push(['测评成绩','按同项目、同单位比较区间内相邻两次成绩']);
 let prev=null;
 for(const s of r.scores){const delta=prev&&prev.metric===s.metric&&prev.unit===s.unit?Number((s.score-prev.score).toPrecision(10)):null;
 result.push([s.day,s.metric+' · '+s.score+' '+s.unit+' · '+(delta==null?'区间首次':'较上次 '+(delta>0?'+':'')+delta)]);prev=s}
 if(!r.scores.length)result.push(['','所选期间没有测评成绩']);return result;
}
function trend(r){
 const groups=new Map();
 for(const s of r.scores){const label=s.metric+' '+s.unit;if(!groups.has(label))groups.set(label,[]);groups.get(label).push([s.day,s.score])}
 const series=[['完成组数占比 (%)',r.sessions.map(s=>[s.day,Math.round(100*s.done/s.total)]),100],['主观用力程度 (RPE)',r.sessions.filter(s=>s.rpe!=null).map(s=>[s.day,s.rpe]),10],...Array.from(groups,([label,points])=>[label,points,null])];
 return series.filter(([,points])=>points.length).map(([label,points,cap])=>{
 const c=document.createElement('canvas');c.width=1000;c.height=180;const g=c.getContext('2d');g.fillStyle='#f3f6ef';g.fillRect(0,0,1000,180);g.fillStyle='#234f3f';g.font='22px Microsoft YaHei,sans-serif';g.fillText(label,18,30);
 const vals=points.map(p=>p[1]),lo=cap?0:Math.min(...vals),hi=cap||Math.max(...vals),t0=Date.parse(r.start),span=Math.max(86400000,Date.parse(r.end)-t0);
 const coords=points.map(([day,v])=>[40+920*(Date.parse(day)-t0)/span,120-(hi===lo?.5:(v-lo)/(hi-lo))*65]);
 g.strokeStyle='#31745d';g.lineWidth=3;g.beginPath();coords.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();coords.forEach(([x,y])=>{g.beginPath();g.arc(x,y,4,0,Math.PI*2);g.fill()});g.font='17px Microsoft YaHei,sans-serif';g.fillText(r.start,18,165);g.textAlign='right';g.fillText(r.end,980,165);return {label,canvas:c};
 })}

function pdf(rows,r,charts){
 const doc=new jsPDF({compress:true});const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;const ctx=canvas.getContext('2d');let y=0,page=0;
 function start(){ctx.fillStyle='white';ctx.fillRect(0,0,1240,1754);ctx.fillStyle='#194c38';ctx.font='bold 42px Microsoft YaHei, sans-serif';ctx.fillText('练记 · 个人训练报告',65,90);ctx.font='25px Microsoft YaHei, sans-serif';ctx.fillText(r.student.name+'   '+r.start+' 至 '+r.end,65,145);y=225}
 function flush(){if(page++)doc.addPage();doc.addImage(canvas.toDataURL('image/png'),'PNG',0,0,210,297)}
 start();for(const chart of charts){if(y+205>1640){flush();start()}ctx.drawImage(chart.canvas,65,y,1090,196);y+=210}for(const [k,v] of rows){let line='';for(const ch of (k+'    '+v)){if(ctx.measureText(line+ch).width>1090){ctx.fillText(line,65,y);y+=44;line='';if(y>1640){flush();start()}}line+=ch}ctx.fillText(line,65,y);y+=58;if(y>1640){flush();start()}}
 if(y>225||!page)flush();doc.save('个人训练报告-'+r.student.name+'-'+r.end+'.pdf')
}
export function PersonalReport({api,students,sid,day}){
 const ref=useRef(null),seq=useRef(0);const first=new Date(day+'T12:00:00Z');first.setUTCDate(first.getUTCDate()-29);
 const [id,I]=useState(sid),[start,S]=useState(first.toISOString().slice(0,10)),[end,E]=useState(day),[r,R]=useState(null),[msg,M]=useState('');
 function clear(){seq.current++;R(null);M('')}
 async function preview(){clear();const n=seq.current;try{const data=await api('coach/personal-report?student='+id+'&start='+start+'&end='+end);if(seq.current===n)R(data)}catch(e){if(seq.current===n)M(e.message)}}
 const rows=r?lines(r):[];const charts=React.useMemo(()=>r?trend(r):[],[r]);
 return <><button className="alt" disabled={!sid} onClick={()=>{clear();I(sid);ref.current.showModal()}}>个人训练报告</button><dialog ref={ref} className="desk" aria-label="个人训练报告"><div className="deskhead"><h2>个人训练报告</h2><button onClick={()=>ref.current.close()}>关闭</button></div>
 <label>报告学员<select value={id} onChange={e=>{clear();I(+e.target.value)}}>{students.map(s=><option key={s.id} value={s.id}>{s.name} · #{s.id}</option>)}</select></label>
 <label>开始日期<input type="date" value={start} onChange={e=>{clear();S(e.target.value)}}/></label><label>结束日期<input type="date" value={end} onChange={e=>{clear();E(e.target.value)}}/></label>
 <button disabled={!start||!end||end<start} onClick={preview}>预览报告</button>{end<start&&<small>结束日期应在开始日期之后</small>}{msg&&<aside>{msg}</aside>}{r&&<><button onClick={()=>pdf(rows,r,charts)}>导出 PDF</button><div>{charts.map(ch=><img key={ch.label} style={{width:"100%",display:"block",marginTop:8}} src={ch.canvas.toDataURL()} alt={ch.label+"趋势"}/>)}</div><table><tbody>{rows.map(([k,v],i)=><tr key={i}><th>{k}</th><td>{v}</td></tr>)}</tbody></table></>}</dialog></>
}