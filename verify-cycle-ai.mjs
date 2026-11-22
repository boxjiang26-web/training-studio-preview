import {testRoster} from './test-roster.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
const testName=await testRoster(base);
async function req(path,body,token=''){return fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token},body:body&&JSON.stringify(body)})}
async function api(path,body,token){const r=await req(path,body,token);assert.ok(r.ok,path+' '+r.status);return r.json()}
const coach=(await api('trial',{})).token,pair=[];
const start='2026-11-16',week='2026-11-23';
for(const [i,k] of ['甲','乙'].entries()){
 const name=testName('周期AI',k),{id:student}=await api('students',{name},coach),token=(await api('trial',{student})).token;
 const goal=i?'加强核心耐力':'协调下肢发力',note=i?'本周先复核核心训练动作':'优先复核下肢动作质量';
 const {id:cycle}=await api('coach/cycle/create',{student,goal,start,weeks:3},coach);
 const days=Array.from({length:7},()=>[]);days[0]=[{name:i?'平板支撑':'徒手深蹲',sets:3,qty:i?30:10,unit:i?'秒':'次'}];days[2]=days[0];
 await api('coach/cycle/publish',{student,cycle,idx:0,rev:0,days},coach);
 const plan=(await api('day?day='+start,null,token)).plan;
 await api('feedback',{day:start,plan:plan.id,sets:[[true,!!i,!!i]],rpe:i?5:8,note:'测试反馈 '+k},token);
 const {rows}=await api('coach/memory/generate',{student},coach);
 for(const [j,r] of rows.entries())await api('coach/memory/review',{student,id:r.id,rev:r.rev,note:j?'拒绝的建议'+k:note,status:j?'已拒绝':'已接受'},coach);
 pair.push({name,student,cycle,token,goal,note});
}
const browser=await chromium.launch({channel:'chrome'});
try{await Promise.all(pair.map(async(s,i)=>{
 const other=pair[1-i];const p=await browser.newPage();await p.goto(base);await p.getByLabel('当前学员').selectOption(String(s.student));await p.getByRole('button',{name:'多周训练周期'}).click();const dlg=p.getByRole('dialog',{name:'多周训练周期'});
 await dlg.getByLabel('当前周期').selectOption(s.cycle);await dlg.getByLabel('编排周次').selectOption('1');
 const response=p.waitForResponse(r=>r.url().endsWith('/cycle/generate'),{timeout:300000});await dlg.getByRole('button',{name:'AI 生成本周草稿'}).click();const gen=await (await response).json();assert.ok(gen.reference,gen.error);const ctx=gen.reference;
 assert.equal(ctx.previousStart,start);assert.deepEqual(ctx.memories,[s.note]);assert.deepEqual(ctx.previous.map(x=>[x.completed,x.rpe]),[[i?3:1,i?5:8],[null,null]]);
 assert.equal(ctx.previous[0].plan[0].name,i?'平板支撑':'徒手深蹲');assert.equal(gen.published,0);
 await dlg.getByText('AI 草稿已保存，请逐日审核').waitFor();const idx=gen.days.findIndex(a=>a.length);
 const row=dlg.locator('article').nth(idx);await row.getByLabel('每组',{exact:true}).first().fill(String(14+i));await dlg.getByRole('button',{name:'保存周草稿'}).click();await dlg.getByText('周草稿已保存').waitFor();
 const dt=new Date(week);dt.setUTCDate(dt.getUTCDate()+idx);const day=dt.toISOString().slice(0,10);
 assert.equal((await api('day?day='+day,null,s.token)).plan,null);
 await dlg.getByRole('button',{name:'确认发布本周'}).click();await dlg.getByText('本周已发布').waitFor();
 assert.equal((await api('day?day='+day,null,s.token)).plan.items[0].qty,14+i);
 assert.equal((await req('day?student='+other.student+'&day='+day,null,s.token)).status,403);
 assert.equal((await req('coach/cycle/generate',{student:s.student,cycle:other.cycle,idx:1,rev:0},coach)).status,404);
 console.log('PASS',s.name,s.goal,ctx.previous[0].completed+'/3','RPE',ctx.previous[0].rpe,'one accepted memory, own plan, manual edit, review before publication');
}));}finally{await browser.close()}
