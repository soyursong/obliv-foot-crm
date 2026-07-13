import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';
const EMAIL=env.TEST_EMAIL||env.TEST_ADMIN_EMAIL, PW=env.TEST_PASSWORD||env.TEST_ADMIN_PW;
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:800}});
const p=await ctx.newPage();
p.on('dialog',d=>d.dismiss());
await p.goto(BASE+'/admin/reservations');
const li=p.getByPlaceholder('이메일');
if(await li.isVisible({timeout:4000}).catch(()=>false)){
  await li.fill(EMAIL); await p.getByPlaceholder('비밀번호').fill(PW);
  await p.getByRole('button',{name:'로그인'}).click();
  await p.waitForURL(/admin|dashboard|\/$/,{timeout:15000}).catch(()=>{});
}
await p.goto(BASE+'/admin/reservations');
await p.waitForLoadState('networkidle');
await p.waitForTimeout(1000);
console.log('URL',p.url());
// list buttons
const btns=await p.getByRole('button').all();
const labels=[];
for(const bt of btns){const t=(await bt.innerText().catch(()=>'')).trim();if(t)labels.push(t);}
console.log('BUTTONS:',JSON.stringify(labels.slice(0,40)));
// list any resv-card testids
const cards=await p.locator('[data-testid^="resv-card-"]').all();
console.log('resv-card count on default view:',cards.length);
await p.screenshot({path:'/tmp/resv-default.png',fullPage:false});
await b.close();
