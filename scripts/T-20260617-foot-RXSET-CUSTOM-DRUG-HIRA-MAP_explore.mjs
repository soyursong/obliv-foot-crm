/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — explore (READ-ONLY)
 * §9.1 이름 완전일치 재실행 사전 탐색: 컬럼/분류값/19 custom·499 official 원본 덤프.
 * *** SELECT only ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== explore ' + new Date().toISOString() + ' ===\n');
  // 1) 컬럼 전부 (1행)
  const { data: sample, error: e0 } = await sb.from('prescription_codes').select('*').limit(1);
  if (e0) { console.error(e0); process.exit(1); }
  console.log('COLUMNS:', Object.keys(sample[0] || {}).join(', '), '\n');

  const { data: all } = await sb.from('prescription_codes')
    .select('id,name_ko,claim_code,classification,code_source');
  const custom = all.filter((r) => r.code_source === 'custom');
  const official = all.filter((r) => r.code_source === 'official');
  console.log(`COUNT: custom=${custom.length} official=${official.length} total=${all.length}\n`);

  // 2) classification distinct (급여/비급여 후보)
  const clsVals = {};
  all.forEach((r) => { const k = String(r.classification); clsVals[k] = (clsVals[k] || 0) + 1; });
  console.log('classification distinct(전체):', JSON.stringify(clsVals), '\n');
  const clsOff = {};
  official.forEach((r) => { const k = String(r.classification); clsOff[k] = (clsOff[k] || 0) + 1; });
  console.log('classification distinct(official):', JSON.stringify(clsOff), '\n');

  // 3) custom 19 원본 덤프
  console.log('--- CUSTOM 19 ---');
  custom.forEach((r, i) => console.log(`${i + 1}. "${r.name_ko}" | claim=${r.claim_code} | cls=${r.classification}`));

  // 4) official 명칭 일부 + 길이
  console.log('\n--- OFFICIAL sample(20) ---');
  official.slice(0, 20).forEach((r) => console.log(`  "${r.name_ko}" | claim=${r.claim_code} | cls=${r.classification}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
