import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
let token='';
function request(route,body){return fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token},body:body&&JSON.stringify(body)})}
async function api(route,body){const res=await request(route,body),r=await res.json();assert.ok(res.ok,r.error);return r}
token=(await api('trial',{})).token;
const {students}=await api('me');
const fixtures=[
 {name:'周知夏（周期AI测试·晨练）',goal:'协调下肢发力',metric:'立定跳远',unit:'厘米',scores:[180,187],rpe:8,done:1,note:'下周期先巩固落地控制，每周复核跳远表现。'},
 {name:'许远航（周期AI测试·晚练）',goal:'加强核心耐力',metric:'平板支撑',unit:'秒',scores:[45,57],rpe:5,done:3,note:'下周期延续核心耐力练习，每周复核支撑时长。'}
];
const browser=await chromium.launch({channel:'chrome'});
try {
 for(const f of fixtures){
   f.student=students.find(s=>s.name===f.name).id;
   const {cycles}=await api('coach/cycle/list',{student:f.student});
   f.cycle=cycles.find(c=>c.goal===f.goal&&c.start_day==='2026-11-16').id;
   const csv=['姓名,日期,项目,成绩,单位',...f.scores.map((score,i)=>[f.name,i?'2026-11-23':'2026-11-16',f.metric,score,f.unit].join(','))].join('\n');
   await api('coach/assessments/confirm',{csv});
   const nextGoal=f.goal+' · 复盘后续周期';
   f.next=cycles.find(c=>c.goal===nextGoal)?.id||(await api('coach/cycle/create',{student:f.student,start:'2026-12-07',weeks:3,goal:nextGoal})).id;
 }
 await Promise.all(fixtures.map(async(f,i)=>{
   const other=fixtures[1-i],page=await browser.newPage();
   await page.goto(base);await page.getByLabel('当前学员').selectOption(String(f.student));
   await page.getByRole('button',{name:'多周训练周期'}).click();
   const dlg=page.getByRole('dialog',{name:'多周训练周期'});
   await dlg.getByLabel('当前周期').selectOption(f.cycle);await dlg.getByText('训练周期复盘',{exact:true}).click();
   const row=dlg.locator('tbody tr');await row.nth(2).waitFor();
   for(const [col,val] of [[1,'1 / 2 场已反馈'],[2,f.done+' / 6'],[3,String(f.rpe)]])assert.equal(await row.first().locator('td').nth(col-1).innerText(),val);
   assert.ok((await row.nth(1).innerText()).includes('+'+(f.scores[1]-f.scores[0])+f.unit));
   assert.ok(!(await dlg.locator('tbody').innerText()).includes(other.metric));assert.ok((await row.nth(2).innerText()).includes('未发布'));
   if(await dlg.getByLabel('复盘结论').inputValue()!==f.note){
     await dlg.getByLabel('复盘结论').fill(f.note);await dlg.getByRole('button',{name:'确认复盘结论'}).click();await dlg.getByText('结论已确认，供下一周期生成草稿时参考').waitFor();
   }
   for(const route of ['review','confirm-review'])assert.equal((await request('coach/cycle/'+route,{student:f.student,cycle:other.cycle,note:'错误归属',reviewRev:0})).status,404);
   await dlg.getByLabel('当前周期').selectOption(f.next);page.on('dialog',d=>d.accept());
   const generated=page.waitForResponse(r=>r.url().endsWith('/cycle/generate'),{timeout:300000});
   await dlg.getByRole('button',{name:'AI 生成本周草稿'}).click();const result=await (await generated).json();
   assert.equal(result.reference?.previousReview?.note,f.note,result.error);assert.ok(!JSON.stringify(result.reference).includes(other.note));assert.equal(result.published,0);
   await dlg.getByText('本周编排依据').click();await dlg.getByText('上周期复盘 · '+f.goal+' · '+f.note).waitFor();
   console.log('PASS',f.name,f.done+'/6','RPE',f.rpe,f.metric,f.scores.join(' → '),'已生成本人后续草稿');
 }));
}finally{await browser.close()}
