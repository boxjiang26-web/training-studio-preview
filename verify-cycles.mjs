import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
async function request(path,token,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token},body:body&&JSON.stringify(body)});return {status:r.status,data:await r.json()}}
const coach=(await request('trial','',{})).data.token, stamp=Date.now().toString(36);
const browser=await chromium.launch({channel:'chrome'}), pair=[];
try{
 for(const [i,label] of ['甲','乙'].entries()){
 const name='周期验收'+label+stamp,id=(await request('students',coach,{name})).data.id;
 const token=(await request('trial','',{student:id})).data.token;pair.push({id,token});
 const c=await browser.newPage();await c.goto(base);await c.getByLabel('当前学员').selectOption(String(id));await c.getByRole('button',{name:'多周训练周期'}).click();
 const d=c.getByRole('dialog',{name:'多周训练周期'}),goal=i?'核心稳定':'下肢控制',move=i?'平板支撑':'徒手深蹲',qty=i?30:10;
 await d.getByLabel('周期目标').fill(goal);await d.getByLabel('开始周一').fill('2026-11-23');await d.getByLabel('周期周数').fill('3');await d.getByRole('button',{name:'建立周期'}).click();
 const mon=d.locator('article').first();await mon.getByRole('button',{name:'添加动作'}).click();await mon.getByLabel('动作',{exact:true}).fill(move);await mon.getByLabel('每组',{exact:true}).fill(String(qty));await mon.getByLabel('单位').selectOption(i?'秒':'次');
 await d.getByRole('button',{name:'保存周草稿'}).click();await d.getByText('周草稿已保存').waitFor();
 assert.equal((await request('day?day=2026-11-23',token)).data.plan,null);
 await d.getByRole('button',{name:'确认发布本周'}).click();await d.getByText('本周已发布').waitFor();
 await d.getByLabel('编排周次').selectOption('1');await d.getByLabel('每组次数或时长比例 (%)').fill(i?'80':'120');await d.getByRole('button',{name:'复用上一周'}).click();
 const copied=i?24:12;await d.getByText('已复制，可继续逐日调整').waitFor();assert.equal(await mon.getByLabel('每组',{exact:true}).inputValue(),String(copied));await mon.getByLabel('组数',{exact:true}).fill('2');
 assert.equal((await request('day?day=2026-11-30',token)).data.plan,null);
 await d.getByRole('button',{name:'确认发布本周'}).click();await d.getByText('本周已发布').waitFor();
 const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true});await p.goto(base+'/?student='+id);
 const selector=p.getByLabel('已发布周期周');await selector.waitFor();assert.equal(await selector.locator('option').count()||0,3);
 for(const [date,sets,n] of [['2026-11-30',2,copied],['2026-11-23',3,qty]]){
 await selector.selectOption(date);const card=p.locator('article').filter({has:p.locator('strong',{hasText:move})});await card.waitFor();await p.waitForFunction(([s,q])=>Array.from(document.querySelectorAll('article')).some(a=>a.textContent.includes(s+' 组 × '+q)),[sets,n]);
 }
 const weeks=(await request('cycle-weeks',token)).data;assert.deepEqual(weeks.map(w=>w.goal),[goal,goal]);await c.close();await p.close();console.log('PASS',goal,qty,'->',copied);
 }
 for(const [i,s] of pair.entries()){assert.equal((await request('day?day=2026-11-23&student='+pair[1-i].id,s.token)).status,403);assert.equal((await request('coach/cycle/list',s.token,{student:pair[1-i].id})).status,403)}
 console.log('PASS two student scopes, week 3 unpublished, mobile week navigation');
}finally{await browser.close()}