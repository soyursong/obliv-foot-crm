import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';
const EMAIL=env.TEST_EMAIL, PW=env.TEST_PASSWORD;
const COMP_ID='58d06350-edba-456a-ae21-0c5559be4522';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1280,height:900}});const p=await ctx.newPage();
p.on('dialog',d=>d.dismiss());
await p.goto(BASE+'/login');await p.waitForTimeout(500);
await p.locator('input[type=email]').fill(EMAIL);
await p.locator('input[type=password]').fill(PW);
await p.getByRole('button',{name:'로그인'}).click();
await p.waitForTimeout(3000);
console.log('after login URL',p.url());
await p.goto(BASE+'/admin/reservations');await p.waitForLoadState('networkidle');await p.waitForTimeout(1200);
// switch to week view
const wk=p.getByRole('button',{name:/^주(간)?$/}).first();
if(await wk.count()){await wk.click();await p.waitForTimeout(600);console.log('switched week');}
async function hasCard(){return await p.locator(`[data-testid="resv-card-${COMP_ID}"]`).count();}
// find next-week nav: try buttons containing chevron/next; enumerate icon buttons
async function clickNext(){
  // heuristics: header nav buttons; pick button with aria-label containing 다음/next OR svg lucide-chevron-right
  const cand=p.locator('button:has(svg.lucide-chevron-right), button[aria-label*="다음"], button[aria-label*="next" i]');
  if(await cand.count()){await cand.first().click();return true;}
  return false;
}
let tries=0;
while(!(await hasCard()) && tries<10){ if(!(await clickNext())){console.log('no next btn');break;} await p.waitForTimeout(500); tries++; }
const cnt=await hasCard();
console.log('companion card present:',cnt,'tries',tries);
if(cnt){
  const card=p.locator(`[data-testid="resv-card-${COMP_ID}"]`).first();
  await card.scrollIntoViewIfNeeded().catch(()=>{});
  console.log('card text:', (await card.innerText().catch(()=>'')).replace(/\n/g,'|'));
  await card.click();
  await p.waitForTimeout(900);
  const newDlg=await p.getByRole('dialog').filter({hasText:'신규 예약'}).count();
  const editDlg=await p.getByRole('dialog').filter({hasText:'예약 수정'}).count();
  const anyDlg=await p.getByRole('dialog').count();
  console.log('>>> after companion single click: 신규예약Dlg=',newDlg,'예약수정Dlg=',editDlg,'anyDlg=',anyDlg);
  for(const d of await p.getByRole('dialog').all()){console.log('  dlg:',(await d.innerText().catch(()=>'')).slice(0,50).replace(/\n/g,' '));}
  // now try double click
  await p.keyboard.press('Escape').catch(()=>{});
  await p.waitForTimeout(300);
  await card.dblclick().catch(()=>{});
  await p.waitForTimeout(700);
  console.log('after dblclick: 신규=',await p.getByRole('dialog').filter({hasText:'신규 예약'}).count(),'수정=',await p.getByRole('dialog').filter({hasText:'예약 수정'}).count());
}
await p.screenshot({path:'/tmp/resv-week.png'});
await b.close();
