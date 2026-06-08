/**
 * T-20260608-foot-FIRSTVISIT-MEMO-EMPTYSTATE — AC-0 (READ-ONLY)
 *
 * 질문: 초진상담차트가 있는데 ConsultRecordTab 우측 📋상담 탭에서 "기록 메모 없음" 표시.
 *   분기 (A) 실제 빈 데이터 → 문구/UX 정리만.
 *   분기 (B) 데이터 있는데 미표시(조인/매핑/조건 누락) → 조회 수정으로 격상.
 *
 * ConsultRecordTab 표시 규칙 (src/components/ConsultRecordTab.tsx):
 *   - 메모 = notesText(r.notes) = notes.text(JSONB).trim()
 *   - "기록 메모 없음" 은 (!memo && !treatmentSummary && !consultant) 일 때만 노출.
 *   - 조회: check_ins where customer_id=? and status<>'cancelled', notes + treatment + consultant_id select.
 *
 * 이 스크립트: 초진(visit_type='new') check_ins 전수에서
 *   1) notes JSONB 의 키 분포 (text 외 다른 키에 메모가 숨어있는지)
 *   2) notes.text 가 비었는데 다른 메모성 컬럼(treatment_memo/doctor_note/customer 등)엔 내용 있는지
 *   3) "기록 메모 없음" 조건 성립 레코드 수 + 그 중 실제로 어딘가에 메모가 있는 비율
 * 를 집계해 A/B 를 판정한다. READ-ONLY (select 만).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function notesText(notes) {
  if (!notes || typeof notes !== 'object') return '';
  const t = notes.text;
  return typeof t === 'string' ? t.trim() : '';
}
function treatmentSummary(r) {
  const parts = [];
  if (r.treatment_category) parts.push(r.treatment_category);
  if (r.treatment_kind) parts.push(r.treatment_kind);
  if (Array.isArray(r.treatment_contents) && r.treatment_contents.length > 0)
    parts.push(r.treatment_contents.filter(Boolean).join(', '));
  return parts.join(' · ');
}

console.log('=== 초진(visit_type=new) check_ins 전수 조사 (READ-ONLY) ===');
const { data: rows, error } = await sb
  .from('check_ins')
  .select('id, customer_id, checked_in_at, visit_type, consultation_done, consultant_id, notes, treatment_kind, treatment_category, treatment_contents, treatment_memo, doctor_note, status')
  .eq('visit_type', 'new')
  .neq('status', 'cancelled')
  .order('checked_in_at', { ascending: false })
  .limit(2000);

if (error) { console.error('조회 실패', error); process.exit(1); }
console.log(`초진 check_ins 총 ${rows.length}건`);

// 1) notes 키 분포
const keyCount = {};
let notesNullCnt = 0;
for (const r of rows) {
  if (!r.notes || typeof r.notes !== 'object') { notesNullCnt++; continue; }
  for (const k of Object.keys(r.notes)) keyCount[k] = (keyCount[k] ?? 0) + 1;
}
console.log(`\n[1] notes JSONB 키 분포 (notes null/비객체: ${notesNullCnt}건)`);
Object.entries(keyCount).sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`   ${k}: ${c}`));

// 2) "기록 메모 없음" 조건 성립 레코드
let emptyStateCnt = 0;        // ConsultRecordTab 가 "기록 메모 없음" 띄우는 레코드
let emptyButHasOther = 0;     // 그 중 실제로 어딘가 메모가 있는 레코드 (= 분기 B 증거)
const bSamples = [];
let consultDoneEmpty = 0;     // consultation_done=true 인데 메모 없는 레코드

for (const r of rows) {
  const memo = notesText(r.notes);
  const tx = treatmentSummary(r);
  const consultant = r.consultant_id ? 'Y' : '';
  const showsEmpty = !memo && !tx && !consultant; // ConsultRecordTab "기록 메모 없음" 조건
  if (showsEmpty) {
    emptyStateCnt++;
    // 다른 곳에 메모가 실재하는가?
    // 메타데이터/플래그 키는 메모가 아님 — 진짜 메모성 키만 후보로.
    const META_KEYS = new Set(['lead_source', 'lead_source_detail', 'id_check_required', 'walk_in', 'needs_exam']);
    const notesOtherKeys = (r.notes && typeof r.notes === 'object')
      ? Object.entries(r.notes).filter(([k, v]) => k !== 'text' && !META_KEYS.has(k) && typeof v === 'string' && v.trim()).map(([k]) => k)
      : [];
    const tmemo = r.treatment_memo && typeof r.treatment_memo === 'object'
      ? Object.entries(r.treatment_memo).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k]) => k)
      : [];
    const hasDoctorNote = r.doctor_note && String(r.doctor_note).trim();
    const elsewhere = notesOtherKeys.length || tmemo.length || hasDoctorNote;
    if (elsewhere) {
      emptyButHasOther++;
      if (bSamples.length < 12) bSamples.push({
        id: r.id.slice(0, 8),
        notesOtherKeys, treatment_memo: tmemo, doctor_note: hasDoctorNote ? String(r.doctor_note).slice(0, 40) : '',
        notesTextRaw: r.notes?.text === undefined ? 'undefined' : JSON.stringify(r.notes?.text),
      });
    }
  }
  if (r.consultation_done && !memo) consultDoneEmpty++;
}

console.log(`\n[2] ConsultRecordTab "기록 메모 없음" 조건 성립: ${emptyStateCnt}/${rows.length}건`);
console.log(`    └ 그 중 다른 컬럼/키에 실제 메모 존재 (분기 B 증거): ${emptyButHasOther}건`);
console.log(`[3] consultation_done=true 인데 notes.text 비어있음: ${consultDoneEmpty}건`);

if (bSamples.length) {
  console.log('\n[B 샘플] 메모가 다른 곳에 있는데 미표시된 레코드:');
  bSamples.forEach(s => console.log('  ', JSON.stringify(s)));
}

// 3) 판정
console.log('\n=== 판정 ===');
if (emptyButHasOther > 0) {
  console.log(`분기 B 의심: ${emptyButHasOther}건이 다른 곳에 메모를 보유. notesText() 가 .text 만 읽어 누락 가능.`);
} else {
  console.log('분기 A 유력: "기록 메모 없음" 레코드들은 어떤 메모 컬럼에도 내용이 없음 (= 실제 빈 데이터).');
}
process.exit(0);
