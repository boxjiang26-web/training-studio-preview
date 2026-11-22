import {testRoster} from './test-roster.mjs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const url=process.env.STUDIO_URL||'http://127.0.0.1:4186';
const testName=await testRoster(url);
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage();await page.goto(url);
  const names=['甲','乙'].map(n=>testName('测评',n)),ids=[];
  for(const name of names){
    await page.getByLabel('新学员姓名').fill(name);await page.getByRole('button',{name:'建立档案'}).click();
    await page.waitForFunction(n=>document.querySelector('[aria-label="当前学员"]')?.selectedOptions[0]?.textContent===n,name);
    ids.push(await page.getByLabel('当前学员').inputValue());
  }
  const header='学员姓名,测评日期,测评项目,成绩,单位';
  const lines=[header,names[0]+',2026-11-01,立定跳远,210,厘米',names[0]+',2026-11-15,立定跳远,218,厘米',
    '乙的简称,2026-11-01,"30米,计时",4.8,秒',names[1]+',2026-11-15,"30米,计时",4.6,秒',names[1]+',2026-11-15,"30米,计时",4.6,秒'];
  const dialog=page.getByRole('dialog',{name:'测评导入'});
  async function upload(lines){await page.getByRole('button',{name:'导入测评 CSV'}).click();await dialog.getByLabel('上传 CSV').setInputFiles({name:'成绩.csv',mimeType:'text/csv',buffer:Buffer.from('\ufeff'+lines.join('\r\n'))})}
  await upload(lines);await dialog.getByText('需匹配',{exact:true}).waitFor();assert.ok(await dialog.getByRole('button',{name:'确认导入'}).isDisabled());
  await dialog.getByLabel('第3行归属学员').selectOption(ids[1]);await dialog.getByText('共 5 条，待导入 4 条。').waitFor();
  await dialog.getByRole('button',{name:'关闭'}).click();await page.getByRole('button',{name:'历次测评'}).click();await page.getByText('这名学员还没有测评成绩。').waitFor();
  await upload(lines);await dialog.getByLabel('第3行归属学员').selectOption(ids[1]);await dialog.getByRole('button',{name:'确认导入'}).click();
  await dialog.getByText('已导入 4 条，跳过 1 条').waitFor();await dialog.getByRole('button',{name:'关闭'}).click();
  let history=page.locator('.assessment-history');await history.getByText('-0.2',{exact:true}).waitFor();
  assert.equal(await history.locator('tbody tr').count(),2);assert.ok(!(await history.innerText()).includes('跳远'));
  await page.getByLabel('当前学员').selectOption(ids[0]);await history.getByText('+8',{exact:true}).waitFor();assert.equal(await history.locator('tbody tr').count(),2);
  await upload(lines);await dialog.getByLabel('第3行归属学员').selectOption(ids[1]);await dialog.getByText('共 5 条，待导入 0 条。').waitFor();assert.ok(await dialog.getByRole('button',{name:'确认导入'}).isDisabled());
  await dialog.getByRole('button',{name:'关闭'}).click();await upload([header,names[0]+',2026-11-15,立定跳远,219,厘米',names[0]+',2026-02-31,立定跳远,209,厘米']);
  await dialog.getByText('同日成绩冲突').waitFor();await dialog.getByText('日期、项目、单位或成绩无效').waitFor();assert.ok(await dialog.getByRole('button',{name:'确认导入'}).isDisabled());
  console.log('PASS: two learner profiles, CSV preview without writes, manual mapping, four imported scores, one duplicate, +8 cm / -0.2 s trends, repeat upload, conflicting score and invalid date.');
}finally{await browser.close()}