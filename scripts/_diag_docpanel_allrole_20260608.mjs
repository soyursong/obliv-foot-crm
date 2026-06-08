/**
 * AC-0 선행 진단 (T-20260608-foot-DOCPANEL-ALLROLE-PRINT) — READ-ONLY
 * 목표: coordinator 서류발행 패널 5종 "비활성" 실제 메커니즘 확인.
 *   (a) DB form_templates의 form_key가 코드 ALL_ROLE_PRINT_FORM_KEYS와 불일치 → canAccess false (role 필터)
 *   (b) form_key 일치하나 required_role admin|manager 라 fallback 대비 확인
 * 절대 write 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ALL_ROLE_PRINT_FORM_KEYS = ['diag_opinion', 'prescription', 'diagnosis', 'payment_cert', 'referral_letter'];
const TARGET_NAMES = ['소견서', '처방전', '진단서', '진료비납입증명서', '진료비 납입증명서', '진료의뢰서'];

console.log('=== form_templates 전수 (foot-service + insurance, active) ===');
const { data: tpls, error } = await sb
  .from('form_templates')
  .select('id, clinic_id, category, form_key, name_ko, required_role, active')
  .in('category', ['foot-service', 'insurance'])
  .order('clinic_id')
  .order('sort_order');

if (error) { console.error('query err', error); process.exit(1); }
console.log(`총 ${tpls.length}행`);

// clinic별 그룹
const byClinic = {};
for (const t of tpls) (byClinic[t.clinic_id] ??= []).push(t);

for (const [clinic, rows] of Object.entries(byClinic)) {
  console.log(`\n──── clinic_id=${clinic} (${rows.length}행) ────`);
  for (const t of rows) {
    const inAllRole = ALL_ROLE_PRINT_FORM_KEYS.includes(t.form_key);
    const allowed = (t.required_role ?? '').split('|');
    const coordOk = inAllRole || allowed.includes('coordinator');
    const isTarget = TARGET_NAMES.some(n => (t.name_ko ?? '').includes(n.replace(/\s/g, '')) || (t.name_ko ?? '').replace(/\s/g, '').includes(n.replace(/\s/g, '')));
    const flag = isTarget ? (coordOk ? '✅coord가능' : '❌coord차단') : '';
    console.log(`  ${t.active ? 'A' : '-'} [${t.category}] key=${t.form_key.padEnd(22)} role=${(t.required_role ?? '').padEnd(28)} ${t.name_ko}  ${inAllRole ? '(ALL_ROLE매칭)' : ''} ${flag}`);
  }
}

console.log('\n=== 핵심 판정: 5종 타겟 서류의 DB form_key vs 코드 ALL_ROLE_PRINT_FORM_KEYS ===');
console.log('코드 ALL_ROLE_PRINT_FORM_KEYS:', ALL_ROLE_PRINT_FORM_KEYS.join(', '));
const targetRows = tpls.filter(t => TARGET_NAMES.some(n => (t.name_ko ?? '').replace(/\s/g, '').includes(n.replace(/\s/g, ''))));
console.log(`\n타겟명 매칭 DB행 ${targetRows.length}개:`);
const mismatched = [];
for (const t of targetRows) {
  const matched = ALL_ROLE_PRINT_FORM_KEYS.includes(t.form_key);
  if (!matched) mismatched.push(t);
  console.log(`  name="${t.name_ko}" key=${t.form_key} role=${t.required_role} → ALL_ROLE매칭=${matched ? 'YES' : 'NO ⚠️'}`);
}
console.log(`\n>>> 불일치(코드 수정이 안 닿는) form_key: ${mismatched.length}개`);
mismatched.forEach(t => console.log(`    ⚠️ "${t.name_ko}" 의 실제 form_key=${t.form_key} (코드엔 없음) → coordinator canAccess=false 유지`));
if (mismatched.length === 0) console.log('    (없음 — DB form_key가 코드와 모두 일치. 비활성 원인은 배포 미반영/캐시 또는 다른 게이트)');
