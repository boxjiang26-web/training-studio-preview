import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
async function request(path,body,token=''){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-studio-session':token},body:body&&JSON.stringify(body)});return {status:r.status,data:await r.json()}}
const coach=(await request('trial',{})).data.token;
const students=(await request('me',null,coach)).data.students;
const pair=['甲','乙'].map(prefix=>students.find(s=>s.name.startsWith('报告验收'+prefix)));
const browser=await chromium.launch({channel:'chrome'});
try{
 for(const [i,s] of pair.entries()){
  const p=await browser.newPage();await p.goto(base);await p.getByLabel('当前学员').selectOption(String(s.id));await p.getByRole('button',{name:'训练记忆',exact:true}).click();
  const dlg=p.getByRole('dialog',{name:'训练记忆'});await dlg.getByRole('button',{name:'生成记忆建议'}).click();
  const load=async()=>(await request('coach/memory/list',{student:s.id},coach)).data.rows;
  const item=dlg.locator('article').filter({has:dlg.page().getByRole('heading',{name:/训练负荷/})});
  const note=i?'核心稳定课先复核最近训练的主观用力程度':'下肢课先核对上次反馈的组数';
  await item.getByLabel('记忆内容').fill(note);await item.getByRole('button',{name:'保存修改'}).click();await item.getByRole('button',{name:'接受'}).click();await item.getByText(/训练负荷 · 已接受/).waitFor();
  const feedback=dlg.locator('article').filter({has:p.getByRole('heading',{name:/学员反馈/})});await feedback.getByRole('button',{name:'拒绝'}).click();await feedback.getByText(/已拒绝/).waitFor();
  await dlg.getByRole('button',{name:'生成记忆建议'}).click();await dlg.getByRole('button',{name:'生成记忆建议'}).isEnabled();const rows=await load();assert.equal(rows.length,3);assert.equal(rows.filter(x=>x.status==='待审核').length,1);
  const accepted=rows.find(x=>x.status==='已接受');
  assert.equal((await request('coach/memory/review',{student:pair[1-i].id,id:accepted.id,rev:accepted.rev,note:'错误归属',status:'已拒绝'},coach)).status,409);
  const studentToken=(await request('trial',{student:s.id})).data.token;assert.equal((await request('coach/memory/list',{student:s.id},studentToken)).status,403);
  await dlg.getByRole('button',{name:'关闭'}).click();await p.getByRole('button',{name:'AI 辅助编排'}).click();
  const ai=p.getByRole('dialog',{name:'AI 周计划'});await ai.getByLabel('训练周').fill('2026-12-07');await ai.getByLabel('训练目标').fill(i?'核心稳定训练':'下肢力量训练');
  const response=p.waitForResponse(r=>r.url().endsWith('/coach/ai/generate'),{timeout:300000});await ai.getByRole('button',{name:/生成周草稿|重新生成草稿/}).click();
  const gen=await (await response).json();assert.ok(gen.draft,gen.error);assert.deepEqual(gen.draft.context.memories,[note]);
  await ai.locator('summary').click();await ai.getByText('已确认记忆 · '+note,{exact:true}).waitFor();
  console.log('PASS',s.name,'3 suggestions, saved + approved/rejected/pending, deduplicated, cross-owner review denied, live generation received exactly the accepted text');await p.close()
 }
}finally{await browser.close()}