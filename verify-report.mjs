import {testRoster} from './test-roster.mjs';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
const testName=await testRoster(base);
async function api(route,token,body){const res=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token||''},body:body&&JSON.stringify(body)});const result=await res.json();assert.equal(res.status,200,JSON.stringify(result));return result}
const coach=(await api('trial','',{})).token, names=['甲','乙'].map(n=>testName('报告',n)),ids=[];
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

 // TASK-004: verify weighted personal report tonnage & e1RM charts + delta rows + PDF.
 const wName=testName('报告力量','甲');
 const {id:wId}=await api('students',coach,{name:wName});
 const wToken=(await api('trial','',{student:wId})).token;
 const wDays=[
   {day:'2026-11-01',load:100,weight:100,reps:5,rpe:7},
   {day:'2026-11-15',load:105,weight:105,reps:5,rpe:8},
 ];
 for(const s of wDays){
   await api('draft',coach,{day:s.day,student:wId,rev:0,items:[{name:'徒手深蹲',sets:3,qty:5,unit:'次',load:s.load,loadUnit:'kg'}]});
   await api('publish',coach,{day:s.day,student:wId,rev:1});
   const {plan}=await api('day?day='+s.day,wToken);
   await api('feedback',wToken,{day:s.day,plan:plan.id,rpe:s.rpe,note:'负重记录',setLogs:[Array.from({length:3},()=>({done:true,weight:s.weight,unit:'kg',reps:s.reps}))]});
 }
 await p.reload();await p.getByRole('button',{name:'个人训练报告'}).click();
 const dlg2=p.getByRole('dialog',{name:'个人训练报告'});
 await dlg2.getByLabel('报告学员').selectOption(String(wId));
 await dlg2.getByLabel('开始日期').fill('2026-11-01');await dlg2.getByLabel('结束日期').fill('2026-11-15');
 await dlg2.getByRole('button',{name:'预览报告'}).click();
 await dlg2.getByRole('cell',{name:wName,exact:true}).waitFor();
 // Charts: completion %, RPE, session tonnage (kg), e1RM squat (kg) = 4 charts.
 assert.equal(await dlg2.getByRole('img').count(),4);
 const text=await dlg2.locator('table').innerText();
 assert.ok(text.includes('3075 kg'), 'Expected total volume 1500 + 1575 = 3075 kg');
 assert.ok(text.includes('预估 1RM 122.5 kg'), 'Expected 105kg x 5 Epley 1RM = 122.5 kg');
 assert.ok(text.includes('较上次 +5.8 kg'), 'Expected +5.8 kg e1RM delta (122.5 - 116.7)');
 console.log('PASS personal report tonnage (3075 kg) & e1RM (+5.8 kg) trends');
}finally{await browser.close()}