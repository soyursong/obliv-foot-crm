/**
 * T-20260723-foot-HIRA-SCORE-M0111-LOAD — read-only PROBE (변경 없음)
 * 확인: (1) 타깃 freeze 3중조건(id+code+active) (2) 현재 hira_score(=NULL 예상, 롤백값)
 *       (3) clinics.hira_unit_value=95.60 정합 (4) DA-CONSULT 74967aea 오류 확인(=jongno)
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

console.log('=== 1) services column check (hira_score 존재) ===');
console.log(JSON.stringify(await q(`
  SELECT column_name, data_type, numeric_precision, numeric_scale
  FROM information_schema.columns
  WHERE table_name='services' AND column_name IN ('hira_score','service_code','is_insurance_covered','active','clinic_id')
  ORDER BY column_name;
`), null, 2));

console.log('\n=== 2) TARGET freeze (id 03189fa2) ===');
console.log(JSON.stringify(await q(`
  SELECT id, service_code, name, hira_score, is_insurance_covered, active, clinic_id
  FROM services WHERE id = '03189fa2-0536-4676-bc5d-ad5283a48a0c';
`), null, 2));

console.log('\n=== 3) DA-CONSULT 오류후보 74967aea (=jongno?) ===');
console.log(JSON.stringify(await q(`
  SELECT id, service_code, name, hira_score, active, clinic_id
  FROM services WHERE id::text LIKE '74967aea%';
`), null, 2));

console.log('\n=== 4) 모든 M0111 code 행 (혼선 방지) ===');
console.log(JSON.stringify(await q(`
  SELECT s.id, s.service_code, s.name, s.hira_score, s.is_insurance_covered, s.active, s.clinic_id, c.slug AS clinic_slug
  FROM services s LEFT JOIN clinics c ON c.id = s.clinic_id
  WHERE s.service_code = 'M0111' ORDER BY s.active DESC;
`), null, 2));

console.log('\n=== 5) clinics.hira_unit_value 정합 (95.60 기대) ===');
console.log(JSON.stringify(await q(`
  SELECT id, slug, name, hira_unit_value FROM clinics ORDER BY slug;
`), null, 2));
