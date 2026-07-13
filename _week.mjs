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
await p.locator('button',{hasText:/^17$/}).first().click().catch(()=>{});await p.waitForTimeout(1000);
// switch to week
const wk=p.getByRole('button',{name:/^주(간)?$/}).first();if(await wk.count()){await wk.click();await p.waitForTimeout(800);console.log('week toggled');}
console.log('week-slot cells:',await p.locator('[data-testid^="week-slot-"]').count(),'comp card:',await p.locator(`[data-testid="resv-card-${CID}"]`).count());
async function pop(){const nw=await p.locator('[role="dialog"]').filter({hasText:'신규 예약'}).count();const ed=await p.locator('[role="dialog"]').filter({hasText:'예약 수정'}).count();const any=await p.locator('[role="dialog"]').count();return {nw,ed,any};}
const comp=p.locator(`[data-testid="resv-card-${CID}"]`).first();
if(await comp.count()){
  await comp.tap().catch(e=>console.log('taperr',e.message));await p.waitForTimeout(700);console.log('WEEK COMPANION single .tap() →',JSON.stringify(await pop()));await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(300);
  // double tap
  const box=await comp.boundingBox();await comp.tap();await p.waitForTimeout(120);await comp.tap();await p.waitForTimeout(700);console.log('WEEK COMPANION double .tap() →',JSON.stringify(await pop()));await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(300);
}
await p.screenshot({path:'/tmp/week2.png'});
await b.close();
