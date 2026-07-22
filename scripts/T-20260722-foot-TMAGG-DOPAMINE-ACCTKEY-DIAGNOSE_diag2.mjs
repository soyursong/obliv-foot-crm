// AC-D2 보강: source_system/created_via 전체 분포 + registrar_name 형식별 created_by 채움 교차
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

const { data: all } = await sb.from('reservations').select('id,created_by,registrar_name,source_system,created_via');
const rows = all || [];
console.log(`\n[보강] reservations total = ${rows.length}`);

// source_system 분포 + 각 그룹의 created_by 채움율
const bySrc = {};
for (const r of rows) {
  const s = r.source_system ?? '∅';
  bySrc[s] = bySrc[s] || { n:0, cbFilled:0 };
  bySrc[s].n++;
  if ((r.created_by??'').toString().trim() !== '') bySrc[s].cbFilled++;
}
console.log('\nsource_system 별 (건수 / created_by 채움):');
for (const [s,v] of Object.entries(bySrc).sort((a,b)=>b[1].n-a[1].n))
  console.log(`   ${s.padEnd(14)}  n=${String(v.n).padStart(5)}  created_by채움=${v.cbFilled}`);

// created_via 분포
const byVia = {};
for (const r of rows){ const v=r.created_via??'∅'; byVia[v]=(byVia[v]||0)+1; }
console.log('\ncreated_via 분포: ' + JSON.stringify(byVia));

// registrar_name 이 "[도파민TM]" prefix 인 행 vs bare-name 행 — created_by 채움 교차
let pfx=0, pfxCb=0, bare=0, bareCb=0;
for (const r of rows) {
  const rn=(r.registrar_name??'').toString().trim();
  if (!rn) continue;
  const cbF=(r.created_by??'').toString().trim()!=='';
  if (rn.startsWith('[도파민TM]')) { pfx++; if(cbF)pfxCb++; }
  else { bare++; if(cbF)bareCb++; }
}
console.log(`\nregistrar_name 형식별: [도파민TM]prefix n=${pfx}(cb채움 ${pfxCb}) / bare-name n=${bare}(cb채움 ${bareCb})`);
console.log('  → bare-name(진운선/이수빈/김효신)=풋 tm계정 보유자, [도파민TM]prefix(박민지/김수진)=풋 계정 미보유자로 추정 구분됨');
process.exit(0);
