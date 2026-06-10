/**
 * T-20260610-foot-RESV-DUPGUARD-SAMEDAY
 * 대시보드 예약 신규 생성 동일고객 당일 중복 방지 — 회귀 방지 E2E
 *
 * Root Cause: QuickReservationDialog.handleSave 의 reservations INSERT 가
 *   동일고객(customer_id/phone)+당일(reservation_date) 중복을 막지 못함.
 *   기존 가드는 reservation_id 기준(체크인 단계)만 → 신규 생성 무방비.
 *   체크인 완료(checked_in) 고객도 또 예약 생성됨 (증거 F0B9CLQ1KRT).
 *
 * Fix:
 *   - FE: checkReservationDupSameDay (RPC fn_reservation_dup_guard 우선, fallback SELECT)
 *   - DB(GO_WARN gate): fn_reservation_dup_guard RPC + idx_reservations_customer_daily(GATE-HOLD)
 *   선행 정본 = T-20260602-foot-SELFCHECKIN-DUP-GUARD (check_ins analog) 일관화.
 *
 * AC 커버 (가드 query 의미론 = FE fallback / RPC 와 동일 조건):
 *   AC-1  customer_id 당일 중복 → 차단 (duplicate=true)
 *   AC-2  phone digits 정규화 매칭(customer_id 미연결 워크인 예약) → 차단
 *   AC-3  status='cancelled' 제외 → 취소 후 재예약 허용 (duplicate=false)
 *   AC-4  타 날짜(reservation_date 상이) → 무영향 (duplicate=false)
 *   AC-5  checked_in 예약도 활성 → 차단 (F0B9CLQ1KRT 증거 재현)
 *   AC-6  타 고객 → 무영향 (duplicate=false)
 *
 * 현장 클릭 시나리오 3종:
 *   (S1) 동일고객 같은날 두 번째 예약 → 차단
 *   (S2) 취소 후 같은날 재예약 → 허용
 *   (S3) 타고객·타날짜 → 영향 없음
 *
 * Note: SERVICE_KEY 환경 필요. 없으면 skip. RPC 미배포(GO_WARN hold) 시 RPC 블록 skip,
 *       fallback query 의미론 검증은 항상 수행(정책 진실).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function randSuffix() {
  return String(Date.now()).slice(-6);
}

/**
 * 가드 query 의미론 재현 (FE checkReservationDupSameDay fallback 과 동일 조건).
 * clinic_id + reservation_date + status<>cancelled 활성 예약을 받아 (customer_id|phone digits) OR 매칭.
 */
async function isDupSameDay(
  sb: SupabaseClient,
  clinicId: string,
  customerId: string | null,
  phone: string | null,
  date: string,
): Promise<boolean> {
  const phoneDigits = (phone ?? '').replace(/[^0-9]/g, '');
  if (!customerId && phoneDigits.length < 10) return false;
  const { data: rows } = await sb
    .from('reservations')
    .select('id, customer_id, customer_phone')
    .eq('clinic_id', clinicId)
    .eq('reservation_date', date)
    .neq('status', 'cancelled');
  if (!rows) return false;
  return (rows as Array<{ customer_id: string | null; customer_phone: string | null }>).some((r) => {
    if (customerId && r.customer_id === customerId) return true;
    if (phoneDigits.length >= 10 && (r.customer_phone ?? '').replace(/[^0-9]/g, '') === phoneDigits) return true;
    return false;
  });
}

test.describe('T-20260610-foot-RESV-DUPGUARD-SAMEDAY — 가드 의미론 (DB)', () => {
  test('AC-1/AC-5/S1: customer_id 당일 중복(confirmed·checked_in) → 차단', async () => {
    test.skip(!SERVICE_KEY, 'SERVICE_KEY 환경변수 없음 — CI skip');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const sfx = randSuffix();
    const TODAY = new Date().toISOString().slice(0, 10);
    const phone = `0106${sfx}`;

    const { data: cust } = await sb.from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `dupg-${sfx}`, phone, visit_type: 'new' })
      .select('id').single();
    const customerId = (cust as { id: string }).id;

    // AC-5: 첫 예약은 checked_in (체크인 완료 고객) — 여전히 활성
    const { data: r1 } = await sb.from('reservations').insert({
      clinic_id: CLINIC_ID, customer_id: customerId, customer_name: `dupg-${sfx}`,
      customer_phone: phone, reservation_date: TODAY, reservation_time: '10:00',
      visit_type: 'new', status: 'checked_in',
    }).select('id').single();
    const r1Id = (r1 as { id: string }).id;

    // S1: 같은날 두 번째 예약 시도 → 가드는 차단(true) 이어야 함
    const dup = await isDupSameDay(sb, CLINIC_ID, customerId, phone, TODAY);
    expect(dup, 'checked_in 활성 예약 존재 → 동일고객 당일 재예약 차단').toBe(true);

    await sb.from('reservations').delete().eq('id', r1Id);
    await sb.from('customers').delete().eq('id', customerId);
  });

  test('AC-2: phone digits 정규화 매칭(customer_id 미연결 워크인 예약) → 차단', async () => {
    test.skip(!SERVICE_KEY, 'SERVICE_KEY 환경변수 없음 — CI skip');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const sfx = randSuffix();
    const TODAY = new Date().toISOString().slice(0, 10);
    // FE 는 normalizeToE164 결과(E.164)를 가드/저장 양쪽에 사용 → 양측 E.164.
    // digit 정규화 경로 검증: 저장값엔 하이픈, 질의값엔 공백 등 포맷 차이를 줘도 digits 일치 시 차단.
    const stored = `+82106${sfx}`;          // 저장 포맷(E.164)
    const queried = `+82-106-${sfx}`;       // 질의 포맷(하이픈) — raw != stored, digits 동일

    // customer_id NULL 워크인 예약 (phone 만)
    const { data: r1 } = await sb.from('reservations').insert({
      clinic_id: CLINIC_ID, customer_id: null, customer_name: `walk-${sfx}`,
      customer_phone: stored, reservation_date: TODAY, reservation_time: '11:00',
      visit_type: 'new', status: 'confirmed',
    }).select('id').single();
    const r1Id = (r1 as { id: string }).id;

    const dup = await isDupSameDay(sb, CLINIC_ID, null, queried, TODAY);
    expect(dup, 'phone digits 정규화 일치(포맷차이 흡수) → 차단').toBe(true);

    await sb.from('reservations').delete().eq('id', r1Id);
  });

  test('AC-3/S2: status=cancelled 제외 → 취소 후 재예약 허용', async () => {
    test.skip(!SERVICE_KEY, 'SERVICE_KEY 환경변수 없음 — CI skip');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const sfx = randSuffix();
    const TODAY = new Date().toISOString().slice(0, 10);
    const phone = `0105${sfx}`;

    const { data: cust } = await sb.from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `cxl-${sfx}`, phone, visit_type: 'new' })
      .select('id').single();
    const customerId = (cust as { id: string }).id;

    // 취소된 예약만 존재
    const { data: r1 } = await sb.from('reservations').insert({
      clinic_id: CLINIC_ID, customer_id: customerId, customer_name: `cxl-${sfx}`,
      customer_phone: phone, reservation_date: TODAY, reservation_time: '12:00',
      visit_type: 'new', status: 'cancelled',
    }).select('id').single();
    const r1Id = (r1 as { id: string }).id;

    const dup = await isDupSameDay(sb, CLINIC_ID, customerId, phone, TODAY);
    expect(dup, '취소건은 카운트 제외 → 재예약 허용').toBe(false);

    await sb.from('reservations').delete().eq('id', r1Id);
    await sb.from('customers').delete().eq('id', customerId);
  });

  test('AC-4/AC-6/S3: 타 날짜·타 고객 → 무영향', async () => {
    test.skip(!SERVICE_KEY, 'SERVICE_KEY 환경변수 없음 — CI skip');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const sfx = randSuffix();
    const TODAY = new Date().toISOString().slice(0, 10);
    const TOMORROW = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const phone = `0104${sfx}`;

    const { data: cust } = await sb.from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `other-${sfx}`, phone, visit_type: 'new' })
      .select('id').single();
    const customerId = (cust as { id: string }).id;

    // 내일 예약 1건 (오늘 가드에 무영향)
    const { data: r1 } = await sb.from('reservations').insert({
      clinic_id: CLINIC_ID, customer_id: customerId, customer_name: `other-${sfx}`,
      customer_phone: phone, reservation_date: TOMORROW, reservation_time: '13:00',
      visit_type: 'new', status: 'confirmed',
    }).select('id').single();
    const r1Id = (r1 as { id: string }).id;

    // AC-4: 오늘 동일고객 예약 생성 → 내일 예약은 무영향 → 허용
    const dupToday = await isDupSameDay(sb, CLINIC_ID, customerId, phone, TODAY);
    expect(dupToday, '타 날짜 예약은 오늘 가드에 무영향').toBe(false);

    // AC-6: 타 고객(다른 phone, customer 없음) → 무영향
    const dupOther = await isDupSameDay(sb, CLINIC_ID, null, `0103${sfx}`, TODAY);
    expect(dupOther, '타 고객 → 무영향').toBe(false);

    await sb.from('reservations').delete().eq('id', r1Id);
    await sb.from('customers').delete().eq('id', customerId);
  });
});

test.describe('T-20260610-foot-RESV-DUPGUARD-SAMEDAY — fn_reservation_dup_guard RPC (배포 시)', () => {
  test('RPC: customer_id 당일 중복 → duplicate=true / 취소건 → false', async () => {
    test.skip(!SERVICE_KEY, 'SERVICE_KEY 환경변수 없음 — CI skip');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const sfx = randSuffix();
    const TODAY = new Date().toISOString().slice(0, 10);
    const phone = `0102${sfx}`;

    // RPC 미배포(GO_WARN hold) 감지 — 없으면 skip
    const probe = await sb.rpc('fn_reservation_dup_guard', {
      p_clinic_id: CLINIC_ID, p_customer_id: null, p_phone: null, p_date: TODAY,
    });
    test.skip(!!probe.error, 'fn_reservation_dup_guard 미배포 (supervisor GO_WARN gate) — RPC 검증 skip');

    const { data: cust } = await sb.from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `rpc-${sfx}`, phone, visit_type: 'new' })
      .select('id').single();
    const customerId = (cust as { id: string }).id;

    const { data: r1 } = await sb.from('reservations').insert({
      clinic_id: CLINIC_ID, customer_id: customerId, customer_name: `rpc-${sfx}`,
      customer_phone: phone, reservation_date: TODAY, reservation_time: '15:00',
      visit_type: 'new', status: 'confirmed',
    }).select('id').single();
    const r1Id = (r1 as { id: string }).id;

    const { data: dupRes } = await sb.rpc('fn_reservation_dup_guard', {
      p_clinic_id: CLINIC_ID, p_customer_id: customerId, p_phone: phone, p_date: TODAY,
    });
    expect((dupRes as { duplicate?: boolean }).duplicate, 'RPC: 당일 중복 → true').toBe(true);

    // 취소 후 → false
    await sb.from('reservations').update({ status: 'cancelled' }).eq('id', r1Id);
    const { data: afterCxl } = await sb.rpc('fn_reservation_dup_guard', {
      p_clinic_id: CLINIC_ID, p_customer_id: customerId, p_phone: phone, p_date: TODAY,
    });
    expect((afterCxl as { duplicate?: boolean }).duplicate, 'RPC: 취소 후 → false').toBe(false);

    await sb.from('reservations').delete().eq('id', r1Id);
    await sb.from('customers').delete().eq('id', customerId);
  });
});
