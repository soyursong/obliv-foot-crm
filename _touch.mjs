import { chromium, devices } from '@playwright/test';
import fs from 'fs';
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';const CID='58d06350-edba-456a-ae21-0c5559be4522';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1024,height:768},hasTouch:true,isMobile:false});
const p=await ctx.newPage();p.setDefaultTimeout(5000);p.on('dialog',d=>d.dismiss());
await p.goto(BASE+'/login');await p.waitForTimeout(400);
await p.locator('input[type=email]').fill(env.TEST_EMAIL);await p.locator('input[type=password]').fill(env.TEST_PASSWORD);
await p.getByRole('button',{name:'로그인'}).click();await p.waitForTimeout(2500);
await p.goto(BASE+'/admin/reservations');await p.waitForLoadState('networkidle');await p.waitForTimeout(1000);
await p.locator('button',{hasText:/^17$/}).first().click().catch(()=>{});await p.waitForTimeout(1200);
const card=p.locator(`[data-testid="resv-card-${CID}"]`).first();
const cnt=await card.count();console.log('companion card count:',cnt);
if(!cnt){await b.close();process.exit(0);}
console.log('card text:',(await card.innerText()).replace(/\n/g,'|'));
async function dlgState(tag){
  const nw=await p.getByRole('dialog').filter({hasText:'신규 예약'}).count();
  const ed=await p.getByRole('dialog').filter({hasText:'예약 수정'}).count();
  const rd=await p.locator('[data-testid="newmode-datetime-readonly"]').count();
  const any=await p.getByRole('dialog').count();
  const titles=[];for(const d of await p.getByRole('dialog').all()){titles.push((await d.innerText().catch(()=>'')).slice(0,45).replace(/\n/g,' '));}
  console.log(tag,'| 신규예약dlg=',nw,'예약수정dlg=',ed,'newmode-readonly=',rd,'anyDlg=',any,'titles=',JSON.stringify(titles));
}
// TAP (touch) the companion card center
const box=await card.boundingBox();console.log('box',box);
await p.touchscreen.tap(box.x+box.width/2, box.y+box.height/2);
await p.waitForTimeout(800);await dlgState('TOUCH-TAP-companion');
await b.close();
