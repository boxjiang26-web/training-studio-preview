import {testRoster} from './test-roster.mjs';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186', browser=await chromium.launch({channel:'chrome',headless:true});
const testName=await testRoster(base);
async function openView(url,mobile=false){const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});const p=await context.newPage();p.on('request',r=>{const t=r.headers()['x-studio-session'];if(t)p.trialToken=t});await p.goto(url);await p.getByRole('heading',{level:1,name:mobile?'我的训练':'训练编排',exact:true}).waitFor();return p;}
try{
const c=await openView(base);const students=[];
for(const label of ['A','B']){const name=testName('训练',label==='A'?'甲':'乙');const display=name.replace(/（[^（）]+测试·(?:晨练|晚练|组外)）$/,'');if(!(await c.getByLabel('新学员姓名').isVisible()))await c.getByText('新建学员档案',{exact:true}).click();await c.getByLabel('新学员姓名').fill(name);await c.getByRole('button',{name:'建立档案'}).click();await c.waitForFunction(n=>document.querySelector('select[aria-label="当前学员"]')?.selectedOptions[0]?.textContent?.startsWith(n),display);const link=await c.getByText('打开学员视图').getAttribute('href');students.push({name,id:await c.getByLabel('当前学员').inputValue(),p:await openView(base+link,true)});}
const [a,b]=students;const select=async(s)=>{await c.getByLabel('当前学员').selectOption(s.id);await c.getByRole('button',{name:'添加动作'}).waitFor()};
const save=async()=>{await c.getByRole('button',{name:'保存草稿'}).click();await c.getByText('已保存草稿',{exact:true}).waitFor()};
const publish=async()=>{await c.getByRole('button',{name:'发布计划'}).click();await c.getByText('计划已发布',{exact:true}).waitFor()};
await select(a);await c.getByRole('button',{name:'添加动作'}).click();await c.getByLabel('动作',{exact:true}).selectOption('平板支撑');await c.getByLabel('每组',{exact:true}).fill('30');await c.getByLabel('单位').selectOption('秒');await save();
await a.p.reload();await a.p.getByText('这一天还没有已发布的训练。').waitFor();await publish();
await b.p.reload();await b.p.getByText('这一天还没有已发布的训练。').waitFor();
await c.getByLabel('每组',{exact:true}).fill('45');await save();
await a.p.reload();await a.p.locator('article strong').filter({hasText:'平板支撑'}).waitFor();assert.match(await a.p.locator('article').innerText(),/30 秒/);
await select(b);await c.getByRole('button',{name:'添加动作'}).click();await save();await publish();
for(const s of students){const {p}=s;await p.reload();await p.getByRole('checkbox').first().waitFor();assert.equal(await p.locator('article strong').innerText(),s===a?'平板支撑':'徒手深蹲');for(const box of await p.getByRole('checkbox').all())await box.check();
const note='训练验收 '+s.name;await p.getByLabel('训练备注').fill(note);await p.getByRole('button',{name:'提交反馈'}).click();await p.locator('output').getByText(note,{exact:true}).waitFor();s.feedback=(await p.locator('output small').innerText()).replace('反馈编号 ','');
await select(s);await c.getByRole('button',{name:'刷新记录'}).click();await c.locator('output small').filter({hasText:s.feedback}).waitFor();assert.equal(await c.locator('output p').innerText(),note);
await p.context().setExtraHTTPHeaders({'x-studio-session':p.trialToken});const other=s===a?b:a;const day=await p.getByLabel('训练日期').inputValue();const read=await p.request.get(base+'/api/day?student='+other.id+'&day='+day);assert.equal(read.status(),403);
const write=await p.request.post(base+'/api/feedback',{data:{student:Number(other.id),day}});assert.equal(write.status(),403);
const own=await(await p.request.get(base+'/api/day?day='+day)).json();const retry=await p.request.post(base+'/api/feedback',{data:{day,plan:own.plan.id,rpe:5,note,sets:own.feedback.sets}});assert.equal((await retry.json()).id,s.feedback);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
for(const s of students){
  await select(s);
  const p=s.p, original=await p.getByLabel('训练日期').inputValue();
  const originalTile=c.locator('[data-day="'+original+'"]');
  await originalTile.filter({hasText:'已反馈 RPE 5'}).waitFor();
  const another=c.locator('button[data-day]').filter({hasText:'未安排'}).first();
  const otherDay=await another.getAttribute('data-day');
  await another.click();
  await c.getByRole('button',{name:'添加动作'}).click();
  await c.getByLabel('动作',{exact:true}).selectOption('髋部拉伸');
  await save();
  const secondTile=c.locator('[data-day="'+otherDay+'"]');
  await secondTile.filter({hasText:'草稿'}).waitFor();
  await p.reload();
  await p.locator('[data-day="'+otherDay+'"]').filter({hasText:'未安排'}).waitFor();
  await publish();await secondTile.filter({hasText:'待反馈'}).waitFor();
  assert.equal(await c.locator('.days button').count(),7);
  await p.reload();await p.locator('[data-day="'+otherDay+'"]').filter({hasText:'髋部拉伸'}).click();
  await p.getByRole('checkbox').first().check();
  await p.getByLabel('训练备注').fill('跨日验收 '+s.name);
  await p.getByRole('button',{name:'提交反馈'}).click();
  await p.locator('output p').filter({hasText:'跨日验收 '+s.name}).waitFor();
  s.secondDay=otherDay;s.secondFeedback=(await p.locator('output small').innerText()).replace('反馈编号 ','');
  await p.getByRole('button',{name:'上一周'}).click();
  await p.getByRole('button',{name:'训练记录'}).click();
  await p.locator('.history button').filter({hasText:original}).click();
  await p.locator('output small').filter({hasText:s.feedback}).waitFor();
  await c.getByRole('button',{name:'刷新记录'}).click();
  await secondTile.filter({hasText:'已反馈'}).waitFor();
  await c.locator('output small').filter({hasText:s.secondFeedback}).waitFor();
  await originalTile.click();await c.locator('output small').filter({hasText:s.feedback}).waitFor();
  const denied=await p.request.get(base+'/api/calendar?day='+original+'&student='+(s===a?b:a).id,{headers:{'x-studio-session':p.trialToken}});
  assert.equal(denied.status(),403);
}

assert.notEqual(a.feedback,b.feedback);const record={at:new Date().toISOString(),mobileViewport:'390x844',students:students.map(s=>({name:s.name,feedback:s.feedback,secondDay:s.secondDay,secondFeedback:s.secondFeedback})),verified:['draft visibility','published snapshot','two separate plans','coach readback matches both IDs and notes','cross-student read/write denied both directions','duplicate submit returns original ID','mobile layout width','seven-day overview and draft scope','second-day editing and feedback','cross-week history for both students','calendar scope isolation']};fs.writeFileSync('acceptance.json',JSON.stringify(record,null,2));console.log(record);
}finally{await browser.close()}