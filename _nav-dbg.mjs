import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1400,height:1000}});const p=await ctx.newPage();
await p.goto(BASE+'/login');await p.waitForTimeout(400);
await p.locator('input[type=email]').fill(env.TEST_EMAIL);await p.locator('input[type=password]').fill(env.TEST_PASSWORD);
await p.getByRole('button',{name:'로그인'}).click();await p.waitForTimeout(2500);
await p.goto(BASE+'/admin/reservations');await p.waitForLoadState('networkidle');await p.waitForTimeout(1200);
// all buttons with aria-label / svg class
const btns=await p.locator('button').all();
let idx=0;
for(const bt of btns){const t=(await bt.innerText().catch(()=>'')).trim();const al=await bt.getAttribute('aria-label');const tid=await bt.getAttribute('data-testid');const svg=await bt.locator('svg').first().getAttribute('class').catch(()=>null);
 if(al||tid||svg||t) console.log(idx,'txt=',JSON.stringify(t.slice(0,12)),'aria=',al,'tid=',tid,'svg=',svg); idx++;}
// day header
const dh=await p.locator('[data-testid="resv-day-header"]').allInnerTexts().catch(()=>[]);
console.log('day headers:',dh);
await p.screenshot({path:'/tmp/resv-nav.png'});
await b.close();
