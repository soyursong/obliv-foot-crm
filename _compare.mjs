import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';const CID='58d06350-edba-456a-ae21-0c5559be4522';
const MAIN='276531c7-da82-4f2f-8935-c838a636ccab'; // 임혜선 main 7-17
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1024,height:768},hasTouch:true});
const p=await ctx.newPage();p.setDefaultTimeout(5000);let toasts=[];p.on('dialog',d=>d.dismiss());
await p.goto(BASE+'/login');await p.waitForTimeout(400);
await p.locator('input[type=email]').fill(env.TEST_EMAIL);await p.locator('input[type=password]').fill(env.TEST_PASSWORD);
await p.getByRole('button',{name:'로그인'}).click();await p.waitForTimeout(2500);
await p.goto(BASE+'/admin/reservations');await p.waitForLoadState('networkidle');await p.waitForTimeout(1000);
await p.locator('button',{hasText:/^17$/}).first().click().catch(()=>{});await p.waitForTimeout(1200);
async function state(tag){
  const any=await p.getByRole('dialog').count();
  const titles=[];for(const d of await p.getByRole('dialog').all()){titles.push((await d.innerText().catch(()=>'')).slice(0,40).replace(/\n/g,' '));}
  const toastTxt=await p.locator('[data-sonner-toast],.sonner-toast,[role="status"]').allInnerTexts().catch(()=>[]);
  console.log(tag,'anyDlg=',any,'titles=',JSON.stringify(titles),'toasts=',JSON.stringify(toastTxt));
}
async function tap(sel,tag){
  const el=p.locator(sel).first(); if(!await el.count()){console.log(tag,'NOT FOUND');return;}
  const box=await el.boundingBox(); await p.touchscreen.tap(box.x+box.width/2,box.y+box.height/2); await p.waitForTimeout(700); await state(tag);
  await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(300);
}
await tap(`[data-testid="resv-card-${MAIN}"]`,'TAP MAIN 임혜선');
await tap(`[data-testid="resv-card-${MAIN}"] span`,'TAP MAIN name-span');
await tap(`[data-testid="resv-card-${CID}"]`,'TAP COMPANION 동행이');
await tap(`[data-testid="resv-card-${CID}"] span`,'TAP COMPANION name-span');
// empty cell tap: pick a week-slot with no card
const cells=p.locator('[data-testid^="week-slot-"]');const n=await cells.count();
for(let i=0;i<n;i++){const c=cells.nth(i);if(await c.locator('[data-testid^="resv-card-"]').count()>0)continue;if(!await c.isVisible().catch(()=>0))continue;const bx=await c.boundingBox();if(!bx)continue;await p.touchscreen.tap(bx.x+5,bx.y+5);await p.waitForTimeout(700);await state('TAP EMPTY CELL');break;}
await b.close();
