/**
 * T-20260718-foot-NOSHOW-DONE-CONTRADICTION-CORRECTION — READ-ONLY provenance finalize census (prod)
 *
 * 목적: DA(CONDITIONAL GO) apply-직전 게이트 = per-row 정정 정당성 finalize 2판별자 확보.
 *   (a) 15:05 no_show flip의 write-path/actor  → 자동 no-show 스윕/배치 vs staff UI 단일행 액션
 *   (b) done check_in의 진정성                → genuine done(예약=오답측) vs mis-linked/test(check_in=오답측)
 *
 * READ-ONLY: SELECT 만. UPDATE·emit·트리거 유발 0. §3-1 freeze 위배 없음.
 * PHI 위생: customer_name/customer_phone/treatment_memo 내용/notes 내용 SELECT 하지 않음.
 *   emit = UUID PK / status / 시각 / bool / count 뿐.
 * 실행: node scripts/T-20260718-foot-NOSHOW-DONE-CONTRADICTION_provenance.mjs
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function loadEnv(path) {
  const out = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };
const URL = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('❌ env 부재'); process.exit(1); }
const projectRef = URL.replace(/^https:\/\//, '').split('.')[0];
if (projectRef !== 'rxlomoozakkjesdqjtvd') { console.error(`❌ prod ref 불일치: ${projectRef}`); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const RESV_ID = '9f45105b-eff7-4056-a61d-e1308b837c0f';
const CHECKIN_ID = 'f62bf262-aaf8-4a6e-8eb9-0ba869fdf322';

// ─────────────────────────────────────────────────────────────
// (a) no_show flip write-path/actor
// ─────────────────────────────────────────────────────────────
const { data: resvRow, error: e1 } = await sb
  .from('reservations')
  .select('id,status,source_system,created_by,updated_by,created_at,updated_at')
  .eq('id', RESV_ID)
  .single();
if (e1) throw new Error(`reservations: ${e1.message}`);

// 배치/스윕 지문: 동일 초(15:05:28)에 no_show 로 flip 된 다른 예약이 있는가?
// 자동 스윕 = 동일 timestamp 다행 flip. staff 단일 액션 = 해당 초 고립.
const flipSecStart = '2026-07-16T15:05:28.000+00:00';
const flipSecEnd   = '2026-07-16T15:05:29.000+00:00';
const { data: sameSecFlips, error: e2 } = await sb
  .from('reservations')
  .select('id,status,updated_at,updated_by,source_system')
  .eq('status', 'no_show')
  .gte('updated_at', flipSecStart)
  .lt('updated_at', flipSecEnd);
if (e2) throw new Error(`same-sec flips: ${e2.message}`);

// 넓은 창(±5분) 내 no_show flip 분포 — 배치 파형 추가 확인
const windowStart = '2026-07-16T15:00:00.000+00:00';
const windowEnd   = '2026-07-16T15:11:00.000+00:00';
const { data: windowFlips, error: e3 } = await sb
  .from('reservations')
  .select('id,updated_at,updated_by')
  .eq('status', 'no_show')
  .gte('updated_at', windowStart)
  .lt('updated_at', windowEnd);
if (e3) throw new Error(`window flips: ${e3.message}`);

// updated_by resolve (auth uid → user_profiles.name) — actor 정체
let actorName = null;
if (resvRow.updated_by) {
  const { data: up } = await sb.from('user_profiles').select('name').eq('id', resvRow.updated_by).maybeSingle();
  actorName = up?.name ?? '(uid resolve 실패)';
}
let creatorName = null;
if (resvRow.created_by) {
  const { data: up } = await sb.from('user_profiles').select('name').eq('id', resvRow.created_by).maybeSingle();
  creatorName = up?.name ?? '(uid resolve 실패)';
}

const discriminator_a = {
  reservation_id: resvRow.id,
  status: resvRow.status,
  source_system: resvRow.source_system,
  created_by_uid: resvRow.created_by,
  created_by_name: creatorName,
  updated_by_uid: resvRow.updated_by,
  updated_by_name: actorName,
  created_at: resvRow.created_at,
  updated_at: resvRow.updated_at,
  same_second_flip_count: sameSecFlips.length,
  same_second_flip_ids: sameSecFlips.map((r) => r.id),
  same_second_distinct_updated_by: [...new Set(sameSecFlips.map((r) => r.updated_by))],
  window_5min_flip_count: windowFlips.length,
  window_distinct_updated_by: [...new Set(windowFlips.map((r) => r.updated_by))],
  verdict:
    sameSecFlips.length >= 3
      ? 'auto_sweep_batch'         // 동일 초 다행 flip = 자동 no-show 스윕 지문
      : (resvRow.updated_by
          ? 'staff_ui_single_action' // updated_by 유효 + 고립 flip = staff 단일행 액션
          : 'indeterminate_no_actor'), // updated_by NULL + 고립 = 애매(트리거/시스템 경로 가능)
};

// ─────────────────────────────────────────────────────────────
// (b) done check_in 진정성
// ─────────────────────────────────────────────────────────────
const { data: ci, error: e4 } = await sb
  .from('check_ins')
  .select('id,reservation_id,customer_id,clinic_id,status,visit_type,consultant_id,therapist_id,technician_id,consultation_room,treatment_room,laser_room,treatment_memo,treatment_photos,checked_in_at,called_at,completed_at,created_at')
  .eq('id', CHECKIN_ID)
  .single();
if (e4) throw new Error(`check_ins: ${e4.message}`);

// status_transitions 궤적 (PHI 없음)
const { data: st, error: e5 } = await sb
  .from('status_transitions')
  .select('from_status,to_status,room_id,changed_by,transitioned_at')
  .eq('check_in_id', CHECKIN_ID)
  .order('transitioned_at', { ascending: true });
if (e5) throw new Error(`status_transitions: ${e5.message}`);

// MediRec(진료차트) 존재 — customer_id 기준 count (내용 미조회)
let medChartCount = null;
if (ci.customer_id) {
  const { count, error: e6 } = await sb
    .from('medical_charts')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', ci.customer_id);
  if (e6) throw new Error(`medical_charts: ${e6.message}`);
  medChartCount = count;
}

const timeOrderOk = ci.created_at && ci.completed_at
  ? new Date(ci.created_at) <= new Date(ci.completed_at)
  : null;
const durationMin = ci.created_at && ci.completed_at
  ? Math.round((new Date(ci.completed_at) - new Date(ci.created_at)) / 60000)
  : null;

// 진정성 신호 집계
const hasRoom = !!(ci.consultation_room || ci.treatment_room || ci.laser_room);
const hasStaff = !!(ci.consultant_id || ci.therapist_id || ci.technician_id);
const hasTreatmentMemo = ci.treatment_memo != null && (typeof ci.treatment_memo !== 'object' || Object.keys(ci.treatment_memo || {}).length > 0);
const photoCount = Array.isArray(ci.treatment_photos) ? ci.treatment_photos.length : 0;
const reachedDone = st.some((t) => t.to_status === 'done');

const genuineSignals = [
  timeOrderOk === true,
  st.length >= 2,            // 다단계 궤적 = 실제 진행
  reachedDone,               // done 전이 실재
  hasRoom,
  hasStaff,
  hasTreatmentMemo || photoCount > 0 || (medChartCount != null && medChartCount > 0),
];
const genuineScore = genuineSignals.filter(Boolean).length;

const discriminator_b = {
  checkin_id: ci.id,
  reservation_id: ci.reservation_id,
  customer_id: ci.customer_id,
  status: ci.status,
  visit_type: ci.visit_type,
  created_at: ci.created_at,
  completed_at: ci.completed_at,
  time_order_ok: timeOrderOk,
  duration_min: durationMin,
  has_staff: hasStaff,
  staff_ids: { consultant_id: ci.consultant_id, therapist_id: ci.therapist_id, technician_id: ci.technician_id },
  has_room: hasRoom,
  rooms: { consultation_room: ci.consultation_room, treatment_room: ci.treatment_room, laser_room: ci.laser_room },
  has_treatment_memo: hasTreatmentMemo,
  treatment_photo_count: photoCount,
  medical_chart_count_for_customer: medChartCount,
  status_transitions_count: st.length,
  reached_done_transition: reachedDone,
  status_trajectory: st.map((t) => ({ from: t.from_status, to: t.to_status, room: t.room_id, by: t.changed_by, at: t.transitioned_at })),
  genuine_score: `${genuineScore}/6`,
  verdict:
    genuineScore >= 4
      ? 'genuine_done'            // check_in 진정 → 예약이 오답측 = 정정 정당(no_show→checked_in)
      : (st.length === 0 && !hasStaff && !hasRoom
          ? 'mis_linked_or_test'  // 궤적/직원/룸 전무 = mis-linked·test 의심 = scope 이탈
          : 'weak_genuine'),      // 부분 신호 — 근거 첨부, 사람 판단 보조
};

// ─────────────────────────────────────────────────────────────
// freeze artifact 확장 (기존 census JSON 에 provenance 병합)
// ─────────────────────────────────────────────────────────────
const outPath = process.env.HOME + '/claude-sync/memory/_handoff/backfill_artifacts/T-20260718-foot-NOSHOW-DONE-CONTRADICTION_census.json';
const base = JSON.parse(fs.readFileSync(outPath, 'utf8'));
base.provenance_finalize = {
  ticket: 'T-20260718-foot-NOSHOW-DONE-CONTRADICTION-CORRECTION',
  generated_note: 'READ-ONLY provenance finalize census — DA CONDITIONAL GO apply-직전 2판별자. UPDATE·emit 0. PHI(name/phone/memo내용) 미조회.',
  discriminator_a_flip_provenance: discriminator_a,
  discriminator_b_done_authenticity: discriminator_b,
  routing_summary: {
    a: discriminator_a.verdict,
    b: discriminator_b.verdict,
    correction_justified:
      discriminator_b.verdict === 'genuine_done'
        ? 'YES — 예약 no_show 가 오답측, check_in done 진정. no_show→checked_in 정정 정당.'
        : (discriminator_b.verdict === 'mis_linked_or_test'
            ? 'NO — check_in 이 오답측(mis-linked/test). scope 이탈 → 정정 대상 아님.'
            : 'CONDITIONAL — 부분 신호. planner/DA 사람 판단 보조 필요.'),
  },
};
fs.writeFileSync(outPath, JSON.stringify(base, null, 2));

console.log('=== (a) flip provenance ===');
console.log(JSON.stringify(discriminator_a, null, 2));
console.log('\n=== (b) done authenticity ===');
console.log(JSON.stringify(discriminator_b, null, 2));
console.log('\n=== routing ===');
console.log(JSON.stringify(base.provenance_finalize.routing_summary, null, 2));
console.log(`\n✅ freeze 갱신 → ${outPath}`);
