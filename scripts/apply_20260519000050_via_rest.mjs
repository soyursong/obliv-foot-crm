/**
 * T-20260519-foot-PENCHART-FORMS
 * form_templates 시드: personal_checklist_general / personal_checklist_senior 2종
 * 멱등: upsert — 재실행 안전
 * Supabase REST API + service_role key 경유 (직접 DB 연결 불가 환경 대응)
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const FIELD_MAP_GENERAL = [
  { key: 'name',                  label: '성명',          type: 'text',     x: 0, y: 0 },
  { key: 'phone',                 label: '연락처',        type: 'text',     x: 0, y: 0 },
  { key: 'birth_date',            label: '생년월일',      type: 'date',     x: 0, y: 0 },
  { key: 'address',               label: '주소',          type: 'text',     x: 0, y: 0 },
  { key: 'symptoms',              label: '발 증상',       type: 'checkbox', x: 0, y: 0,
    options: ['굳은살/티눈','무좀','내성발톱','발냄새','발건조/각질','당뇨발/혈액순환','기타'] },
  { key: 'symptoms_other',        label: '기타 증상',     type: 'text',     x: 0, y: 0 },
  { key: 'pain_areas',            label: '통증 부위',     type: 'checkbox', x: 0, y: 0,
    options: ['발앞꿈치','발뒤꿈치','발바닥','발등','발목'] },
  { key: 'medical_history',       label: '과거병력',      type: 'checkbox', x: 0, y: 0,
    options: ['당뇨','고혈압','심장질환','혈액순환장애','기타'] },
  { key: 'medical_history_other', label: '기타 병력',     type: 'text',     x: 0, y: 0 },
  { key: 'has_allergy',           label: '알레르기 여부', type: 'boolean',  x: 0, y: 0 },
  { key: 'allergy_detail',        label: '알레르기 내역', type: 'text',     x: 0, y: 0 },
  { key: 'agree_privacy',         label: '개인정보 동의', type: 'boolean',  x: 0, y: 0 },
  { key: 'agree_marketing',       label: '마케팅 동의',   type: 'boolean',  x: 0, y: 0 },
];

const templates = [
  {
    clinic_id:          CLINIC_ID,
    category:           'foot-service',
    form_key:           'personal_checklist_general',
    name_ko:            '개인정보+체크리스트 (일반)',
    template_path:      '',
    template_format:    'html',
    field_map:          FIELD_MAP_GENERAL,
    requires_signature: false,
    required_role:      'admin|manager|coordinator|director',
    active:             true,
    sort_order:         91,
  },
  {
    clinic_id:          CLINIC_ID,
    category:           'foot-service',
    form_key:           'personal_checklist_senior',
    name_ko:            '개인정보+체크리스트 (어르신)',
    template_path:      '',
    template_format:    'html',
    field_map:          FIELD_MAP_GENERAL, // 동일 필드 구조 — UI에서 글씨 크기만 다름
    requires_signature: false,
    required_role:      'admin|manager|coordinator|director',
    active:             true,
    sort_order:         92,
  },
];

console.log('🚀 form_templates 시드 적용 시작 (T-20260519-foot-PENCHART-FORMS)');

for (const tpl of templates) {
  const { data, error } = await supabase
    .from('form_templates')
    .upsert(tpl, { onConflict: 'clinic_id,form_key' })
    .select('id, form_key, name_ko, sort_order');

  if (error) {
    console.error(`❌ 실패 (${tpl.form_key}):`, error.message);
    process.exit(1);
  }
  console.log(`✅ 등록/갱신: ${tpl.form_key} → id=${data?.[0]?.id}`);
}

// 확인 쿼리
const { data: verify, error: verifyErr } = await supabase
  .from('form_templates')
  .select('form_key, name_ko, sort_order, template_format, active')
  .eq('clinic_id', CLINIC_ID)
  .in('form_key', ['personal_checklist_general', 'personal_checklist_senior'])
  .order('sort_order', { ascending: true });

if (verifyErr) {
  console.error('❌ 검증 실패:', verifyErr.message);
  process.exit(1);
}

console.log('\n📋 등록된 템플릿:');
verify?.forEach(r => {
  console.log(`  - ${r.form_key}: ${r.name_ko} (sort=${r.sort_order}, format=${r.template_format}, active=${r.active})`);
});

if ((verify?.length ?? 0) !== 2) {
  console.error(`❌ 예상 2행, 실제 ${verify?.length ?? 0}행`);
  process.exit(1);
}
console.log('\n✅ 검증 완료 — 2종 템플릿 정상 등록');
