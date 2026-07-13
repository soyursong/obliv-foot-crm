import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';const CID='58d06350-edba-456a-ae21-0c5559be4522';const MAIN='276531c7-da82-4f2f-8935-c838a636ccab';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1400,height:1000}});
const p=await ctx.newPage();p.setDefaultTimeout(5000);p.on('dialog',d=>d.dismiss());
await p.goto(BASE+'/login');await p.waitForTimeout(400);
await p.locator('input[type=email]').fill(env.TEST_EMAIL);await p.locator('input[type=password]').fill(env.TEST_PASSWORD);
await p.getByRole('button',{name:'로그인'}).click();await p.waitForTimeout(2500);
await p.goto(BASE+'/admin/reservations');await p.waitForLoadState('networkidle');await p.waitForTimeout(1000);
await p.locator('button',{hasText:/^17$/}).first().click().catch(()=>{});await p.waitForTimeout(1200);
async function report(tag){
  const rd=await p.locator('[role="dialog"]').all();
  const modal=await p.locator('.fixed.inset-0, [data-state="open"]').all();
  const rdT=[];for(const d of rd)rdT.push((await d.innerText().catch(()=>'')).slice(0,50).replace(/\n/g,' '));
  console.log(tag,'| role=dialog:',rd.length,JSON.stringify(rdT));
}
// baseline: empty cell click
const cells=p.locator('[data-testid^="week-slot-"]');const n=await cells.count();console.log('week cells',n);
let done=false;
for(let i=0;i<n && !done;i++){const c=cells.nth(i);if(await c.locator('[data-testid^="resv-card-"]').count()>0)continue;if(!await c.isVisible().catch(()=>0))continue;await c.click({position:{x:5,y:3}}).catch(()=>{});await p.waitForTimeout(600);const has=await p.locator('[role="dialog"]').filter({hasText:'신규 예약'}).count();if(has){console.log('BASELINE empty-cell → 신규예약 popup OK');done=true;await p.keyboard.press('Escape');await p.waitForTimeout(300);}}
if(!done)console.log('BASELINE empty-cell popup NOT triggered in harness');
// MAIN dblclick
await p.locator(`[data-testid="resv-card-${MAIN}"]`).first().dblclick();await p.waitForTimeout(800);await report('MAIN dblclick');
await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(400);
// COMPANION dblclick
await p.locator(`[data-testid="resv-card-${CID}"]`).first().dblclick();await p.waitForTimeout(800);await report('COMPANION dblclick');
await p.screenshot({path:'/tmp/desk.png'});
await b.close();
