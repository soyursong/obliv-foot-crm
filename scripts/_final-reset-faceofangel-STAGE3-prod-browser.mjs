/** STAGE3: prod /admin browser login evidence with FINAL known pw. read-only (login only). */
import { chromium } from '@playwright/test';
const BASE=process.env.PROD_BASE||'https://obliv-foot-crm.vercel.app';
const EMAIL='faceofangel9999@oblivseoul.kr';
const PW=process.env.NEWPW||(()=>{throw new Error('NEWPW req')})();
const b=await chromium.launch();const ctx=await b.newContext();const p=await ctx.newPage();
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120));});
await p.goto(BASE+'/login',{waitUntil:'networkidle'}).catch(()=>p.goto(BASE+'/login'));
await p.waitForTimeout(1200);
// fill email/password
const email=p.locator('input[type="email"], input[name="email"]').first();
const pass=p.locator('input[type="password"]').first();
await email.fill(EMAIL); await pass.fill(PW);
await p.locator('button[type="submit"], button:has-text("로그인")').first().click();
await p.waitForTimeout(3500);
const url=p.url();
const bodyText=(await p.locator('body').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,400);
console.log('post-login url :',url);
console.log('landed off /login:',!/\/login/.test(url));
console.log('screen text head:',bodyText.slice(0,220));
const shot=`_artifacts/faceofangel-prod-login-${Date.now?0:0}.png`;
await p.screenshot({path:'_artifacts/faceofangel-prod-login.png',fullPage:false}).catch(()=>{});
console.log('screenshot     : _artifacts/faceofangel-prod-login.png');
console.log('console errors :',errs.length?errs.slice(0,3):'(none)');
await b.close();
