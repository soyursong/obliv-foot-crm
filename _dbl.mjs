import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';const CID='58d06350-edba-456a-ae21-0c5559be4522';const MAIN='276531c7-da82-4f2f-8935-c838a636ccab';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1024,height:768},hasTouch:true});
const p=await ctx.newPage();p.setDefaultTimeout(5000);p.on('dialog',d=>d.dismiss());
const errs=[];p.on('pageerror',e=>errs.push('PAGEERR '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text().slice(0,120));});
await p.goto(BASE+'/login');await p.waitForTimeout(400);
await p.locator('input[type=email]').fill(env.TEST_EMAIL);await p.locator('input[type=password]').fill(env.TEST_PASSWORD);
await p.getByRole('button',{name:'로그인'}).click();await p.waitForTimeout(2500);
await p.goto(BASE+'/admin/reservations');await p.waitForLoadState('networkidle');await p.waitForTimeout(1000);
await p.locator('button',{hasText:/^17$/}).first().click().catch(()=>{});await p.waitForTimeout(1200);
async function dblAndReport(id,tag){
  const card=p.locator(`[data-testid="resv-card-${id}"]`).first();
  const box=await card.boundingBox();
  const cx=box.x+box.width/2, cy=box.y+box.height/2;
  await p.touchscreen.tap(cx,cy);await p.waitForTimeout(100);await p.touchscreen.tap(cx,cy);
  await p.waitForTimeout(900);
  const any=await p.locator('[role="dialog"]').count();
  const titles=[];for(const d of await p.locator('[role="dialog"]').all()){titles.push((await d.innerText().catch(()=>'')).slice(0,60).replace(/\n/g,' '));}
  console.log(tag,'DBLTAP dialogs=',any,'titles=',JSON.stringify(titles));
  await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(400);
}
await dblAndReport(MAIN,'MAIN');
await dblAndReport(CID,'COMPANION');
console.log('ERRORS:',JSON.stringify(errs.slice(0,8),null,1));
await b.close();
