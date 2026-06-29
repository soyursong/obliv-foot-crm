/**
 * T-20260525-foot-INS-FIELD-BIND
 * ins_claim_form form_templates 행 삽입 + field_map 완전성 보장
 *
 * 전제: 20260522040000_ins_doc_form_templates.sql 미적용 상태 (행 없음)
 * 작업:
 *   1. category CHECK constraint에 'insurance' 추가 (Management API SQL)
 *   2. form_templates ins_claim_form 행 UPSERT
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const CLINIC_ID    = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const PROJ_REF     = 'rxlomoozakkjesdqjtvd';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const FIELD_MAP = [
  { key: 'patient_name',           label: '환자성명',     type: 'text',   x: 0, y: 0 },
  { key: 'patient_rrn',            label: '주민등록번호', type: 'text',   x: 0, y: 0 },
  { key: 'patient_phone',          label: '연락처',       type: 'text',   x: 0, y: 0 },
  { key: 'patient_address',        label: '주소',         type: 'text',   x: 0, y: 0 },
  { key: 'insurance_grade_label',  label: '건보 등급',    type: 'text',   x: 0, y: 0 },
  { key: 'copay_rate',             label: '본인부담률',   type: 'text',   x: 0, y: 0 },
  { key: 'special_treatment_code', label: '산정특례코드', type: 'text',   x: 0, y: 0 },
  { key: 'diag_code_1',            label: '주상병코드',   type: 'text',   x: 0, y: 0 },
  { key: 'diag_name_1',            label: '주상병명',     type: 'text',   x: 0, y: 0 },
  { key: 'diag_code_2',            label: '부상병코드',   type: 'text',   x: 0, y: 0 },
  { key: 'diag_name_2',            label: '부상병명',     type: 'text',   x: 0, y: 0 },
  { key: 'visit_date',             label: '진료일',       type: 'date',   x: 0, y: 0 },
  { key: 'total_amount',           label: '진료비합계',   type: 'amount', x: 0, y: 0 },
  { key: 'insurance_covered',      label: '공단부담금',   type: 'amount', x: 0, y: 0 },
  { key: 'copayment',              label: '본인부담금',   type: 'amount', x: 0, y: 0 },
  { key: 'non_covered',            label: '비급여',       type: 'amount', x: 0, y: 0 },
  { key: 'issue_date',             label: '발행일',       type: 'date',   x: 0, y: 0 },
  { key: 'clinic_name',            label: '의료기관명',   type: 'text',   x: 0, y: 0 },
  { key: 'clinic_phone',           label: '전화번호',     type: 'text',   x: 0, y: 0 },
  { key: 'doctor_name',            label: '담당의사',     type: 'text',   x: 0, y: 0 },
];

console.log('🚀 ins_claim_form 보험청구서 form_templates 적용 (T-20260525-foot-INS-FIELD-BIND)');

// Step 1: category CHECK constraint 확장 via Management API
const CONSTRAINT_SQL = `
DO $c$
BEGIN
  -- category CHECK가 'insurance'를 포함하지 않으면 확장
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'form_templates_category_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%insurance%'
  ) THEN
    ALTER TABLE form_templates DROP CONSTRAINT form_templates_category_check;
    ALTER TABLE form_templates
      ADD CONSTRAINT form_templates_category_check
        CHECK (category IN ('foot-service', 'dosu-center', 'insurance'));
    RAISE NOTICE 'category CHECK 확장 완료 (insurance 추가)';
  ELSE
    RAISE NOTICE 'category CHECK 이미 insurance 포함 — skip';
  END IF;
END
$c$;
`;

console.log('Step 1: category CHECK constraint 확장...');
const mgmtResp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: CONSTRAINT_SQL }),
});

if (!mgmtResp.ok) {
  const text = await mgmtResp.text();
  console.warn(`⚠️  Management API ${mgmtResp.status}: ${text}`);
  console.log('→ Management API 실패. RPC 경로 fallback 시도...');

  // Fallback: rpc exec_sql if exists
  const { error: rpcErr } = await supabase.rpc('exec_sql', { sql: CONSTRAINT_SQL });
  if (rpcErr) {
    console.error('❌ RPC fallback도 실패:', rpcErr.message);
    console.log('\n수동으로 Supabase SQL Editor에서 아래 SQL 실행 필요:');
    console.log(CONSTRAINT_SQL);
    console.log('\n계속 진행 시도 (constraint 이미 확장된 경우)...');
  }
} else {
  const body = await mgmtResp.json();
  console.log('✅ Management API SQL 실행:', JSON.stringify(body).slice(0, 200));
}

// Step 2: form_templates UPSERT (direct SQL via Management API)
const UPSERT_SQL = `
INSERT INTO form_templates (
  clinic_id, category, form_key, name_ko, template_path, template_format,
  field_map, requires_signature, required_role, active, sort_order
) VALUES (
  '74967aea-a60b-4da3-a0e7-9c997a930bc8',
  'insurance',
  'ins_claim_form',
  '보험청구서',
  '',
  'html',
  '[
    {"key":"patient_name","label":"환자성명","type":"text","x":0,"y":0},
    {"key":"patient_rrn","label":"주민등록번호","type":"text","x":0,"y":0},
    {"key":"patient_phone","label":"연락처","type":"text","x":0,"y":0},
    {"key":"patient_address","label":"주소","type":"text","x":0,"y":0},
    {"key":"insurance_grade_label","label":"건보 등급","type":"text","x":0,"y":0},
    {"key":"copay_rate","label":"본인부담률","type":"text","x":0,"y":0},
    {"key":"special_treatment_code","label":"산정특례코드","type":"text","x":0,"y":0},
    {"key":"diag_code_1","label":"주상병코드","type":"text","x":0,"y":0},
    {"key":"diag_name_1","label":"주상병명","type":"text","x":0,"y":0},
    {"key":"diag_code_2","label":"부상병코드","type":"text","x":0,"y":0},
    {"key":"diag_name_2","label":"부상병명","type":"text","x":0,"y":0},
    {"key":"visit_date","label":"진료일","type":"date","x":0,"y":0},
    {"key":"total_amount","label":"진료비합계","type":"amount","x":0,"y":0},
    {"key":"insurance_covered","label":"공단부담금","type":"amount","x":0,"y":0},
    {"key":"copayment","label":"본인부담금","type":"amount","x":0,"y":0},
    {"key":"non_covered","label":"비급여","type":"amount","x":0,"y":0},
    {"key":"issue_date","label":"발행일","type":"date","x":0,"y":0},
    {"key":"clinic_name","label":"의료기관명","type":"text","x":0,"y":0},
    {"key":"clinic_phone","label":"전화번호","type":"text","x":0,"y":0},
    {"key":"doctor_name","label":"담당의사","type":"text","x":0,"y":0}
  ]'::jsonb,
  false,
  'admin|manager|director|consultant|coordinator',
  true,
  10
)
ON CONFLICT (clinic_id, form_key)
DO UPDATE SET
  field_map        = EXCLUDED.field_map,
  template_format  = EXCLUDED.template_format,
  required_role    = EXCLUDED.required_role,
  active           = EXCLUDED.active,
  sort_order       = EXCLUDED.sort_order;
`;

console.log('Step 2: ins_claim_form UPSERT...');
const upsertResp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: UPSERT_SQL }),
});

if (!upsertResp.ok) {
  const text = await upsertResp.text();
  console.error('❌ UPSERT Management API 실패:', upsertResp.status, text);
  console.log('\n수동으로 Supabase SQL Editor에서 아래 SQL 실행 필요:');
  console.log(UPSERT_SQL);
  process.exit(1);
}

const upsertBody = await upsertResp.json();
console.log('✅ UPSERT 실행:', JSON.stringify(upsertBody).slice(0, 200));

// Step 3: 결과 검증 (Supabase client)
const { data: after, error: afterErr } = await supabase
  .from('form_templates')
  .select('id, form_key, field_map, required_role')
  .eq('clinic_id', CLINIC_ID)
  .eq('form_key', 'ins_claim_form')
  .maybeSingle();

if (afterErr || !after) {
  console.error('❌ 검증 실패:', afterErr?.message ?? 'row not found');
  console.log('→ form_templates 직접 확인 필요');
  process.exit(1);
}

const afterKeys = (after.field_map ?? []).map(f => f.key);
console.log('\n📊 적용 후 결과:');
console.log('   field_map 키 수:', afterKeys.length, '(expected 21)');
console.log('   patient_rrn     :', afterKeys.includes('patient_rrn')    ? '✅ PASS' : '❌ FAIL');
console.log('   patient_address :', afterKeys.includes('patient_address') ? '✅ PASS' : '❌ FAIL');
console.log('   diag_code_1     :', afterKeys.includes('diag_code_1')    ? '✅ PASS' : '❌ FAIL');
console.log('   diag_name_1     :', afterKeys.includes('diag_name_1')    ? '✅ PASS' : '❌ FAIL');
console.log('   diag_code_2     :', afterKeys.includes('diag_code_2')    ? '✅ PASS' : '❌ FAIL');
console.log('   diag_name_2     :', afterKeys.includes('diag_name_2')    ? '✅ PASS' : '❌ FAIL');
console.log('   required_role   :', after.required_role);

const allPass = ['patient_rrn','patient_address','diag_code_1','diag_name_1','diag_code_2','diag_name_2']
  .every(k => afterKeys.includes(k));

if (!allPass) {
  console.error('\n❌ 필수 키 누락');
  process.exit(1);
}

console.log('\n🎉 20260525060000_ins_claim_form_field_bind_fix 완료');
console.log('   AC-1 ✅ diag_code/diag_name 바인딩');
console.log('   AC-2 ✅ patient_rrn / patient_address 바인딩');
console.log('   AC-3 ✅ form_templates DB 동기화');
