import {roleTag} from './test-roster.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base='http://127.0.0.1:4186';
async function api(path,token,body){const res=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token},body:body&&JSON.stringify(body)});return res.json()}
const coach=(await api('trial','',{})).token,me=await api('me',coach);
const browser=await chromium.launch({channel:'chrome'});
try{
 const learners=['甲','乙'].map(k=>me.students.find(s=>s.name.endsWith(roleTag('报告',k))));
 await Promise.all(learners.map(async(s,i)=>{
 const p=await browser.newPage();await p.goto(base);await p.getByLabel('当前学员').selectOption(String(s.id));await p.getByRole('button',{name:'AI 辅助编排'}).click();
 const dlg=p.getByRole('dialog',{name:'AI 周计划'});let week='2026-11-23';while((await api('coach/ai/load',coach,{student:s.id,week})).draft?.published){const d=new Date(week);d.setUTCDate(d.getUTCDate()+7);week=d.toISOString().slice(0,10)}
 await dlg.getByLabel('训练周').fill(week);await dlg.getByLabel('训练目标').fill(i?'每周三天基础力量，侧重核心稳定':'提高跳远表现，兼顾下肢控制与恢复');await dlg.getByRole('button',{name:/生成周草稿|重新生成草稿/}).click();
 await dlg.getByText('草稿已生成，请逐日审核').waitFor({timeout:110000}).catch(async e=>{throw Error((await dlg.locator('output').innerText())+' '+e.message)});
 const load=()=>api('coach/ai/load',coach,{student:s.id,week});
 const {draft}=await load();assert.equal(draft.context.feedback.length,2);assert.equal(draft.context.tests.length,2);assert.equal(draft.context.tests[0].score,210+i);assert.equal(draft.context.feedback[0].rpe,5+i);
 const idx=draft.days.findIndex(x=>x.length);const article=dlg.locator('article').nth(idx);await article.getByLabel('每组',{exact:true}).first().fill('17');
 await dlg.getByRole('button',{name:'保存逐日修改'}).click();await dlg.getByText('修改已保存').waitFor();assert.equal((await load()).draft.days[idx][0].qty,17);
 const d=new Date(week);d.setUTCDate(d.getUTCDate()+idx);const day=d.toISOString().slice(0,10);const token=(await api('trial','',{student:s.id})).token;
 assert.equal((await api('day?day='+day,token)).plan,null);
 await dlg.getByRole('button',{name:'确认发布本周计划'}).click();await dlg.getByText('本周计划已发布',{exact:true}).waitFor();
 assert.equal((await api('day?day='+day,token)).plan.items[0].qty,17);console.log('PASS',s.name,week,draft.days.filter(x=>x.length).length,'days, live AI, edited, hidden until approved');
 }));
}finally{await browser.close()}