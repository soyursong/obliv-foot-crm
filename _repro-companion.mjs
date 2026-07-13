import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';
const EMAIL=env.TEST_EMAIL||env.TEST_ADMIN_EMAIL;
const PW=env.TEST_PASSWORD||env.TEST_ADMIN_PW;
const COMP_ID='58d06350-edba-456a-ae21-0c5559be4522'; // 동행이 2026-07-17 13:00 confirmed
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
// go to week view
const wk=p.getByRole('button',{name:/^주(간)?$/}).first();
if(await wk.count()){await wk.click();await p.waitForTimeout(500);}
// navigate to the week of 2026-07-17: click next-week until date header shows 7.17 (best-effort)
async function hasCard(){return await p.locator(`[data-testid="resv-card-${COMP_ID}"]`).count();}
let tries=0;
while(!(await hasCard()) && tries<12){
  const next=p.getByRole('button',{name:/다음|›|>/}).first();
  if(await next.count()){await next.click();await p.waitForTimeout(400);} else break;
  tries++;
}
const cnt=await hasCard();
console.log('companion card present:',cnt, 'after',tries,'week-nav');
if(cnt){
  const card=p.locator(`[data-testid="resv-card-${COMP_ID}"]`).first();
  await card.scrollIntoViewIfNeeded().catch(()=>{});
  const box=await card.boundingBox();
  console.log('card box',box);
  await card.click({force:true});
  await p.waitForTimeout(800);
  const newDlg=await p.getByRole('dialog').filter({hasText:'신규 예약'}).isVisible({timeout:1500}).catch(()=>false);
  const anyDlg=await p.getByRole('dialog').count();
  console.log('>>> NEW-reservation dialog visible after companion click:',newDlg,' anyDialogCount:',anyDlg);
  // dump dialog titles
  for(const d of await p.getByRole('dialog').all()){console.log('  dialog text head:', (await d.innerText().catch(()=>'')).slice(0,60).replace(/\n/g,' '));}
} else {
  // fallback: search all companion cards on any visible week
  console.log('could not locate specific companion card in visible weeks');
}
await b.close();
