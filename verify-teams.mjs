import {testRoster} from './test-roster.mjs';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
const testName=await testRoster(base);
const browser=await chromium.launch({channel:'chrome'});
try{
 const coach=await browser.newPage();await coach.goto(base);
 const label=Date.now().toString(36), students=[];
 for(const part of ['外','甲','乙']){
   const name=testName('团队',part);
   await coach.getByLabel('新学员姓名').fill(name);await coach.getByRole('button',{name:'建立档案'}).click();
   await coach.waitForFunction(n=>document.querySelector('select[aria-label="当前学员"]')?.selectedOptions[0]?.textContent===n,name);
   students.push({name,id:await coach.getByLabel('当前学员').inputValue()});
 }
 const target=await coach.getByLabel('训练日期').inputValue();
 const prior=new Date(target);prior.setUTCDate(prior.getUTCDate()-7);
 await coach.getByLabel('训练日期').fill(prior.toISOString().slice(0,10));
 await coach.getByRole('button',{name:'添加动作'}).click();await coach.getByRole('button',{name:'保存草稿'}).click();await coach.getByText('已保存草稿',{exact:true}).waitFor();
 await coach.getByRole('button',{name:'团队工作台'}).click();const desk=coach.getByRole('dialog',{name:'团队工作台'});
 await desk.getByLabel('团队名称').fill('验收组'+label);
 for(const s of students.slice(1))await desk.getByLabel(s.name,{exact:true}).check();
 await desk.getByRole('button',{name:'建立团队'}).click();await desk.getByText('团队已建立').waitFor();
 await desk.getByRole('button',{name:'模板与分发'}).click();await desk.getByLabel('模板名称').fill('基础课'+label);await desk.getByRole('button',{name:'保存为模板'}).click();await desk.getByText('模板已保存').waitFor();
 await desk.getByLabel('发布日期').fill(target);await desk.getByRole('button',{name:'确认团队发布'}).click();await desk.getByText('已发布 2 人，跳过 0 人').waitFor();
 await desk.getByRole('button',{name:'确认团队发布'}).click();await desk.getByText(/已发布 0 人，跳过 2 人/).waitFor();
 for(const [i,s] of students.entries()){
   const mobile=await browser.newPage({viewport:{width:390,height:844}});await mobile.goto(base+'/?student='+s.id);
   if(!i){await mobile.getByText('这一天还没有已发布的训练。').waitFor();continue}
   await mobile.getByRole('checkbox').first().check();
   if(i===2)await mobile.getByRole('checkbox').nth(1).check();
   await mobile.getByLabel('整体用力程度 RPE').selectOption(String(i+4));await mobile.getByLabel('训练备注').fill('验收 '+s.name);
   await mobile.getByRole('button',{name:'提交反馈'}).click();await mobile.locator('output small').waitFor();
 }
 await desk.getByRole('button',{name:'训练周报'}).click();
 await desk.locator('tbody tr').nth(1).waitFor();
 assert.deepEqual(await desk.locator('.metrics strong').allTextContents(),['2','2','5.5']);
 for(const [i,s] of students.slice(1).entries()){const row=desk.locator('tbody tr').filter({hasText:s.name});assert.match(await row.innerText(),new RegExp((i+1)+'/3'))}
 const download=coach.waitForEvent('download');await desk.getByRole('button',{name:'导出周报 CSV'}).click();
 const csv=await fs.readFile(await (await download).path(),'utf8');assert.equal(csv.trim().split('\n').length,3);assert.ok(csv.includes(students[1].name)&&csv.includes(students[2].name)&&!csv.includes(students[0].name));
 console.log('PASS: saved template, two recipients, duplicate skips, excluded nonmember, feedback 1/3 and 2/3, mean 5.5, CSV verified');
}finally{await browser.close()}