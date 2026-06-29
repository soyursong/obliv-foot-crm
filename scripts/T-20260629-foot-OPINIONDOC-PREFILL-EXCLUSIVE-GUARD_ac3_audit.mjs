/**
 * T-20260629-foot-OPINIONDOC-PREFILL-EXCLUSIVE-GUARD — AC-3 오염건 audit (READ-ONLY)
 *
 * form_submissions status='draft'(서류요청 큐) 중 field_data.selected_keys 에
 * 진단서(단일배타) + 금기증(복수) 키가 혼합된 '오염건' 건수를 SELECT 로만 조회·보고.
 *
 * ⚠ READ-ONLY — 어떤 UPDATE/DELETE/clear 도 하지 않음. 실제 정리는 본 티켓 범위 밖
 *   (dry-run + 건수보고 + supervisor 게이트 별도 절차).
 *
 * 진단서 그룹 = OPINION_SECTIONS '진단서' 섹션 키 / 금기증 그룹 = '금기증' 섹션 키.
 *   판정: selected_keys 에 진단서 키 ≥1 AND 금기증 키 ≥1 → 혼합(오염).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// OPINION_SECTIONS 미러 (OpinionDocTab.tsx) — 진단서/금기증 그룹 키.
const DIAGNOSIS_KEYS = new Set(['oral_o', 'oral_x', 'after_1m', 'medical_staff']);
const CONTRAIND_KEYS = new Set([
  'gi_disorder', 'oral_ineffective', 'gi_after_oral', 'hbv_carrier', 'diabetes',
  'bp_med', 'hyperlipidemia', 'cardio_med', 'liver_disease', 'liver_func_abnormal',
  'liver_func_test_abnormal', 'regular_drinking', 'kidney_disease', 'gout_med',
  'thyroid_med', 'psychiatric_med', 'male_hairloss_med', 'female_hairloss_med',
  'on_chemo', 'post_chemo_followup', 'preparing_pregnancy', 'pregnant', 'breastfeeding',
  'elderly', 'pediatric', 'driver', 'pilot', 'immune_disease',
]);

// opinion_doc 템플릿 id 집합(서류요청 큐만 한정). 없으면 전체 draft 에서 selected_keys 기준으로만 판정.
const { data: tpls, error: tplErr } = await sb
  .from('form_templates')
  .select('id, clinic_id')
  .eq('form_key', 'opinion_doc');
if (tplErr) { console.error('form_templates ERROR:', JSON.stringify(tplErr)); process.exit(1); }
const opinionTplIds = new Set((tpls || []).map((t) => t.id));

// draft form_submissions 전수 조회(read-only). selected_keys 위치: field_data.selected_keys (요청 생성 시).
const { data: subs, error: subErr } = await sb
  .from('form_submissions')
  .select('id, clinic_id, template_id, status, field_data, created_at')
  .eq('status', 'draft');
if (subErr) { console.error('form_submissions ERROR:', JSON.stringify(subErr)); process.exit(1); }

const clinicsRes = await sb.from('clinics').select('id, slug, name');
const clinicMap = {};
(clinicsRes.data || []).forEach((c) => { clinicMap[c.id] = c; });

let totalDraft = 0;
let opinionDraft = 0;
let mixedCount = 0;
const byClinic = {};      // slug -> { draft, opinion, mixed }
const mixedSamples = [];  // 최대 10건 샘플(id 만, PII 미노출)

const keysOf = (fd) => {
  const k = fd?.selected_keys ?? fd?.selected_option_keys ?? [];
  return Array.isArray(k) ? k.map(String) : [];
};

for (const s of subs || []) {
  totalDraft++;
  const c = clinicMap[s.clinic_id] || {};
  const slug = c.slug ?? '(unknown)';
  byClinic[slug] = byClinic[slug] || { draft: 0, opinion: 0, mixed: 0 };
  byClinic[slug].draft++;

  const isOpinion = s.template_id && opinionTplIds.has(s.template_id);
  if (isOpinion) { opinionDraft++; byClinic[slug].opinion++; }

  const keys = keysOf(s.field_data);
  const hasDiag = keys.some((k) => DIAGNOSIS_KEYS.has(k));
  const hasContra = keys.some((k) => CONTRAIND_KEYS.has(k));
  if (hasDiag && hasContra) {
    mixedCount++;
    byClinic[slug].mixed++;
    if (mixedSamples.length < 10) {
      mixedSamples.push({ id: s.id, slug, template_opinion: !!isOpinion, keys, created_at: s.created_at });
    }
  }
}

console.log('================ AC-3 form_submissions draft 오염건 audit (READ-ONLY) ================');
console.log(`총 draft form_submissions      : ${totalDraft}`);
console.log(`그중 opinion_doc 템플릿 draft  : ${opinionDraft}`);
console.log(`★진단서+금기증 혼합(오염) 건수 : ${mixedCount}`);
console.log('\n--- clinic별 분포 (slug | draft | opinion_doc | mixed) ---');
for (const [slug, v] of Object.entries(byClinic).sort()) {
  console.log(`${slug.padEnd(16)} | draft ${String(v.draft).padStart(4)} | opinion ${String(v.opinion).padStart(4)} | mixed ${String(v.mixed).padStart(4)}`);
}
console.log('\n--- 혼합 샘플(최대 10건, id/keys 만 — PII 미노출) ---');
if (mixedSamples.length === 0) console.log('(오염건 없음)');
for (const m of mixedSamples) {
  console.log(`${m.id} | ${m.slug} | opinionTpl=${m.template_opinion} | keys=[${m.keys.join(', ')}] | ${m.created_at}`);
}
console.log('\n⚠ READ-ONLY 완료 — 데이터 변경 0건. 실제 정리는 supervisor 게이트 별도 절차(범위 외).');
