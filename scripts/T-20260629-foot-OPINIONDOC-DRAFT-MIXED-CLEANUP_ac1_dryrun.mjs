/**
 * T-20260629-foot-OPINIONDOC-DRAFT-MIXED-CLEANUP — AC-1 정규화 dry-run (READ-ONLY)
 *
 * 부모(read-only audit) T-20260629-foot-OPINIONDOC-PREFILL-EXCLUSIVE-GUARD AC-3 결과:
 *   form_submissions status='draft' 중 진단서+금기증 혼합 = 총 1건(jongno-foot, id ff9fd4ad…).
 *
 * 본 스크립트는 그 혼합행을 부모 AC-1 `applyPrefillExclusivity` 와 **동일 규칙**으로 정규화했을 때의
 *   before→after diff 를 산출·보고한다. ⚠ UPDATE/DELETE 일절 미실행(READ-ONLY).
 *   실제 mutation 은 supervisor `mutation_gate` GO 후 _ac2_apply.sql 로만(범위 외).
 *
 * 정규화 규칙(부모 SSOT opinionDocCompose.applyPrefillExclusivity 미러):
 *   - 혼합(진단서≥1 AND 금기증≥1):
 *       · doc_type='diagnosis'(진단서) → 진단서 그룹 유지(단일배타 → 첫 1개), 금기증 clear.
 *       · 그 외(opinion/소견서/doc_type 미지정 레거시) → 금기증 그룹 유지(복수), 진단서 clear.
 *   - 진단서 단독 ≥2 → 첫 1개(단일배타). 금기증 단독 → 복수 그대로(무변경).
 *
 * 범위 가드(AC-1): 혼합 매칭이 1건을 초과하면 즉시 보고 후 중단(범위 변동 → planner 재판정).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 부모 AC-3 audit 스크립트와 동일 SSOT 키 집합 (OPINION_SECTIONS 미러).
const DIAGNOSIS_KEYS = new Set(['oral_o', 'oral_x', 'after_1m', 'medical_staff']);
const CONTRAIND_KEYS = new Set([
  'gi_disorder', 'oral_ineffective', 'gi_after_oral', 'hbv_carrier', 'diabetes',
  'bp_med', 'hyperlipidemia', 'cardio_med', 'liver_disease', 'liver_func_abnormal',
  'liver_func_test_abnormal', 'regular_drinking', 'kidney_disease', 'gout_med',
  'thyroid_med', 'psychiatric_med', 'male_hairloss_med', 'female_hairloss_med',
  'on_chemo', 'post_chemo_followup', 'preparing_pregnancy', 'pregnant', 'breastfeeding',
  'elderly', 'pediatric', 'driver', 'pilot', 'immune_disease',
]);

const keysOf = (fd) => {
  const k = fd?.selected_keys ?? fd?.selected_option_keys ?? [];
  return Array.isArray(k) ? k.map(String) : [];
};

// opinionDocCompose.classifySelection 미러.
function classify(keys) {
  const diagnosisKeys = [], contraindKeys = [];
  for (const k of keys) (CONTRAIND_KEYS.has(k) ? contraindKeys : diagnosisKeys).push(k);
  return { diagnosisKeys, contraindKeys };
}

// opinionDocCompose.applyPrefillExclusivity 미러 (preferDocType: 'diagnosis' | 'opinion' | null).
function applyPrefillExclusivity(keys, preferDocType) {
  const { diagnosisKeys, contraindKeys } = classify(keys);
  const mixed = diagnosisKeys.length > 0 && contraindKeys.length > 0;
  if (mixed) return preferDocType === 'diagnosis' ? diagnosisKeys.slice(0, 1) : contraindKeys;
  if (diagnosisKeys.length > 0) return diagnosisKeys.slice(0, 1);
  return contraindKeys;
}

// draft 전수 read-only 조회 → 혼합행 탐지(부모 audit 와 동일 판정).
const { data: subs, error } = await sb
  .from('form_submissions')
  .select('id, clinic_id, template_id, status, field_data, created_at')
  .eq('status', 'draft');
if (error) { console.error('form_submissions ERROR:', JSON.stringify(error)); process.exit(1); }

const clinicsRes = await sb.from('clinics').select('id, slug, name');
const clinicMap = {};
(clinicsRes.data || []).forEach((c) => { clinicMap[c.id] = c; });

const mixed = [];
for (const s of subs || []) {
  const keys = keysOf(s.field_data);
  const hasDiag = keys.some((k) => DIAGNOSIS_KEYS.has(k));
  const hasContra = keys.some((k) => CONTRAIND_KEYS.has(k));
  if (hasDiag && hasContra) {
    const slug = (clinicMap[s.clinic_id] || {}).slug ?? '(unknown)';
    const docTypeRaw = s.field_data?.doc_type ?? null;
    const preferDocType = docTypeRaw === 'diagnosis' ? 'diagnosis' : 'opinion';
    const before = keys;
    const after = applyPrefillExclusivity(keys, preferDocType);
    mixed.push({
      id: s.id, slug, created_at: s.created_at,
      doc_type_raw: docTypeRaw, preferDocType,
      before, after,
      removed: before.filter((k) => !after.includes(k)),
      kept: after,
    });
  }
}

console.log('======== AC-1 정규화 dry-run (READ-ONLY · UPDATE 미실행) ========');
console.log(`혼합(진단서+금기증) draft 매칭 건수 : ${mixed.length}`);

// ── AC-1 범위 가드: 1건 초과 시 즉시 중단·보고(범위 변동 → planner 재판정) ──
if (mixed.length > 1) {
  console.error('\n⛔ ABORT — 혼합 매칭이 1건을 초과(범위 변동). 부모 audit(1건)와 불일치 → planner 재판정 필요.');
  for (const m of mixed) console.error(`  ${m.id} | ${m.slug} | before=[${m.before.join(', ')}] → after=[${m.after.join(', ')}]`);
  process.exit(2);
}
if (mixed.length === 0) {
  console.log('\n✅ 혼합행 0건 — 이미 정리되었거나 대상 부재. mutation 불요. (멱등)');
  process.exit(0);
}

const m = mixed[0];
console.log('\n--- 대상 1건 정규화 diff (before → after) ---');
console.log(`id          : ${m.id}`);
console.log(`clinic      : ${m.slug}`);
console.log(`created_at  : ${m.created_at}`);
console.log(`doc_type    : ${m.doc_type_raw ?? '(미지정 레거시)'} → preferDocType=${m.preferDocType} (${m.preferDocType === 'diagnosis' ? '진단서 우선' : '금기증 우선'})`);
console.log(`before keys : [${m.before.join(', ')}]`);
console.log(`after  keys : [${m.kept.join(', ')}]`);
console.log(`clear(제거) : [${m.removed.join(', ')}]`);

// 결과 불변식 재확인 — after 에 진단서·금기증 동시 존재 불가.
const ac = classify(m.after);
const stillMixed = ac.diagnosisKeys.length > 0 && ac.contraindKeys.length > 0;
console.log(`\n불변식 검증 : after 혼합? ${stillMixed ? '❌ FAIL' : '✅ PASS (진단서·금기증 동시선택 없음)'}`);

console.log('\n--- backup / rollback 근거(원본 보존) ---');
console.log(`ROLLBACK selected_keys (원본) : ${JSON.stringify(m.before)}`);
console.log(`APPLY    selected_keys (정규화): ${JSON.stringify(m.after)}`);
console.log('\n⚠ READ-ONLY 완료 — 데이터 변경 0건. 실제 UPDATE 는 supervisor mutation_gate GO 후 _ac2_apply.sql 로만 실행.');
