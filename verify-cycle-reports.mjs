import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
async function api(route,token,body){return fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token},body:body&&JSON.stringify(body)})}
const token=(await (await api('trial','',{})).json()).token;
const {students}=await (await api('me',token)).json();
const browser=await chromium.launch({channel:'chrome'});
try{
 const cases=[['周知夏','晨练','协调下肢发力','立定跳远','+7厘米'],['许远航','晚练','加强核心耐力','平板支撑','+12秒']];
 for(const [i,[name,lane,goal,metric,delta]] of cases.entries()){
 const other=cases[1-i],student=students.find(s=>s.name===name+'（周期AI测试·'+lane+'）').id;
 const coach=await browser.newPage();await coach.goto(base);
 const pick=coach.getByLabel('当前学员',{exact:true});await pick.selectOption({label:name});
 assert.equal(await pick.locator('option').filter({hasText:new RegExp('^'+name+'$')}).count(),1);
 await coach.getByLabel('训练档案',{exact:true}).selectOption(String(student));
 await coach.getByRole('button',{name:'周期报告',exact:true}).click();
 const cycles=await (await api('coach/cycle/list',token,{student})).json(),cycle=cycles.cycles.find(c=>c.goal===goal).id;
 await coach.getByLabel('报告周期').selectOption(cycle);
 const preview=coach.locator('.reportbody');await preview.getByText(goal,{exact:true}).waitFor();
 assert.ok((await preview.innerText()).includes(delta));
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true});await mobile.goto(base+'/?student='+student);
 const inbox=mobile.locator('section').filter({has:mobile.getByRole('heading',{name:'我的周期报告'})});
 const send=coach.getByRole('button',{name:'确认发送给学员'});
 if(await send.count()){
 await inbox.getByText('还没有收到教练发送的报告').waitFor();
 await send.click();await coach.getByRole('button',{name:'已发送给学员'}).waitFor();
 }
 await mobile.reload();await inbox.locator('summary').filter({hasText:goal}).click();
 assert.equal(await inbox.locator('.reportbody').innerText(),await preview.innerText());
 assert.ok(!(await inbox.innerText()).includes(other[2]));
 const peer=students.find(s=>s.name===other[0]+'（周期AI测试·'+other[1]+'）').id;
 const peerToken=(await (await api('trial','',{student:peer})).json()).token;
 const rows=await (await api('cycle-reports?student='+student,peerToken)).json();assert.ok(!rows.some(r=>r.cycle===cycle));
 assert.equal((await api('coach/cycle/send-report',peerToken,{student,cycle})).status,403);
 assert.equal((await api('coach/cycle/preview-report',token,{student:peer,cycle})).status,404);
 console.log('PASS',name,metric,delta,'教练预览与手机报告一致，跨档案隔离');
 await coach.close();await mobile.close();
 }
}finally{await browser.close()}
