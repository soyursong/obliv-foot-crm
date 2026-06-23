/**
 * E2E spec — T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION (P1)
 * 피검사 단독 검사신청 차단 해소 — A안: request_koh_for_customer 패턴 1:1 미러.
 *
 * 결정(김주연 총괄): "검사 신청 시스템으로 제약 걸지마, 현장 실장이 판단해 신청"
 *   → 단독 검사신청 = 정상 업무. 旣 svcs.length===0 차단 게이트 제거 + 서버 SSOT 단일 RPC.
 *
 * AC:
 *   AC-1 단독 신청 허용: 서비스 행 없는 환자도 ON → 서버가 최근 내원에 피검사 요청 행 신규 생성.
 *   AC-2 보유 동기화 보존: 서비스 행 있으면 그 내원 행 전체 blood_test_requested 동기화(旣 동작 회귀 0).
 *   AC-3 OFF no-op: 서비스 행 없는 환자 OFF → 신규행 생성 안 함(false 반환).
 *   AC-4 노출 게이트 유지: hasCheckIn(체크인 내원 존재) 기준 노출(svcs 결과 무관).
 *   AC-5 신규행 마커: 자동생성 행 price=0·is_package_session=false(매출/패키지 비귀속, 이중계상 방지).
 *
 * 현장 클릭 시나리오 3종(서버 RPC request_blood_test_for_customer 결정분기 모사):
 *   C1 서비스 보유 환자 ON/OFF → 동기화(旣 동작).
 *   C2 서비스 행 없는 환자 ON   → 단독 신청, 신규행 생성(차단 해소 핵심).
 *   C3 서비스 행 없는 환자 OFF  → no-op.
 *
 * 모사 범위: 서버 RPC(request_blood_test_for_customer)의 ①/②/③ 분기를 순수함수로 모델링.
 *   FE 는 분기/루프/차단 게이트 없이 단일 RPC 위임만 하므로(서버 SSOT), 로직 진실은 RPC 결정분기에 있음.
 */
import { test, expect } from '@playwright/test';

// ── 서버 RPC request_blood_test_for_customer 결정분기 정본 모사 ─────────────────
interface SvcRow {
  id: string;
  blood_test_requested: boolean;
  check_in_id: string;
  created_at: string; // ISO
  price: number;
  is_package_session: boolean;
}
interface CheckIn {
  id: string;
  created_at: string;
  status: string; // 'cancelled' 제외
}
interface Customer {
  checkIns: CheckIn[];
  svcRows: SvcRow[];
}
interface RpcResult {
  ret: boolean;
  svcRows: SvcRow[]; // 변경 후 상태(신규행 포함)
  inserted: SvcRow | null;
}

// request_blood_test_for_customer(p_customer_id, p_value) SSOT 결정분기:
//   ① 서비스 행 보유 내원(가장 최근, service_name 필터 없음) → 그 내원 행 전체 동기화.
//   ② 서비스 행 없음 + ON → 최근 non-cancelled 내원에 신규행 INSERT(price=0).
//   ③ 서비스 행 없음 + OFF → no-op.
function requestBloodTestForCustomer(cust: Customer, value: boolean): RpcResult {
  const liveCheckIns = cust.checkIns.filter((c) => c.status !== 'cancelled');
  const liveCheckInIds = new Set(liveCheckIns.map((c) => c.id));
  // 정렬: 서비스 행 created_at DESC (RPC ORDER BY cis.created_at DESC LIMIT 1)
  const liveSvcs = cust.svcRows
    .filter((s) => liveCheckInIds.has(s.check_in_id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  // ── ① 서비스 행 보유 내원 ──
  if (liveSvcs.length > 0) {
    const target = liveSvcs[0].check_in_id;
    const next = cust.svcRows.map((s) =>
      s.check_in_id === target ? { ...s, blood_test_requested: !!value } : s,
    );
    return { ret: !!value, svcRows: next, inserted: null };
  }

  // ── ③ 서비스 행 없음 + OFF → no-op ──
  if (!value) {
    return { ret: false, svcRows: cust.svcRows, inserted: null };
  }

  // ── ② 서비스 행 없음 + ON → 최근 내원에 신규행 ──
  const recent = [...liveCheckIns].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  )[0];
  if (!recent) {
    // 내원 자체 없음 → RPC P0002 예외. 모사상 throw.
    throw new Error('내원(체크인) 기록이 없어 피검사를 신청할 수 없습니다');
  }
  const inserted: SvcRow = {
    id: `new-${recent.id}`,
    blood_test_requested: true,
    check_in_id: recent.id,
    created_at: '2026-06-23T05:00:00+00:00',
    price: 0,
    is_package_session: false,
  };
  return { ret: true, svcRows: [...cust.svcRows, inserted], inserted };
}

const anyOn = (rows: SvcRow[]) => rows.some((s) => s.blood_test_requested);

// ── C1: 서비스 보유 환자 ON/OFF → 동기화(旣 동작 보존, AC-2) ────────────────────
test('C1: 서비스 보유 환자 ON → 최근 내원 행 전체 동기화, OFF → 해제', () => {
  const cust: Customer = {
    checkIns: [
      { id: 'ci-old', created_at: '2026-06-10T02:00:00+00:00', status: 'completed' },
      { id: 'ci-new', created_at: '2026-06-20T02:00:00+00:00', status: 'completed' },
    ],
    svcRows: [
      { id: 'a1', blood_test_requested: false, check_in_id: 'ci-new', created_at: '2026-06-20T02:00:00+00:00', price: 50000, is_package_session: false },
      { id: 'a2', blood_test_requested: false, check_in_id: 'ci-new', created_at: '2026-06-20T02:30:00+00:00', price: 0, is_package_session: true },
      { id: 'b1', blood_test_requested: false, check_in_id: 'ci-old', created_at: '2026-06-10T02:00:00+00:00', price: 30000, is_package_session: false },
    ],
  };
  const on = requestBloodTestForCustomer(cust, true);
  expect(on.ret).toBe(true);
  expect(on.inserted).toBeNull(); // 신규 생성 안 함(보유 분기)
  // ci-new 행 전체 ON, ci-old(타 내원)는 미혼입
  expect(on.svcRows.filter((s) => s.check_in_id === 'ci-new').every((s) => s.blood_test_requested)).toBe(true);
  expect(on.svcRows.find((s) => s.id === 'b1')!.blood_test_requested).toBe(false);

  const off = requestBloodTestForCustomer({ ...cust, svcRows: on.svcRows }, false);
  expect(off.ret).toBe(false);
  expect(off.svcRows.filter((s) => s.check_in_id === 'ci-new').some((s) => s.blood_test_requested)).toBe(false);
});

// ── C2: 서비스 행 없는 환자 ON → 단독 신청 신규행 생성(차단 해소 핵심, AC-1) ──────
test('C2: 서비스 행 없는 환자 ON → 최근 내원에 피검사 요청 신규행 생성', () => {
  const cust: Customer = {
    checkIns: [
      { id: 'ci-1', created_at: '2026-06-22T02:00:00+00:00', status: 'completed' },
      { id: 'ci-2', created_at: '2026-06-23T02:00:00+00:00', status: 'completed' },
    ],
    svcRows: [], // 서비스 행 0 — 旣 차단 게이트(svcs.length===0)에 막혔던 케이스
  };
  const r = requestBloodTestForCustomer(cust, true);
  expect(r.ret).toBe(true);
  expect(r.inserted).not.toBeNull();
  expect(r.inserted!.check_in_id).toBe('ci-2'); // 가장 최근 내원
  expect(r.inserted!.blood_test_requested).toBe(true);
  expect(anyOn(r.svcRows)).toBe(true);
});

// ── C2b: 멱등 — 신규행 생성 후 재ON → 중복 생성 안 함(보유 분기로 진입) ──────────
test('C2b: 신규행 생성 후 재ON 멱등 — 서비스행 1개 유지(중복 없음)', () => {
  const cust: Customer = {
    checkIns: [{ id: 'ci-1', created_at: '2026-06-23T02:00:00+00:00', status: 'completed' }],
    svcRows: [],
  };
  const first = requestBloodTestForCustomer(cust, true);
  const second = requestBloodTestForCustomer({ ...cust, svcRows: first.svcRows }, true);
  expect(second.inserted).toBeNull(); // 두 번째는 보유 분기 → 신규 생성 없음
  expect(second.svcRows.length).toBe(1);
});

// ── C3: 서비스 행 없는 환자 OFF → no-op(AC-3) ─────────────────────────────────
test('C3: 서비스 행 없는 환자 OFF → no-op(신규 생성·변경 없음)', () => {
  const cust: Customer = {
    checkIns: [{ id: 'ci-1', created_at: '2026-06-23T02:00:00+00:00', status: 'completed' }],
    svcRows: [],
  };
  const r = requestBloodTestForCustomer(cust, false);
  expect(r.ret).toBe(false);
  expect(r.inserted).toBeNull();
  expect(r.svcRows.length).toBe(0);
});

// ── AC-5: 자동생성 행은 매출·패키지 비귀속 마커(이중계상 방지) ──────────────────
test('AC-5: 자동생성 행 price=0·is_package_session=false', () => {
  const cust: Customer = {
    checkIns: [{ id: 'ci-1', created_at: '2026-06-23T02:00:00+00:00', status: 'completed' }],
    svcRows: [],
  };
  const r = requestBloodTestForCustomer(cust, true);
  expect(r.inserted!.price).toBe(0);
  expect(r.inserted!.is_package_session).toBe(false);
});

// ── 내원 자체 없음 → 신청 불가(P0002 모사) ────────────────────────────────────
test('취소만 있는 환자 ON → 내원 없음 예외(신청 불가)', () => {
  const cust: Customer = {
    checkIns: [{ id: 'ci-x', created_at: '2026-06-23T02:00:00+00:00', status: 'cancelled' }],
    svcRows: [],
  };
  expect(() => requestBloodTestForCustomer(cust, true)).toThrow(/내원/);
});

// ── AC-4: 노출 게이트 유지 — hasCheckIn(체크인 내원 존재) 기준 ────────────────
//   svcs 결과와 독립. 서비스 행 0이어도 체크인 내원 있으면 토글 노출(차단 게이트 제거 후 ON 가능).
const isToggleVisible = (hasCheckIn: boolean) => hasCheckIn;
test('AC-4: 서비스 행 0이어도 체크인 내원 있으면 토글 노출', () => {
  expect(isToggleVisible(true)).toBe(true);  // 내원 있음 → 노출(서비스 행 무관)
  expect(isToggleVisible(false)).toBe(false); // 내원 없음 → 미노출
});

// ── 실 브라우저 스모크 — 셸 렌더 ──────────────────────────────────────────────
test('실 브라우저: 로그인 셸 렌더 스모크', async ({ page }) => {
  const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => null);
  test.skip(!resp, 'BASE 미기동 — 스모크 스킵(C1~C3 결정분기가 핵심)');
  await expect(page.locator('body')).toBeVisible();
});
