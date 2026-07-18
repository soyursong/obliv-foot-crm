/**
 * T-20260715-foot-DOCREQ-3ITEM-CANCEL-HOTFIX — APPLY (소프트취소/회수)
 *
 * 앱의 useResolveOpinionRequest(reason:'cancelled') 경로를 서버측에서 3건에 적용.
 *   status: draft → 'voided'
 *   field_data 병합: resolved_reason='cancelled', resolved_at=<now ISO>  (기존 필드 보존)
 * WHERE 전조건 교차(정확 PK + status=draft + clinic=풋 + origin=staff_consult) — 다른 행 무접촉.
 *
 * 실행: --apply 플래그 없으면 dry-run(무영속). 있으면 UPDATE 실행.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const APPLY = process.argv.includes('--apply');
const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot
const TARGET_IDS = [
  '27b15c11-4b1c-4850-b323-371366bccd8a', // F-4574 총괄테스트중
  'b94b9b13-0752-44ac-bafb-a3a83bdacdf2', // F-4678 총*현
  '755ac489-a262-48a8-bad0-2f03142c992a', // F-4692 송지현2
];
const RESOLVED_AT = new Date().toISOString();

console.log(`MODE: ${APPLY ? 'APPLY (UPDATE 실행)' : 'DRY-RUN (무영속)'}`);
console.log(`resolved_at = ${RESOLVED_AT}\n`);

// ── 재확인: 3건이 여전히 전조건 충족 draft 인지 (freeze-set 재검증) ──
const { data: pre, error: pe } = await sb
  .from('form_submissions')
  .select('id, clinic_id, status, field_data')
  .in('id', TARGET_IDS);
if (pe) { console.error('preselect err:', pe); process.exit(1); }

const eligible = pre.filter((r) =>
  r.clinic_id === FOOT_CLINIC_ID &&
  r.status === 'draft' &&
  (r.field_data || {})['request_origin'] === 'staff_consult'
);
console.log(`freeze-set 재검증: 대상 ${TARGET_IDS.length} / 조회 ${pre.length} / 적격 draft ${eligible.length}`);
if (eligible.length !== 3) {
  console.log(`⛔ ABORT: 적격 draft ≠ 3 (누군가 이미 처리/발행했을 수 있음). 사람 재확인 필요.`);
  pre.forEach((r) => console.log(`  id=${r.id} status=${r.status} origin=${(r.field_data||{})['request_origin']} clinic=${r.clinic_id}`));
  process.exit(1);
}

const results = [];
for (const row of eligible) {
  const prev = row.field_data || {};
  const merged = { ...prev, resolved_at: RESOLVED_AT, resolved_reason: 'cancelled' };
  if (!APPLY) {
    results.push({ id: row.id, before: prev, afterPreview: merged });
    continue;
  }
  const { data: upd, error: ue } = await sb
    .from('form_submissions')
    .update({ status: 'voided', field_data: merged })
    .eq('id', row.id)
    .eq('status', 'draft')                 // 동시성 가드
    .eq('clinic_id', FOOT_CLINIC_ID)       // 전조건: 풋 clinic
    .select('id, status, field_data');     // RETURNING
  if (ue) { console.error(`UPDATE err id=${row.id}:`, ue); process.exit(1); }
  results.push({ id: row.id, affected: upd.length, after: upd[0] });
}

console.log('\n=== 결과 ===');
if (!APPLY) {
  for (const r of results) {
    console.log(`\n  id=${r.id}`);
    console.log(`   before.status=draft  resolved_reason=(none) resolved_at=(none)`);
    console.log(`   after(preview).status=voided resolved_reason=cancelled resolved_at=${RESOLVED_AT}`);
    console.log(`   after.field_data=${JSON.stringify(r.afterPreview)}`);
  }
  console.log('\n(DRY-RUN — 영속 없음. --apply 로 실행)');
} else {
  let totalAffected = 0;
  for (const r of results) {
    totalAffected += r.affected;
    const fd = r.after?.field_data || {};
    console.log(`\n  id=${r.id}  affected=${r.affected}`);
    console.log(`   after.status=${r.after?.status}`);
    console.log(`   after.resolved_reason=${fd['resolved_reason']}  resolved_at=${fd['resolved_at']}`);
    console.log(`   after.field_data=${JSON.stringify(fd)}`);
  }
  console.log('\n----------------------------------------');
  if (totalAffected === 3) console.log('✅ RETURNING affected == 3. 소프트취소 완료.');
  else { console.log(`⛔ affected == ${totalAffected} (≠3). 검토 필요.`); process.exit(1); }
}
