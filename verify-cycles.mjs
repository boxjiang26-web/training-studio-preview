import {testRoster} from './test-roster.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
const testName=await testRoster(base);
async function request(path,token,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token},body:body&&JSON.stringify(body)});return {status:r.status,data:await r.json()}}
const coach=(await request('trial','',{})).data.token;
const browser=await chromium.launch({channel:'chrome'}), pair=[];
try{
 for(const [i,label] of ['甲','乙'].entries()){
 const name=testName('周期',label),id=(await request('students',coach,{name})).data.id;
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

 // TASK-003: custom exercise + structured strength fields + load-based weekly progression.
 const customName='周期前蹲-'+Date.now().toString(36);
 assert.equal((await request('coach/exercises',coach,{name:customName,category:'lower_strength',muscles:['股四头肌'],equipment:['杠铃']})).status,200);
 const lifterName=testName('周期力量','甲');
 const lifterId=(await request('students',coach,{name:lifterName})).data.id;
 const lifterToken=(await request('trial','',{student:lifterId})).data.token;
 const c2=await browser.newPage();await c2.goto(base);
 await c2.getByLabel('当前学员',{exact:true}).selectOption(String(lifterId));
 await c2.getByRole('button',{name:'多周训练周期'}).click();
 const d2=c2.getByRole('dialog',{name:'多周训练周期'});
 await d2.getByLabel('周期目标').fill('力量递进测试');
 await d2.getByLabel('开始周一').fill('2026-12-14');
 await d2.getByLabel('周期周数').fill('2');
 await d2.getByRole('button',{name:'建立周期'}).click();
 const mon2=d2.locator('article').first();
 await mon2.getByRole('button',{name:'添加动作'}).click();
 await mon2.getByLabel('动作',{exact:true}).fill(customName);
 await mon2.getByLabel('组数',{exact:true}).fill('4');
 await mon2.getByLabel('每组',{exact:true}).fill('5');
 await mon2.getByLabel('负荷类型').selectOption('kg');
 await mon2.getByLabel('负荷',{exact:true}).fill('100');
 await mon2.getByLabel('目标 RPE').fill('8');
 await mon2.getByLabel('间歇(秒)').fill('150');
 await mon2.getByLabel('节奏 Tempo').fill('3-1-1-0');
 await mon2.getByLabel('提示备注').fill('稳住躯干');
 await d2.getByRole('button',{name:'保存周草稿'}).click();await d2.getByText('周草稿已保存').waitFor();
 await d2.getByRole('button',{name:'确认发布本周'}).click();await d2.getByText('本周已发布').waitFor();

 const w1Day=(await request('day?day=2026-12-14',lifterToken)).data;
 assert.equal(w1Day.plan.items[0].name,customName);
 assert.equal(w1Day.plan.items[0].load,100);
 assert.equal(w1Day.plan.items[0].loadUnit,'kg');
 assert.equal(w1Day.plan.items[0].targetRpe,8);
 assert.equal(w1Day.plan.items[0].restSec,150);
 assert.equal(w1Day.plan.items[0].tempo,'3-1-1-0');
 assert.equal(w1Day.plan.items[0].cue,'稳住躯干');

 await d2.getByLabel('编排周次').selectOption('1');
 await d2.getByLabel('调整目标').selectOption('load');
 await d2.getByLabel('每组次数或时长比例 (%)').fill('105');
 await d2.getByRole('button',{name:'复用上一周'}).click();
 await d2.getByText('已复制，可继续逐日调整').waitFor();
 assert.equal(await mon2.getByLabel('负荷',{exact:true}).inputValue(),'105');
 assert.equal(await mon2.getByLabel('每组',{exact:true}).inputValue(),'5');
 await d2.getByRole('button',{name:'确认发布本周'}).click();await d2.getByText('本周已发布').waitFor();

 const p2=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
 await p2.goto(base+'/?student='+lifterId);
 await p2.getByLabel('已发布周期周').selectOption('2026-12-21');
 await p2.getByText('105 kg · 目标 RPE 8 · 间歇 150 秒 · 节奏 3-1-1-0').waitFor();
 await p2.getByText('教练提示：稳住躯干').waitFor();
 await c2.close();await p2.close();
 console.log('PASS cycle strength fields, custom exercise, and 100 kg -> 105 kg load progression');
}finally{await browser.close()}