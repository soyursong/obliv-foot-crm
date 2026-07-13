import { chromium } from '@playwright/test';
import fs from 'fs';
const env={};
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}
console.log('EMAIL candidates:',env.TEST_EMAIL, env.TEST_ADMIN_EMAIL, env.TEST_USER_EMAIL);
const BASE='http://localhost:8089';
const b=await chromium.launch();const ctx=await b.newContext();const p=await ctx.newPage();
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto(BASE+'/login');await p.waitForTimeout(800);
const inputs=await p.locator('input').all();
for(const i of inputs){console.log('input',await i.getAttribute('type'),'ph=',await i.getAttribute('placeholder'),'name=',await i.getAttribute('name'));}
await b.close();
