import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';const CID='58d06350-edba-456a-ae21-0c5559be4522';const MAIN='276531c7-da82-4f2f-8935-c838a636ccab';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1024,height:1366},hasTouch:true});
const p=await ctx.newPage();p.setDefaultTimeout(5000);p.on('dialog',d=>d.dismiss());
await p.goto(BASE+'/login');await p.waitForTimeout(400);
await p.locator('input[type=email]').fill(env.TEST_EMAIL);await p.locator('input[type=password]').fill(env.TEST_PASSWORD);
await p.getByRole('button',{name:'로그인'}).click();await p.waitForTimeout(2500);
await p.goto(BASE+'/admin/reservations');await p.waitForLoadState('networkidle');await p.waitForTimeout(1000);
await p.locator('button',{hasText:/^17$/}).first().click().catch(()=>{});await p.waitForTimeout(1200);
console.log('day-cells:',await p.locator('[data-testid^="resv-day-cell-"]').count(),' day-horizontal:',await p.locator('[data-testid="resv-day-horizontal"]').count());
async function pop(){const nw=await p.locator('[role="dialog"]').filter({hasText:'신규 예약'}).count();const any=await p.locator('[role="dialog"]').count();const t=[];for(const d of await p.locator('[role="dialog"]').all())t.push((await d.innerText().catch(()=>'')).slice(0,40).replace(/\n/g,' '));return {nw,any,t};}
// baseline: tap empty day cell (new row) at a late time likely empty
const empty=p.locator('[data-testid^="resv-day-cell-new-"]');const ne=await empty.count();
let based=false;
for(let i=ne-1;i>=0 && !based;i--){const c=empty.nth(i);if(await c.locator('[data-testid^="resv-card-"]').count()>0)continue;if(!await c.isVisible().catch(()=>0))continue;await c.tap().catch(e=>console.log('tap err',e.message));await p.waitForTimeout(600);const s=await pop();if(s.nw){console.log('BASELINE empty day cell .tap() → 신규예약 popup OK');based=true;await p.keyboard.press('Escape');await p.waitForTimeout(300);}}
if(!based)console.log('BASELINE .tap() did NOT open popup — emulation may not fire click');
// tap companion card via locator.tap()
const comp=p.locator(`[data-testid="resv-card-${CID}"]`).first();
if(await comp.count()){await comp.tap().catch(e=>console.log('comp tap err',e.message));await p.waitForTimeout(700);console.log('COMPANION .tap() →',JSON.stringify(await pop()));await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(300);}
const main=p.locator(`[data-testid="resv-card-${MAIN}"]`).first();
if(await main.count()){await main.tap().catch(e=>console.log('main tap err',e.message));await p.waitForTimeout(700);console.log('MAIN .tap() →',JSON.stringify(await pop()));}
await p.screenshot({path:'/tmp/dayview.png'});
await b.close();
