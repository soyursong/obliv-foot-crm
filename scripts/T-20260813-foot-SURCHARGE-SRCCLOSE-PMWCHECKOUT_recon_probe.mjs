// T-20260813-foot-SURCHARGE-SRCCLOSE-PMWCHECKOUT — RECON READ-ONLY prod probe
// AUTH CONTEXT: service_role (RLS bypass) — cross_crm_diag_auth_context_standard 준수: SELECT only.
// ⛔ READ-ONLY: SELECT only. write/update/delete/upsert 0 (write 0 until supervisor GO-token).
//   목적(DA CONSULT-REPLY 3축 recon):
//     [Q3/edition] clinics.hira_unit_value / _year 실측 — 89.40 stale snapshot 잔존 여부.
//     [Q1/eligibility] services 급여 진찰료-adjacent 행 hira_category vs service_code vs hira_score 키잉 축 census.
//     [★외래관리료] hira_category='consultation' 태깅 행 중 외래관리료 별도 line-item 실재 여부(별건 track 입력).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('MISSING url/service_role key'); process.exit(2); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const out = (t, v) => console.log(`\n=== ${t} ===\n` + JSON.stringify(v, null, 2));

// [Q3] edition window — clinics 환산지수 실측
{
  const { data, error } = await sb
    .from('clinics')
    .select('id, name, hira_unit_value, hira_unit_value_year');
  out('Q3 clinics.hira_unit_value (89.40 stale check)', error ? { error: error.message } : data);
}

// [Q1] eligibility keying axis — 급여 진찰료-adjacent 후보 census
{
  const { data, error } = await sb
    .from('services')
    .select('id, name, service_code, hira_code, hira_category, hira_score, is_insurance_covered, price')
    .or('hira_category.eq.consultation,service_code.in.(AA154,AA254,AA222),name.ilike.%진찰%,name.ilike.%외래관리%,name.ilike.%관리료%');
  out('Q1 진찰료/외래관리료 후보 services (키잉 3축 대조)', error ? { error: error.message } : data);
}

// [Q1b] hira_category 분포 census — enum 적재율(§30 NULL-proof 근거)
{
  const { data, error } = await sb
    .from('services')
    .select('hira_category, is_insurance_covered')
    .eq('is_insurance_covered', true);
  if (error) { out('Q1b hira_category 분포', { error: error.message }); }
  else {
    const dist = {};
    for (const r of data) { const k = r.hira_category ?? '__NULL__'; dist[k] = (dist[k] ?? 0) + 1; }
    out('Q1b 급여 services hira_category 분포 (NULL 적재율)', { total: data.length, dist });
  }
}
console.log('\n[RECON DONE] READ-ONLY — write 0.');
