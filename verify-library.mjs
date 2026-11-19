import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const base=process.env.STUDIO_URL||'http://127.0.0.1:4186';
const browser=await chromium.launch({channel:'chrome'});
try{
 const p=await browser.newPage();await p.goto(base);
 await p.getByLabel('新学员姓名').fill('动作库测试 '+Date.now().toString(36));
 await p.getByRole('button',{name:'建立档案'}).click();
 await p.getByLabel('新学员姓名').filter({visible:true}).waitFor();
 await p.waitForFunction(()=>document.querySelector('input[required]')?.value==='');
 await p.getByRole('button',{name:'从动作库选择'}).click();
 const dlg=p.getByRole('dialog');await dlg.getByLabel('搜索动作').fill('Overload Eccentric Back Squat');
 await dlg.locator('button.film').click();
 await p.locator('video').evaluate(async v=>{await v.play()});
 await p.waitForFunction(()=>document.querySelector('video')?.currentTime>0);
 await dlg.getByRole('button',{name:/循环 GIF/}).click();
 await p.waitForFunction(()=>document.querySelector('.playbox img')?.naturalWidth>0,null,{timeout:75000});
 await dlg.getByRole('button',{name:'加入当天计划'}).click();await p.getByRole('button',{name:'保存草稿'}).click();
 await p.getByRole('button',{name:'发布计划'}).click();await p.getByText('计划已发布',{exact:true}).waitFor();
 const target=await p.getByText('打开学员视图').getAttribute('href');
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true});await mobile.goto(base+target);
 await mobile.getByRole('button',{name:'查看动作示范'}).click();await mobile.getByRole('heading',{name:'超负荷离心深蹲'}).waitFor();
 await mobile.getByRole('button',{name:/循环 GIF/}).click();await mobile.waitForFunction(()=>document.querySelector('.playbox img')?.naturalWidth===320);
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: catalog search, actual video playback, 320px GIF, draft, publish, student mobile preview');
}finally{await browser.close()}