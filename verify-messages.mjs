import {testRoster} from './test-roster.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
const testName=await testRoster(base);
async function api(path,token,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token},body:body&&JSON.stringify(body)});return {status:r.status,data:await r.json()}}
const coach=(await api('trial','',{})).data.token,pair=[];
const browser=await chromium.launch({channel:'chrome'});
try{
 const c=await browser.newPage();for(const part of ['甲','乙']){
 const name=testName('沟通',part);const {id}=(await api('students',coach,{name})).data;const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
 await p.goto(base+'/?student='+id);pair.push({id,name,p,token:(await api('trial','',{student:id})).data.token});
 }
 await c.goto(base);
 const chat=p=>p.getByRole('dialog',{name:'训练对话'});
 async function send(p,text){await chat(p).getByLabel('消息内容').fill(text);await chat(p).getByRole('button',{name:'发送消息'}).click();await chat(p).getByText(text,{exact:true}).waitFor()}
 for(const s of pair){
 await c.getByLabel('当前学员').selectOption(String(s.id));await c.getByRole('button',{name:'学员消息',exact:true}).click();
 await send(c,'教练问候 '+s.name);await chat(c).getByRole('button',{name:'关闭'}).click();
 }
 for(const [i,s] of pair.entries()){
 const {p}=s;await p.getByRole('button',{name:'教练消息 · 1 条未读'}).click();await chat(p).getByText('教练问候 '+s.name,{exact:true}).waitFor();assert.equal(await chat(p).locator('.bubble').count(),1);
 await send(p,'学员回复 '+s.name);await chat(p).getByRole('button',{name:'关闭'}).click();await p.getByRole('button',{name:'教练消息',exact:true}).waitFor();
 const other=pair[1-i];for(const [path,body] of [['thread?student='+other.id,undefined],['send',{student:other.id,requestId:'wrong-thread',body:'错误归属'}],['read',{student:other.id,ids:[1]}]]){
 assert.equal((await api('messages/'+path,s.token,body)).status,403);}
 }
 for(const s of pair){
 await c.getByLabel('当前学员').selectOption(String(s.id));await c.getByRole('button',{name:'学员消息 · 1 条未读'}).click();
 await chat(c).getByText('学员回复 '+s.name,{exact:true}).waitFor();assert.equal(await chat(c).locator('.bubble').count(),2);await chat(c).getByRole('button',{name:'关闭'}).click();await c.getByRole('button',{name:'学员消息',exact:true}).waitFor();
 await s.p.reload();await s.p.getByRole('button',{name:'教练消息',exact:true}).click();
 await chat(s.p).getByText('已读',{exact:true}).waitFor();assert.equal(await chat(s.p).locator('.bubble').count(),2);
 assert.ok(!(await chat(s.p).innerText()).includes(pair.find(x=>x.id!==s.id).name));
 }
 console.log('PASS: two independent mobile sessions, bidirectional messages, both unread counts cleared on opening, read receipts and history after reload, cross-thread read/send/ack blocked.');
}finally{await browser.close()}