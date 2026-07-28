// T-20260728-foot-DOCFORM-FIRSTVISIT-MGMTRECORD — 초진 관리기록지 form_templates ADDITIVE seed.
// 멱등 apply(+dry-run) 러너. ADDITIVE only(무DDL). BEFORE/AFTER evidence 출력.
//   dry-run:  node scripts/T-20260728-..._seed_apply.mjs          (기본 = 무영속 점검)
//   apply:    node scripts/T-20260728-..._seed_apply.mjs --apply  (실 INSERT)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || (() => { throw new Error('VITE_SUPABASE_URL required'); })();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY required'); })();
const APPLY = process.argv.includes('--apply');

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const FORM_KEY = 'first_visit_mgmt_record';

const ROW = {
  clinic_id: CLINIC_ID,
  category: 'foot-service',
  form_key: FORM_KEY,
  name_ko: '초진 관리기록지',
  template_path: '',
  template_format: 'html',
  field_map: [
    { key: 'patient_name', label: '성명', type: 'text', x: 0, y: 0 },
    { key: 'patient_birthdate', label: '생년월일', type: 'text', x: 0, y: 0 },
    { key: 'patient_phone', label: '연락처', type: 'text', x: 0, y: 0 },
    { key: 'visit_date', label: '초진일', type: 'date', x: 0, y: 0 },
    { key: 'vp_other_text', label: '방문목적 기타', type: 'text', x: 0, y: 0 },
    { key: 'symptom_history', label: '증상 발생 경위', type: 'multiline', x: 0, y: 0, w: 400, h: 60 },
    { key: 'nail_status', label: '발톱 상태', type: 'multiline', x: 0, y: 0, w: 400, h: 40 },
    { key: 'skin_status', label: '피부 상태', type: 'multiline', x: 0, y: 0, w: 400, h: 40 },
    { key: 'other_check', label: '기타 확인 사항', type: 'multiline', x: 0, y: 0, w: 400, h: 40 },
    { key: 'care_other_text', label: '초기관리 기타', type: 'text', x: 0, y: 0 },
    { key: 'care_plan', label: '관리 계획', type: 'multiline', x: 0, y: 0, w: 400, h: 60 },
    { key: 'remarks', label: '특이사항', type: 'multiline', x: 0, y: 0, w: 400, h: 60 },
    { key: 'issue_date', label: '발급일', type: 'date', x: 0, y: 0 },
    { key: 'clinic_name', label: '센터명', type: 'text', x: 0, y: 0 },
    { key: 'doctor_name', label: '담당자', type: 'text', x: 0, y: 0 },
  ],
  requires_signature: false,
  required_role: 'admin|manager|coordinator|therapist',
  active: true,
  sort_order: 130,
};

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: before, error: e1 } = await sb
  .from('form_templates').select('id, form_key, active, sort_order')
  .eq('clinic_id', CLINIC_ID).eq('form_key', FORM_KEY);
if (e1) { console.error('BEFORE read error:', e1.message); process.exit(1); }
console.log(`[BEFORE] ${FORM_KEY} row count = ${before.length}`);

if (before.length > 0) {
  console.log('[IDEMPOTENT] already exists → no-op.', JSON.stringify(before[0]));
  process.exit(0);
}
if (!APPLY) {
  console.log('[DRY-RUN] would INSERT 1 ADDITIVE row (no persistence). Re-run with --apply.');
  process.exit(0);
}

const { data: ins, error: e2 } = await sb.from('form_templates').insert(ROW).select('id, form_key, active, sort_order');
if (e2) { console.error('INSERT error:', e2.message); process.exit(1); }
console.log('[APPLIED] inserted:', JSON.stringify(ins));

const { data: after } = await sb
  .from('form_templates').select('id, form_key, active, sort_order')
  .eq('clinic_id', CLINIC_ID).eq('form_key', FORM_KEY);
console.log(`[AFTER] ${FORM_KEY} row count = ${after.length}`, JSON.stringify(after));
console.log(after.length === 1 ? '[VERIFY OK] exactly 1 row' : '[VERIFY FAIL]');
