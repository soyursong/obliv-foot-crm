/** Phase 0b — 확정 2고객 의존그래프 정밀 + 624 성격 보강. READ-ONLY. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  // 1) 확정 2고객 — id prefix(text cast via filter) + 이름/전화 교차
  console.log('=== 확정 2 D1 테스트고객 탐색 ===');
  const found = new Map();
  // by id text prefix using PostgREST: id=ilike doesn't work on uuid; use or with like on cast not possible → fetch by name/phone
  const probes = [
    ['name', '테스트_김환자'], ['phone', '010-9999-0001'],
    ['name', '[TEST-D1] 테스트환자01'], ['phone', '+821099990001'],
    ['chart_number', 'TC-0002'], ['chart_number', 'F-0110'],
  ];
  for (const [col, val] of probes) {
    const { data, error } = await sb.from('customers').select('id,name,phone,chart_number,is_simulation,created_at,clinic_id').eq(col, val);
    if (error) { console.log(`  probe ${col}=${val}: ERR ${error.message}`); continue; }
    data.forEach(d => found.set(d.id, d));
  }
  // also try id prefix via gte/lt range on uuid text? skip — rely on name/phone
  const custs = [...found.values()];
  console.log(`  매칭 고객 ${custs.length}:`);
  custs.forEach(c => console.log(`    ${c.id} | ${c.name} | ${c.phone} | chart=${c.chart_number} | sim=${c.is_simulation} | ${c.created_at?.slice(0,10)}`));

  const cids = custs.map(c => c.id);
  if (cids.length) {
    for (const t of ['reservations', 'check_ins', 'packages', 'payments']) {
      const { data, error } = await sb.from(t).select('*').in('customer_id', cids);
      if (error) { console.log(`  ${t}: ERR ${error.message}`); continue; }
      console.log(`  ${t} (${data.length}): ${data.map(r => r.id).join(', ')}`);
      data.forEach(r => console.log(`      ${r.id} | cust=${r.customer_id.slice(0,8)} | status=${r.status} | ${r.created_at?.slice(0,16)}`));
    }
  }

  // 2) 624 성격 보강 — created_by, lead_source, visit_route 분포
  console.log('\n=== 624 sims 성격 보강 ===');
  let out = [], from = 0;
  for (;;) { const { data } = await sb.from('customers').select('id,name,phone,created_by,lead_source,visit_route,created_at').eq('is_simulation', true).range(from, from + 999); out = out.concat(data); if (data.length < 1000) break; from += 1000; }
  const dist = (key) => { const m = {}; out.forEach(r => { const k = r[key] || '(null)'; m[k] = (m[k] || 0) + 1; }); return m; };
  for (const k of ['created_by', 'lead_source', 'visit_route']) {
    console.log(`  ${k}:`); Object.entries(dist(k)).sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([v,n]) => console.log(`    ${v}: ${n}`));
  }
  // 전화번호 패턴: +82 10 99 / +82 100000 등 합성 prefix 비율
  const synthPhone = out.filter(r => /^\+?82?0?1099\d{6}$|^\+?82?100000\d|^010-?9999|^\+?821000\d{6}|^\+?8210000/.test((r.phone||'').replace(/[^0-9+]/g,'')));
  console.log(`\n  합성 전화패턴(1099xxxxxx / 100000xx / 9999...) 매칭: ${synthPhone.length}/${out.length}`);
  // 진짜 실고객 의심: 전화가 평범한 010 + 이름이 한글 실명같고 합성패턴 아님
  const realRe = /^(\+?82)?0?10\d{8}$/;
  const animalPlant = out.filter(r => !/테스트|TEST|시뮬|smoke|스모크|더미|dummy|TC|샘플|sample|검증|\[/.test(r.name||''));
  const phoneSynthSet = new Set(synthPhone.map(r=>r.id));
  const trulyAmbiguous = animalPlant.filter(r => !phoneSynthSet.has(r.id));
  console.log(`  이름이 테스트키워드 아님: ${animalPlant.length}, 그중 전화도 합성패턴 아님(진짜 모호): ${trulyAmbiguous.length}`);
  trulyAmbiguous.slice(0,40).forEach(r => console.log(`    AMBIG ${r.id.slice(0,8)} | ${r.name} | ${r.phone} | ${r.created_at?.slice(0,10)} | src=${r.lead_source}`));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
