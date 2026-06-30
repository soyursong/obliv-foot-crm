/**
 * T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL — TM 예약 수정/취소 ingest E2E (service-role DB 통합)
 *
 * 합본 superset(20260630190000) 검증. 3-티켓 단일 RPC body 의 본건 delta:
 *   (a)① 재푸시 mutable UPDATE(reservation_date·time·memo·status) — no-op 정황 보정
 *   (a)② p_status='cancelled' → 멱등키 행 cancelled 전이 + 슬롯 release + self-mint scope 가드 + 재취소 no-op
 *
 * 왜 DB 통합 spec: TM 인입 경로 = 도파민 push → upsert_reservation_from_source RPC(계약 표준 진입점).
 *   FE 화면 경유 아님 → 결정론 검증 대상 = RPC 멱등/전이/가드.
 *
 * 격리: source_system='e2e-tm-cancel*' 마커(prod 'dopamine' 무영향, callback 트리거 미발화). before/after purge.
 * 사전조건(graceful skip): 합본 마이그 미적용(RPC 8-arg → p_status 인자 미해석) 환경 → 명시 skip(배포 前 GREEN-or-SKIP).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SRC = 'e2e-tm-cancel';                 // self-mint(TM) 마커
const SRC_NATIVE = 'e2e-tm-cancel-native';   // 다른 source(=foot-native 모사) — 가드 대상
const CLINIC_SLUG = 'jongno-foot';
const CUE = 'b2c3d4e5-0000-4000-8000-00000000ca01';
const EXT = `${CUE}-resv`;
const EXT_GUARD = `${CUE}-guard`;
const EXT_ABSENT = `${CUE}-absent`;

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}
async function purge() {
  if (!SERVICE_KEY) return;
  const sb = admin();
  for (const s of [SRC, SRC_NATIVE]) await sb.from('reservations').delete().eq('source_system', s);
}
async function callUpsert(sb: SupabaseClient, args: Record<string, unknown>) {
  return sb.rpc('upsert_reservation_from_source', args);
}
async function rowByKey(sb: SupabaseClient, src: string, ext: string) {
  const { data } = await sb.from('reservations').select('id,status,memo,reservation_time')
    .eq('source_system', src).eq('external_id', ext).maybeSingle();
  return data as { id: string; status: string; memo: string | null; reservation_time: string } | null;
}

/** 합본 마이그 적용 여부(RPC 가 p_status 인자 해석?). 미적용 → skip 사유. */
async function migrationReady(): Promise<string | null> {
  if (!SERVICE_KEY) return 'SERVICE_ROLE_KEY 부재 — DB 통합 검증 skip';
  const sb = admin();
  const { error } = await callUpsert(sb, {
    p_source_system: SRC, p_external_id: `${CUE}-probe`, p_clinic_slug: CLINIC_SLUG,
    p_customer_phone: '01000000000', p_customer_name: 'probe',
    p_reservation_date: '2099-01-01', p_reservation_time: '10:00', p_status: 'cancelled',
  });
  if (error && /p_status|function|does not exist|argument/i.test(error.message)) {
    return `합본 마이그 미적용(RPC p_status 미해석): ${error.message}`;
  }
  await sb.from('reservations').delete().eq('source_system', SRC).eq('external_id', `${CUE}-probe`);
  return null;
}

test.describe('T-20260630-foot-TM-EDIT-CANCEL · TM 예약 수정/취소 ingest', () => {
  test.beforeAll(purge);
  test.afterAll(purge);

  test('S1 (a② cancel) self-mint 행 cancelled 전이 + 슬롯 release', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();
    // active 인입
    const ins = await callUpsert(sb, {
      p_source_system: SRC, p_external_id: EXT, p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '01012340001', p_customer_name: 'TM고객', p_customer_real_name: 'TM고객',
      p_reservation_date: '2099-02-01', p_reservation_time: '14:00', p_created_via: 'dopamine',
    });
    expect(ins.error, ins.error?.message).toBeNull();
    let row = await rowByKey(sb, SRC, EXT);
    expect(row?.status).toBe('confirmed');
    // cancel
    const cancel = await callUpsert(sb, {
      p_source_system: SRC, p_external_id: EXT, p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '01012340001', p_customer_name: 'TM고객',
      p_reservation_date: '2099-02-01', p_reservation_time: '14:00', p_status: 'cancelled',
    });
    expect(cancel.error, cancel.error?.message).toBeNull();
    expect(cancel.data).toBe(row?.id);          // 동일 행 id 회신(신규 생성 아님)
    row = await rowByKey(sb, SRC, EXT);
    expect(row?.status).toBe('cancelled');      // 슬롯 release(뷰/카운터 제외)
  });

  test('S2 (a②) 이미 cancelled 재취소 = 성공 no-op', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();
    const before = await rowByKey(sb, SRC, EXT);
    const recancel = await callUpsert(sb, {
      p_source_system: SRC, p_external_id: EXT, p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '01012340001', p_customer_name: 'TM고객',
      p_reservation_date: '2099-02-01', p_reservation_time: '14:00', p_status: 'cancelled',
    });
    expect(recancel.error, recancel.error?.message).toBeNull();
    expect(recancel.data).toBe(before?.id);     // 동일 id, 예외 없음
    const after = await rowByKey(sb, SRC, EXT);
    expect(after?.status).toBe('cancelled');    // 불변
  });

  test('S3 (a② 가드) 다른 source(foot-native 모사) 행은 dopamine 취소에 불변 = split-brain 차단', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();
    // 다른 source_system 으로 동일 external_id 행 적재(unique=(source_system,external_id) → 공존)
    await callUpsert(sb, {
      p_source_system: SRC_NATIVE, p_external_id: EXT_GUARD, p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '01099990001', p_customer_name: 'foot네이티브',
      p_reservation_date: '2099-03-01', p_reservation_time: '11:00',
    });
    // SRC(self-mint) 로 cancel 호출 → SRC_NATIVE 행은 스코프 밖 → 불변
    const res = await callUpsert(sb, {
      p_source_system: SRC, p_external_id: EXT_GUARD, p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '01099990001', p_customer_name: 'foot네이티브',
      p_reservation_date: '2099-03-01', p_reservation_time: '11:00', p_status: 'cancelled',
    });
    expect(res.error, res.error?.message).toBeNull();
    const native = await rowByKey(sb, SRC_NATIVE, EXT_GUARD);
    expect(native?.status).toBe('confirmed');   // 타 source 행 절대 불변
  });

  test('S4 (a①) active 재푸시 = mutable(time·memo) idempotent UPDATE, 단일행 유지', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();
    const ext = `${CUE}-edit`;
    await callUpsert(sb, {
      p_source_system: SRC, p_external_id: ext, p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '01012340002', p_customer_name: '수정고객',
      p_reservation_date: '2099-04-01', p_reservation_time: '09:00', p_memo: '초기메모',
    });
    const first = await rowByKey(sb, SRC, ext);
    // 시간/메모 변경 재푸시
    await callUpsert(sb, {
      p_source_system: SRC, p_external_id: ext, p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '01012340002', p_customer_name: '수정고객',
      p_reservation_date: '2099-04-01', p_reservation_time: '16:30', p_memo: '시간변경됨',
    });
    const second = await rowByKey(sb, SRC, ext);
    expect(second?.id).toBe(first?.id);                 // 단일행 유지(중복 생성 아님)
    expect(second?.reservation_time).toMatch(/^16:30/); // mutable 갱신
    expect(second?.memo).toBe('시간변경됨');
    // (b) preserve-on-NULL: memo 미동봉 재푸시 → 기존 보존
    await callUpsert(sb, {
      p_source_system: SRC, p_external_id: ext, p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '01012340002', p_customer_name: '수정고객',
      p_reservation_date: '2099-04-01', p_reservation_time: '16:30',
    });
    const third = await rowByKey(sb, SRC, ext);
    expect(third?.memo).toBe('시간변경됨');             // NULL push 가 기존 메모 덮지 않음
    await sb.from('reservations').delete().eq('source_system', SRC).eq('external_id', ext);
  });

  test('S5 (a②) 취소 대상 부재 = no-op(신규행 생성 안 함, NULL 회신)', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();
    const res = await callUpsert(sb, {
      p_source_system: SRC, p_external_id: EXT_ABSENT, p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '01000000009', p_customer_name: '없음',
      p_reservation_date: '2099-05-01', p_reservation_time: '10:00', p_status: 'cancelled',
    });
    expect(res.error, res.error?.message).toBeNull();
    expect(res.data).toBeNull();                         // 취소할 것 없음
    const ghost = await rowByKey(sb, SRC, EXT_ABSENT);
    expect(ghost).toBeNull();                            // tombstone 신규생성 안 함
  });
});
