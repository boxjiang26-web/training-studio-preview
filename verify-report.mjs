import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
async function api(route,token,body){const res=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token||''},body:body&&JSON.stringify(body)});const result=await res.json();assert.equal(res.status,200,JSON.stringify(result));return result}
const coach=(await api('trial','',{})).token, names=['甲','乙'].map(n=>'报告验收'+n+Date.now().toString(36)),ids=[];
for(const [i,name] of names.entries()){
 const {id}=await api('students',coach,{name});ids.push(id);const token=(await api('trial','',{student:id})).token;
 for(const day of ['2026-11-01','2026-11-15']){
 const target={day,student:id};await api('draft',coach,{...target,rev:0,items:[{name:'徒手深蹲',sets:2,qty:8,unit:'次'}]});await api('publish',coach,{...target,rev:1});
 const {plan}=await api('day?day='+day,token);
 await api('feedback',token,{day,plan:plan.id,sets:[[true,!!i]],rpe:(day.endsWith('01')?3:5)+i,note:name});
 }
 await api('coach/assessments/confirm',coach,{csv:'姓名,日期,项目,成绩,单位\n'+name+',2026-11-01,跳远,'+(200+i)+',厘米\n'+name+',2026-11-15,跳远,'+(210+i)+',厘米'});
}
const browser=await chromium.launch({channel:'chrome'});try{
 const p=await browser.newPage();await p.goto(base);await p.getByRole('button',{name:'个人训练报告'}).click();const dlg=p.getByRole('dialog',{name:'个人训练报告'});
 await dlg.getByLabel('开始日期').fill('2026-11-01');await dlg.getByLabel('结束日期').fill('2026-11-15');
 for(const [i,id] of ids.entries()){
 await dlg.getByLabel('报告学员').selectOption(String(id));await dlg.getByRole('button',{name:'预览报告'}).click();await dlg.getByRole('cell',{name:names[i],exact:true}).waitFor();
 assert.ok((await dlg.locator('table').innerText()).includes('完成 '+(i?4:2)+'/4 组'));assert.equal(await dlg.getByRole('img').count(),3);assert.ok((await dlg.locator('table').innerText()).includes('较上次 +10'));assert.equal(await dlg.locator('tr').filter({hasText:'平均 RPE'}).locator('td').innerText(),(4+i).toFixed(1));
 const wait=p.waitForEvent('download');await dlg.getByRole('button',{name:'导出 PDF'}).click();const download=await wait;const path='data/report-qa-'+(i+1)+'.pdf';await download.saveAs(path);const bytes=await fs.readFile(path);assert.ok(bytes.toString('ascii',0,5)==='%PDF-'&&bytes.length>20000);console.log(download.suggestedFilename(),bytes.length)
 }
 await dlg.getByLabel('开始日期').fill('2026-11-15');await dlg.getByRole('button',{name:'预览报告'}).click();await dlg.getByText('1 场计划 · 1 场反馈 · 完成 2/2 组').waitFor();console.log('PASS both profiles, dates, trends, scores, two PDF downloads');
}finally{await browser.close()}