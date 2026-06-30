/**
 * T-20260630-foot-COMPANION-RESV-INSERT-FAIL — AC-3 동행(companion) 영속 통합 E2E
 *
 * 부모: T-20260630-dopamine-FOOT-COMPANION-RESV-SAVE-FAIL (origin=dopamine).
 * 근거: cross_crm_data_contract §4-1/§4-2/§4-2b/§441~447 + DA-20260630-FOOT-COMPANION-EXTID-TEXT.
 *
 * ── 왜 service-role DB 통합 spec 인가 ────────────────────────────────────────
 *   AC-1 격리(dd1a075d): foot 네이티브 예약화면은 동행 UI 자체가 없다 — 동행 인입 경로 =
 *   도파민 push → ingest EF / `upsert_reservation_from_source` RPC(계약 표준 진입점).
 *   따라서 동행 영속(AC-3)의 결정론적 검증 대상 = DB 합본 마이그(external_id TEXT + customer_real_name
 *   + RPC 17-arg companion 분기). EF 는 동일 스키마 위에서 같은 착지(customer_id=NULL + customer_real_name)
 *   를 수행하므로 RPC 경로 검증이 곧 스키마-계약 게이트 검증이다.
 *   (EF 직접 호출은 X-Callback-Secret 필요 → 본 환경 미보유, 별도 supervisor 배포검증에서 커버.)
 *
 * ── 격리 ─────────────────────────────────────────────────────────────────────
 *   source_system='e2e-foot-companion' 마커로 prod 'dopamine' 행과 완전 격리(트리거
 *   enqueue_dopamine_callback 은 source_system='dopamine' 에만 발화 → 본 테스트 무영향).
 *   before/after 전수 purge.
 *
 * 커버 시나리오:
 *   S1 (동행 정상동선·영속·AC-3): is_companion=true + composite external_id(text) + 무폰 + 동행명
 *        → reservation 영속, customer_id IS NULL, customer_real_name=동행명. (22P02·42703 회귀 0)
 *   S2 (비동행 회귀 0): is_companion 미동봉 → customer_id IS NOT NULL(customers 링크 유지).
 *   S3 (8-arg 후방호환): companion 인자 미동봉(base 8 필드만) → 정상 영속(17-arg trailing DEFAULT).
 *   S4 (무음실패 차단·AC-2 동류): source_system=NULL → RPC 정직 에러(22023). silent success 아님.
 *
 * 사전조건(graceful skip): 합본 마이그 미적용 환경(customer_real_name 부재 / external_id=uuid /
 *   RPC 8-arg)에서는 PostgREST 가 함수/컬럼 미해석 → 명시 skip(배포 前 GREEN-or-SKIP).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SRC = 'e2e-foot-companion';                       // prod 'dopamine' 과 격리된 테스트 마커
const CLINIC_SLUG = 'jongno-foot';
const CUE = 'a1b2c3d4-0000-4000-8000-00000000e2e0';     // 테스트용 가상 cue_card UUID
const EXT_COMPANION = `${CUE}#companion-1`;              // composite external_id(text) — 旣 22P02 거부 대상
const EXT_MAIN = `${CUE}-main`;                          // 비동행(text, non-uuid 도 TEXT 라 수용)
const EXT_BASE8 = `${CUE}-base8`;

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function purge() {
  if (!SERVICE_KEY) return;
  await admin().from('reservations').delete().eq('source_system', SRC);
}

/** 합본 마이그 적용 여부 탐지(customer_real_name 컬럼 + RPC companion 인자). 미적용 → skip 사유 반환. */
async function migrationReady(): Promise<string | null> {
  if (!SERVICE_KEY) return 'SERVICE_ROLE_KEY 부재 — DB 통합 검증 skip';
  const sb = admin();
  // customer_real_name 컬럼 존재? (없으면 42703)
  const { error: colErr } = await sb.from('reservations').select('customer_real_name').limit(1);
  if (colErr && /customer_real_name/.test(colErr.message)) {
    return `customer_real_name 컬럼 부재(합본 마이그 미적용): ${colErr.message}`;
  }
  return null;
}

const D = '2026-12-01';
const T = '10:00:00';

test.describe('T-20260630-foot-COMPANION-RESV-INSERT-FAIL 동행 영속(AC-3)', () => {
  test.beforeAll(purge);
  test.afterAll(purge);

  test('S1 동행: is_companion=true + composite external_id(text) + 무폰 → customer_id NULL + customer_real_name 착지', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();

    // 동행 push (RPC 표준 진입점). 무폰(p_customer_phone=null), composite external_id(text).
    const { data: rid, error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_COMPANION,                 // ← 旣 external_id=uuid 시 22P02. TEXT 전환으로 수용.
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: null,                        // 동행 무폰 수용
      p_customer_name: '동행루루',
      p_reservation_date: D,
      p_reservation_time: T,
      p_customer_real_name: '동행루루',
      p_is_companion: true,
    });
    // 함수 미해석(PGRST202 = RPC 8-arg) 이면 마이그 미적용 → skip
    if (error && /companion|PGRST202|function|schema cache/i.test(error.message)) {
      test.skip(true, `RPC companion 인자 미해석(마이그 미적용): ${error.message}`);
    }
    expect(error, `동행 RPC 영속 실패(22P02 등): ${error?.message ?? ''}`).toBeNull();
    expect(rid).toBeTruthy();

    // 영속 검증: customer_id IS NULL(§444/§52) + customer_real_name(동행명) 착지 + external_id composite text.
    const { data: row, error: selErr } = await sb
      .from('reservations')
      .select('id, customer_id, customer_real_name, external_id, source_system')
      .eq('source_system', SRC)
      .eq('external_id', EXT_COMPANION)
      .maybeSingle();
    expect(selErr).toBeNull();
    expect(row, '동행 예약 미영속(무음실패)').toBeTruthy();
    expect(row!.customer_id, '동행은 customer_id NULL 이어야 함(§444)').toBeNull();
    expect(row!.customer_real_name).toBe('동행루루');
    expect(row!.external_id).toBe(EXT_COMPANION);     // composite text 무손실 영속
  });

  test('S2 비동행 회귀 0: is_companion 미동봉 → customer_id IS NOT NULL(customers 링크 유지)', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();

    const { data: rid, error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_MAIN,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '+821099998888',
      p_customer_name: '[E2E]본예약환자',
      p_reservation_date: D,
      p_reservation_time: '11:00:00',
    });
    if (error && /PGRST202|function|schema cache/i.test(error.message)) {
      test.skip(true, `RPC 미해석(마이그 미적용): ${error.message}`);
    }
    expect(error, error?.message ?? '').toBeNull();
    expect(rid).toBeTruthy();

    const { data: row } = await sb
      .from('reservations')
      .select('customer_id')
      .eq('source_system', SRC)
      .eq('external_id', EXT_MAIN)
      .maybeSingle();
    expect(row?.customer_id, '비동행은 customers 링크(customer_id 비-NULL) 유지').toBeTruthy();
  });

  test('S3 8-arg 후방호환: companion 인자 미동봉(base 필드만) → 정상 영속', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();

    const { data: rid, error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_BASE8,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '+821077776666',
      p_customer_name: '[E2E]후방호환',
      p_reservation_date: D,
      p_reservation_time: '12:00:00',
      p_memo: 'base-8 backward-compat',
    });
    if (error && /PGRST202|function|schema cache/i.test(error.message)) {
      test.skip(true, `RPC 미해석(마이그 미적용): ${error.message}`);
    }
    expect(error, error?.message ?? '').toBeNull();
    expect(rid).toBeTruthy();
  });

  test('S4 무음실패 차단(AC-2 동류): source_system=NULL → RPC 정직 에러(silent success 아님)', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();

    const { data: rid, error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: null,                        // 멱등키 누락 → 22023 RAISE
      p_external_id: `${CUE}-bad`,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '+821000000001',
      p_customer_name: '[E2E]무음실패차단',
      p_reservation_date: D,
      p_reservation_time: '13:00:00',
    });
    // PostgREST 함수 미해석(마이그 미적용)과 실제 RPC RAISE 를 구분
    if (error && /PGRST202|schema cache/i.test(error.message)) {
      test.skip(true, `RPC 미해석(마이그 미적용): ${error.message}`);
    }
    expect(error, 'NULL source_system 은 정직 에러여야 함(무음 성공 금지)').not.toBeNull();
    expect(rid ?? null).toBeNull();
  });
});
