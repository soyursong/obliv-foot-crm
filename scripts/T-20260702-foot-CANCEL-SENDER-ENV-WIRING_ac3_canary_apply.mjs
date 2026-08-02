/**
 * T-20260702-foot-CANCEL-SENDER-ENV-WIRING — AC3 CANARY 예약 지정 (prod INSERT 1 customer + 1 reservation)
 *
 * 목적: supervisor AC3(자동 취소전파 end-to-end) 구동용 안전 합성 예약 1건.
 *   라이브 환자예약 blind 취소 금지 → is_simulation 마킹된 canary 예약 지정.
 *
 * 계약(cross_crm §6 · sender EF dopamine-callback type='cancelled'):
 *   - reservations.external_id (UUID) = 도파민 cue_card.id → sender 발화 조건('not_dopamine_source' 회피).
 *   - source_system='dopamine' (TM-origin 재현).
 *   - status='confirmed' (취소 가능 상태).
 *   - customers.is_simulation=TRUE (cascade cleanup 대상, 실제 환자 아님).
 *
 * 페어(dev-dopamine): 도파민 cue_cards 에 id = <CANARY_CUE_CARD_ID> 인 대응 카드가
 *   stage != cancelled 로 존재해야 cancel_sync 검증 가능.
 *
 * 재실행 안전: 동일 external_id canary 존재 시 재생성 없이 기존 id 리포트.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-08-10';           // 미래 예정 예약(취소 가능)
const TIME = '09:00:00';
const MARKER = '[CANARY AC3 CANCEL-SYNC 20260702]';
// 공유 canary cue_card id — dev-dopamine 이 동일 id 로 cue_card 지정/확인.
// 환경변수로 주입 가능(dopamine 이 선지정한 id 사용 시): CANARY_CUE_CARD_ID
const CANARY_CUE_CARD_ID = process.env.CANARY_CUE_CARD_ID || randomUUID();
// 구조적 합성 sentinel MSISDN (phi-allowlist permit 010-1234-5678, 실환자 아님)
const CANARY_PHONE = '+821012345678';

// ── 0) slug resolve 재확인 (INSERT 전 필수) ──────────────────────────────
const { data: clinics, error: cerr } = await sb.from('clinics').select('id, slug, name').eq('slug', 'jongno-foot');
if (cerr) { console.error('clinic resolve fail:', cerr); process.exit(1); }
const CLINIC_ID = clinics?.[0]?.id;
console.log(`[slug resolve] jongno-foot = ${CLINIC_ID} (${clinics?.[0]?.name})`);
if (CLINIC_ID !== EXPECT_CLINIC_ID) {
  console.error(`ABORT: resolved clinic_id(${CLINIC_ID}) != 기대값(${EXPECT_CLINIC_ID})`);
  process.exit(1);
}

// ── 1) 재실행 안전: 기존 canary 존재 확인 (marker 기준) ──────────────────
const { data: existing } = await sb
  .from('reservations')
  .select('id, external_id, source_system, status, customer_id')
  .eq('clinic_id', CLINIC_ID)
  .eq('memo', MARKER)
  .maybeSingle();
if (existing) {
  console.log('\n=== 기존 CANARY 존재 — 재생성 생략 ===');
  console.log(JSON.stringify(existing, null, 2));
  console.log(`\nRESERVATION_ID=${existing.id}`);
  console.log(`CUE_CARD_ID=${existing.external_id}`);
  console.log(`STATUS=${existing.status}`);
  process.exit(0);
}

// ── 2) 고객 1건 INSERT (is_simulation=TRUE) ─────────────────────────────
const { data: custIns, error: ce } = await sb.from('customers').insert({
  clinic_id: CLINIC_ID,
  name: 'AC3취소카나리',
  phone: CANARY_PHONE,
  visit_type: 'new',
  is_simulation: true,
  memo: MARKER,
}).select('id, name, phone, chart_number').single();
if (ce) { console.error('CUSTOMER INSERT FAIL:', ce); process.exit(1); }
console.log(`고객 INSERT OK: ${custIns.id} (${custIns.name})`);

// ── 3) 예약 1건 INSERT (external_id=cue_card_id, source_system=dopamine, confirmed) ──
const resvRow = {
  clinic_id: CLINIC_ID,
  customer_id: custIns.id,
  customer_name: custIns.name,
  customer_phone: CANARY_PHONE,
  reservation_date: DATE,
  reservation_time: TIME,
  visit_type: 'new',
  status: 'confirmed',
  source_system: 'dopamine',
  external_id: CANARY_CUE_CARD_ID,
  memo: MARKER,
};
const { data: resvIns, error: re } = await sb.from('reservations')
  .insert(resvRow)
  .select('id, customer_id, external_id, source_system, status, reservation_date, reservation_time')
  .single();
if (re) {
  console.error('RESERVATION INSERT FAIL:', re);
  await sb.from('customers').delete().eq('id', custIns.id);
  console.log('고객 롤백 완료');
  process.exit(1);
}

// ── 4) 검증 ──────────────────────────────────────────────────────────────
console.log('\n=== CANARY 예약 생성 완료 ===');
console.log(JSON.stringify(resvIns, null, 2));
console.log(`\nRESERVATION_ID=${resvIns.id}`);
console.log(`CUE_CARD_ID=${resvIns.external_id}`);
console.log(`SOURCE_SYSTEM=${resvIns.source_system}`);
console.log(`STATUS=${resvIns.status}`);
console.log(`CLINIC_ID=${CLINIC_ID}`);
console.log('\n=== DONE ===');
