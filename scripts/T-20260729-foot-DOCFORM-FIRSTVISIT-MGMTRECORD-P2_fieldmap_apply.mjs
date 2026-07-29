// T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2 — 초진 관리기록지 form_templates.field_map 정리 UPDATE.
//   Phase 2 7건 개편 중 자유텍스트 field_map 정리분(항목②③ 제거: nail_status·other_check·care_other_text·care_plan).
//   ADDITIVE/데이터 UPDATE only(무DDL). BEFORE/AFTER evidence 출력. 멱등(동일 field_map 재실행 no-op).
//   base seed row = T-20260728 (id 05d7416f-...). 신규/삭제 컬럼·테이블·enum 없음 → db_change:false 유지.
//   dry-run:  node scripts/T-20260729-...P2_fieldmap_apply.mjs          (기본 = 무영속, 실 write 없음)
//   apply:    node scripts/T-20260729-...P2_fieldmap_apply.mjs --apply  (실 UPDATE — supervisor QA GO 후에만)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || (() => { throw new Error('VITE_SUPABASE_URL required'); })();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY required'); })();
const APPLY = process.argv.includes('--apply');

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const FORM_KEY = 'first_visit_mgmt_record';

// 정리된 field_map (11 entry) — 제거: nail_status·other_check·care_other_text·care_plan.
const NEW_FIELD_MAP = [
  { key: 'patient_name', label: '성명', type: 'text', x: 0, y: 0 },
  { key: 'patient_birthdate', label: '생년월일', type: 'text', x: 0, y: 0 },
  { key: 'patient_phone', label: '연락처', type: 'text', x: 0, y: 0 },
  { key: 'visit_date', label: '초진일', type: 'date', x: 0, y: 0 },
  { key: 'vp_other_text', label: '방문목적 기타', type: 'text', x: 0, y: 0 },
  { key: 'symptom_history', label: '증상 발생 경위', type: 'multiline', x: 0, y: 0, w: 400, h: 60 },
  { key: 'skin_status', label: '피부 상태', type: 'multiline', x: 0, y: 0, w: 400, h: 40 },
  { key: 'remarks', label: '특이사항', type: 'multiline', x: 0, y: 0, w: 400, h: 60 },
  { key: 'issue_date', label: '발급일', type: 'date', x: 0, y: 0 },
  { key: 'clinic_name', label: '센터명', type: 'text', x: 0, y: 0 },
  { key: 'doctor_name', label: '담당자', type: 'text', x: 0, y: 0 },
];

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: before, error: e1 } = await sb
  .from('form_templates')
  .select('id, form_key, field_map')
  .eq('clinic_id', CLINIC_ID)
  .eq('form_key', FORM_KEY);
if (e1) { console.error('SELECT error:', e1.message); process.exit(1); }

console.log(`[BEFORE] matched rows = ${before?.length ?? 0}`);
for (const r of before ?? []) {
  const keys = (r.field_map ?? []).map((f) => f.key);
  console.log(`  id=${r.id} field_map(${keys.length}) = ${keys.join(', ')}`);
}

if (!APPLY) {
  console.log('[DRY-RUN] 무영속 — 실 UPDATE 미실행. --apply 로 반영(QA GO 후).');
  const target = (before ?? [])[0];
  if (target) {
    const cur = (target.field_map ?? []).map((f) => f.key);
    const willRemove = cur.filter((k) => !NEW_FIELD_MAP.some((n) => n.key === k));
    console.log(`[DRY-RUN] 제거 예정 키: ${willRemove.join(', ') || '(없음 — 이미 정리됨/멱등 no-op)'}`);
    console.log(`[DRY-RUN] 결과 field_map(${NEW_FIELD_MAP.length}) = ${NEW_FIELD_MAP.map((f) => f.key).join(', ')}`);
  }
  process.exit(0);
}

const { data: after, error: e2 } = await sb
  .from('form_templates')
  .update({ field_map: NEW_FIELD_MAP })
  .eq('clinic_id', CLINIC_ID)
  .eq('form_key', FORM_KEY)
  .select('id, field_map');
if (e2) { console.error('UPDATE error:', e2.message); process.exit(1); }
console.log(`[APPLY] updated rows = ${after?.length ?? 0}`);
for (const r of after ?? []) {
  const keys = (r.field_map ?? []).map((f) => f.key);
  console.log(`  id=${r.id} field_map(${keys.length}) = ${keys.join(', ')}`);
}
console.log('[APPLY] 완료 — 재실행 시 no-op(멱등).');
