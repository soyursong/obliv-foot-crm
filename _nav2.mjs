import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
const BASE='http://localhost:8089';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1400,height:1000}});const p=await ctx.newPage();
p.setDefaultTimeout(5000);
await p.goto(BASE+'/login');await p.waitForTimeout(400);
await p.locator('input[type=email]').fill(env.TEST_EMAIL);await p.locator('input[type=password]').fill(env.TEST_PASSWORD);
await p.getByRole('button',{name:'로그인'}).click();await p.waitForTimeout(2500);
await p.goto(BASE+'/admin/reservations');await p.waitForLoadState('networkidle');await p.waitForTimeout(1000);
// enumerate icon-only buttons (no text) count
const all=await p.locator('button').count();
console.log('total buttons',all);
// look for mini-calendar day cells containing '17'
const cal17=p.locator('button',{hasText:/^17$/});
console.log('buttons with text 17:',await cal17.count());
// Try clicking any '17' then look for companion
if(await cal17.count()){ await cal17.first().click().catch(e=>console.log('click17 err',e.message)); await p.waitForTimeout(1000);}
const dh=await p.locator('[data-testid="resv-day-header"]').allInnerTexts().catch(()=>[]);
console.log('day headers now:',dh);
const cards=await p.locator('[data-testid^="resv-card-"]').count();
console.log('resv-card count:',cards);
const comp=await p.locator('[data-testid="resv-card-58d06350-edba-456a-ae21-0c5559be4522"]').count();
console.log('companion card:',comp);
await p.screenshot({path:'/tmp/resv-x.png'});
await b.close();
