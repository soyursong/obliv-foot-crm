/**
 * E2E — T-20260715-foot-RESVDETAIL-CUSTMEMO-C2Z1-SYNC
 * 예약상세 팝업 [고객메모] ↔ 2번차트 1구역 [고객메모] 양방향 연동 (버그 수정)
 *
 * 근본원인: 두 [고객메모] UI가 서로 다른 customers 컬럼에 바인딩되어 sync 안 됨.
 *   - 예약팝업(ReservationDetailPopup): customers.customer_memo (write)
 *   - 2번차트 1구역(CustomerChartPage): customers.customer_note (write)
 * 수정: 예약팝업을 customer_note로 수렴(read-fallback customer_note ?? customer_memo).
 *   customer_memo는 3구역 예약메모 히스토리(customer_reservation_memos) seed 원본 → 미변경 보존.
 *
 * 검증 포인트:
 * AC-0: 축=고객 단위(customer_note). 양 surface가 동일 컬럼(customer_note) 참조 — 소스 정적 확인.
 * AC-1: 양방향 반영 — customer_note 한쪽 저장 → 재조회 시 동일값 (service-role DB 왕복).
 * AC-2: 경쟁 3번째 sync 경로 없음 — 두 surface 모두 write=customer_note, read-fallback 동일.
 * AC-3: 예약메모 히스토리 seed 무회귀 — CustomerChartPage migrationContent=customer_memo 유지.
 * AC-4: 회귀 — 예약팝업이 더 이상 customer_memo를 write하지 않음(3구역 seed 오염 차단).
 *
 * 비파괴: 대상 고객의 customer_note 원본 저장 → 종료 후 복원.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

test.describe('T-20260715-foot-RESVDETAIL-CUSTMEMO-C2Z1-SYNC — 고객메모 양방향 연동', () => {
  let customerId: string;
  let origNote: string | null = null;

  test.beforeAll(async () => {
    const { data: customers } = await service
      .from('customers')
      .select('id, customer_note')
      .limit(1);
    if (!customers?.length) throw new Error('픽스처: 고객 없음');
    customerId = customers[0].id;
    origNote = (customers[0] as { customer_note: string | null }).customer_note ?? null;
  });

  test.afterAll(async () => {
    if (customerId) {
      await service.from('customers').update({ customer_note: origNote }).eq('id', customerId);
    }
  });

  // ── AC-1: 양방향 반영 — 동일 컬럼(customer_note) 저장→재조회 동일값 ─────────
  test('AC-1: customer_note 저장 → 재조회 동일값 (양방향 공유 컬럼)', async () => {
    const marker = '[E2E] CUSTMEMO-SYNC 양방향 검증 A';
    const { error: upErr } = await service
      .from('customers')
      .update({ customer_note: marker })
      .eq('id', customerId);
    expect(upErr).toBeNull();

    const { data, error } = await service
      .from('customers')
      .select('customer_note')
      .eq('id', customerId)
      .single();
    expect(error).toBeNull();
    // 예약팝업/2번차트 모두 이 컬럼을 read → 재오픈 시 동일값
    expect((data as { customer_note: string }).customer_note).toBe(marker);
  });

  // ── AC-0 / AC-2: 두 surface가 동일 컬럼(customer_note) 참조·write ──────────
  test('AC-0/AC-2: 예약팝업·2번차트 모두 customer_note로 수렴 (경쟁 경로 없음)', async () => {
    const popup = fs.readFileSync('src/components/ReservationDetailPopup.tsx', 'utf-8');
    const chart = fs.readFileSync('src/pages/CustomerChartPage.tsx', 'utf-8');

    // read: 양쪽 모두 customer_note 우선 + customer_memo fallback
    expect(popup).toMatch(/customer_note\s*\?\?\s*.*customer_memo/);
    expect(chart).toMatch(/customer_note\s*\?\?\s*.*customer_memo/);

    // write: 예약팝업 저장이 customer_note 대상 (customer_memo 아님)
    expect(popup).toMatch(/\.update\(\{\s*customer_note:/);
    // 2번차트 write도 customer_note (patch.customer_note)
    expect(chart).toMatch(/patch\.customer_note\s*=/);
  });

  // ── AC-3: 예약메모 히스토리 seed 무회귀 (customer_memo가 여전히 seed 원본) ──
  test('AC-3: 3구역 예약메모 히스토리 seed = customer_memo 유지 (무회귀)', async () => {
    const chart = fs.readFileSync('src/pages/CustomerChartPage.tsx', 'utf-8');
    // useMemoHistory(reservation) migrationContent 는 customer_memo 로 유지되어야 함
    expect(chart).toMatch(/migrationContent:\s*customer\?\.customer_memo/);
  });

  // ── AC-4: 예약팝업이 customer_memo를 write하지 않음 (seed 오염 차단) ────────
  test('AC-4: 예약팝업 saveCustomerMemo가 customer_memo를 write하지 않음', async () => {
    const popup = fs.readFileSync('src/components/ReservationDetailPopup.tsx', 'utf-8');
    // .update({ customer_memo: ... }) 형태가 남아있지 않아야 함
    expect(popup).not.toMatch(/\.update\(\{\s*customer_memo:/);
  });

  // ── AC-1'(5-surface): 체크인·고객목록/편집·신규등록도 customer_note로 수렴 ──
  //   현장 confirm 스펙(§196): 예약창·차트·체크인·고객목록·신규등록 5개 화면 [고객메모]
  //   단일 저장소(customer_note) 통합. read-fallback(customer_note ?? customer_memo) + write=customer_note.
  test('AC-1\': 체크인(CheckInDetailSheet) 고객메모 = customer_note 수렴', async () => {
    const checkin = fs.readFileSync('src/components/CheckInDetailSheet.tsx', 'utf-8');
    // read: customer_note 우선 + customer_memo fallback (양쪽 read 경로)
    expect(checkin).toMatch(/customer_note\s*\?\?\s*.*customer_memo/);
    // write: appendCustomerMemo가 customer_note로 저장 (customer_memo 아님)
    expect(checkin).toMatch(/\.update\(\{\s*customer_note:\s*newValue\s*\}\)/);
    // customer_memo write 잔존 없음 (3구역 seed 오염 차단)
    expect(checkin).not.toMatch(/\.update\(\{\s*customer_memo:/);
    // select에 customer_note 포함 (read 가능)
    expect(checkin).toMatch(/customer_memo,\s*customer_note/);
  });

  test('AC-1\': 고객목록/편집·신규등록(Customers.tsx) 고객메모 = customer_note 수렴', async () => {
    const customers = fs.readFileSync('src/pages/Customers.tsx', 'utf-8');
    // EditCustomerDialog read: fallback
    expect(customers).toMatch(/customer_note\s*\?\?\s*customer\.customer_memo/);
    // 편집 저장·신규 등록 모두 customer_note로 write (customer_memo write 잔존 없음)
    expect(customers).not.toMatch(/customer_memo:\s*customerMemo\.trim/);
    expect(customers).not.toMatch(/customer_memo:\s*memo\.trim/);
    expect(customers).toMatch(/customer_note:\s*customerMemo\.trim/);
    expect(customers).toMatch(/customer_note:\s*memo\.trim/);
  });

  // ── AC-1'(런타임): customer_note 단일 저장소 → 5개 surface 공유 값 왕복 ──────
  test('AC-1\': customer_note 저장 → 재조회 동일값 (5-surface 공유 컬럼 런타임)', async () => {
    const marker = '[E2E] 5-SURFACE-SYNC 통합 검증';
    const { error: upErr } = await service
      .from('customers')
      .update({ customer_note: marker })
      .eq('id', customerId);
    expect(upErr).toBeNull();
    const { data } = await service
      .from('customers')
      .select('customer_note, customer_memo')
      .eq('id', customerId)
      .single();
    // 5개 surface 모두 이 컬럼 read → 동일값. customer_memo(seed)는 별도 보존.
    expect((data as { customer_note: string }).customer_note).toBe(marker);
  });
});
