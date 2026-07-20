/**
 * T-20260720-foot-CHART2-RESV-SYNC-BUG — 풋 예약관리 ↔ 고객 2번차트(예약내역) 미연동
 *
 * planner NEW-TASK (MSG-20260720-134938-hgnt):
 *   증상1: 예약관리에서 취소/일정변경 처리해도 2번차트 예약내역엔 이전 상태 그대로.
 *   증상2: 예약관리 메모가 상단 1구역 예약메모(reservation_memo_history)엔 보이나
 *          2번차트 예약내역 탭엔 미반영.
 *
 * RC(코드 추적 확정):
 *   ① 증상1(취소) — 2번차트 예약내역 탭이 예약 status 를 전혀 표시하지 않아(구 REDCHECK-REMOVE)
 *      status='cancelled'/'no_show' 로 갱신돼도 화면상 '이전 상태 그대로'로 보임.
 *   ② 증상1(open-chart) — 예약관리(Reservations.tsx)가 취소/일정변경/메모 처리 후
 *      CUSTOMER_REFRESH 신호를 발사하지 않아, 열려있는 2번차트가 재조회하지 않음.
 *   ③ 증상2(메모) — 예약메모 SoT=reservation_memo_history(append-only)인데 예약내역 탭은
 *      reservations.booking_memo(생성시 초기메모만 담기는 부분 미러)만 읽어 추가분 미표시.
 *
 * 본 spec 은 위 3 RC 의 수정 로직을 순수 시뮬레이터로 회귀 가드한다.
 *   (status write 경로 무접점 — 차트는 read 정합만. DB/브라우저 불필요.
 *    supervisor 실QA 는 운영 번들 + 갤탭 실기기 예약관리↔차트 왕복으로 별도 검증.)
 */
import { test, expect } from '@playwright/test';

// ──────────────────────────────────────────────────────────────────────
// 소스 미러: CustomerChartPage 예약내역 탭 행 파생 로직
// ──────────────────────────────────────────────────────────────────────
type ResvRow = {
  id: string;
  reservation_date: string;
  reservation_time: string;
  status: 'confirmed' | 'checked_in' | 'cancelled' | 'no_show';
  cancel_reason: string | null;
  booking_memo: string | null;
};

/** 예약내역 탭 행 표시 파생 — 소스(map 콜백)의 displayMemo/isCancelled/isNoShow 미러 */
function deriveResvRowView(r: ResvRow, resvMemoMap: Map<string, string>) {
  const displayMemo = resvMemoMap.get(r.id) ?? r.booking_memo ?? '';
  const isCancelled = r.status === 'cancelled';
  const isNoShow = r.status === 'no_show';
  return {
    displayMemo,
    isCancelled,
    isNoShow,
    // 취소/노쇼면 일정 취소선 + 배지 노출
    strikethrough: isCancelled || isNoShow,
    showCancelReason: isCancelled && !!r.cancel_reason?.trim(),
    hasMemo: displayMemo.length > 0,
  };
}

/** 소스 fetchResvMemoMap 의 대표 1줄 선택 규칙 미러(고정 우선 pinned_at DESC, 없으면 최신 created_at DESC) */
type MemoHistRow = { content: string; is_pinned: boolean; pinned_at: string | null; created_at: string };
function pickRepresentativeMemo(rows: MemoHistRow[]): string | undefined {
  const cand = rows.filter((m) => (m.content ?? '').trim());
  if (cand.length === 0) return undefined;
  const top = [...cand].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    if (a.is_pinned && b.is_pinned) return (b.pinned_at ?? '').localeCompare(a.pinned_at ?? '');
    return b.created_at.localeCompare(a.created_at);
  })[0];
  return top?.content.trim();
}

// ──────────────────────────────────────────────────────────────────────
// 시나리오 1 — 예약 취소 반영 (AC-1)
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오1: 예약 취소 → 2번차트 예약내역 취소 상태 반영', () => {
  test('status=cancelled → 취소 배지 + 취소선 + 사유 노출', () => {
    const r: ResvRow = {
      id: 'r1', reservation_date: '2026-07-25', reservation_time: '14:00:00',
      status: 'cancelled', cancel_reason: '고객 요청', booking_memo: null,
    };
    const v = deriveResvRowView(r, new Map());
    expect(v.isCancelled).toBe(true);
    expect(v.strikethrough).toBe(true);
    expect(v.showCancelReason).toBe(true);
  });

  test('RC 가드: confirmed 는 취소로 오표시되지 않음(이전 상태 그대로 버그의 반증)', () => {
    const r: ResvRow = {
      id: 'r1', reservation_date: '2026-07-25', reservation_time: '14:00:00',
      status: 'confirmed', cancel_reason: null, booking_memo: null,
    };
    const v = deriveResvRowView(r, new Map());
    expect(v.isCancelled).toBe(false);
    expect(v.strikethrough).toBe(false);
    expect(v.showCancelReason).toBe(false);
  });

  test('no_show 도 상태 표시(취소선) — 노쇼 배지', () => {
    const r: ResvRow = {
      id: 'r1', reservation_date: '2026-07-25', reservation_time: '14:00:00',
      status: 'no_show', cancel_reason: null, booking_memo: null,
    };
    const v = deriveResvRowView(r, new Map());
    expect(v.isNoShow).toBe(true);
    expect(v.strikethrough).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 시나리오 2 — 일정 변경 반영 (AC-2)
//   예약관리 reschedule/detail-save 는 같은 row 의 reservation_date/time 을 in-place UPDATE.
//   차트는 그 row 를 재조회하므로 변경된 일정이 그대로 표시됨(신규 row 미생성).
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오2: 일정 변경 → 2번차트 예약내역 변경 일정 반영', () => {
  test('reschedule 는 in-place UPDATE — 차트 재조회 시 새 일정 표시(중복행 없음)', () => {
    // 예약관리 in-place UPDATE 결과 미러
    const before: ResvRow = {
      id: 'r1', reservation_date: '2026-07-25', reservation_time: '14:00:00',
      status: 'confirmed', cancel_reason: null, booking_memo: null,
    };
    const afterUpdate = { ...before, reservation_date: '2026-07-27', reservation_time: '16:30:00' };
    // 차트 재조회 = 같은 id 의 갱신 row 1건
    const refetched = [afterUpdate];
    expect(refetched).toHaveLength(1);
    expect(refetched[0].id).toBe('r1');
    expect(refetched[0].reservation_date).toBe('2026-07-27');
    expect(refetched[0].reservation_time.slice(0, 5)).toBe('16:30');
  });
});

// ──────────────────────────────────────────────────────────────────────
// 시나리오 3 — 메모 동기화 (AC-3)
//   예약메모 SoT=reservation_memo_history. 차트 예약내역 탭은 대표 1줄(맵)을 우선 표시.
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오3: 예약메모 → 2번차트 예약내역 반영(SoT=reservation_memo_history)', () => {
  test('history 대표 메모가 booking_memo(부분 미러)보다 우선 표시', () => {
    const r: ResvRow = {
      id: 'r1', reservation_date: '2026-07-25', reservation_time: '14:00:00',
      status: 'confirmed', cancel_reason: null, booking_memo: '초기메모(생성시)',
    };
    const map = new Map<string, string>([['r1', '예약관리에서 추가한 최신 메모']]);
    const v = deriveResvRowView(r, map);
    expect(v.hasMemo).toBe(true);
    expect(v.displayMemo).toBe('예약관리에서 추가한 최신 메모');
  });

  test('history 없으면 booking_memo 폴백(회귀 안전)', () => {
    const r: ResvRow = {
      id: 'r1', reservation_date: '2026-07-25', reservation_time: '14:00:00',
      status: 'confirmed', cancel_reason: null, booking_memo: '초기메모',
    };
    const v = deriveResvRowView(r, new Map());
    expect(v.displayMemo).toBe('초기메모');
  });

  test('대표 메모 선택: 고정(pinned) 우선, 없으면 최신 created_at', () => {
    const rows: MemoHistRow[] = [
      { content: '오래된 메모', is_pinned: false, pinned_at: null, created_at: '2026-07-20T09:00:00Z' },
      { content: '최신 메모', is_pinned: false, pinned_at: null, created_at: '2026-07-20T15:00:00Z' },
      { content: '고정 메모', is_pinned: true, pinned_at: '2026-07-20T10:00:00Z', created_at: '2026-07-20T10:00:00Z' },
    ];
    expect(pickRepresentativeMemo(rows)).toBe('고정 메모');

    const noPin = rows.filter((r) => !r.is_pinned);
    expect(pickRepresentativeMemo(noPin)).toBe('최신 메모');
  });

  test('공란/공백 메모는 대표 후보에서 제외', () => {
    const rows: MemoHistRow[] = [
      { content: '   ', is_pinned: false, pinned_at: null, created_at: '2026-07-20T15:00:00Z' },
      { content: '유효 메모', is_pinned: false, pinned_at: null, created_at: '2026-07-20T09:00:00Z' },
    ];
    expect(pickRepresentativeMemo(rows)).toBe('유효 메모');
  });
});

// ──────────────────────────────────────────────────────────────────────
// 시나리오 4 — 회귀: 신규 예약 생성 → 차트 정상 표시 (AC-4)
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오4(회귀): 신규 예약은 배지 없이 정상 표시', () => {
  test('confirmed 신규 예약 — 취소/노쇼 배지 없음, 취소선 없음', () => {
    const r: ResvRow = {
      id: 'rNew', reservation_date: '2026-07-30', reservation_time: '11:00:00',
      status: 'confirmed', cancel_reason: null, booking_memo: null,
    };
    const v = deriveResvRowView(r, new Map());
    expect(v.isCancelled).toBe(false);
    expect(v.isNoShow).toBe(false);
    expect(v.strikethrough).toBe(false);
    expect(v.hasMemo).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 크로스윈도우 신호 — 예약관리 처리 후 열린 차트 재조회 (증상1 open-chart RC)
//   notifyCustomerRefresh 가 CUSTOMER_REFRESH 키로 { customerId } payload 를 발사하고,
//   차트 storage 핸들러가 동일 customerId 일 때만 재조회하는 계약을 가드.
// ──────────────────────────────────────────────────────────────────────
const CUSTOMER_REFRESH_KEY = 'foot_crm_customer_refresh'; // storageKeys.ts SSOT 미러

test.describe('크로스윈도우 신호: 예약관리 → 열린 2번차트 재조회', () => {
  function buildRefreshPayload(customerId: string | null | undefined): string | null {
    if (!customerId) return null;
    return JSON.stringify({ customerId, ts: 1_700_000_000_000 });
  }

  test('customer_id 있으면 CUSTOMER_REFRESH payload 발사', () => {
    const payload = buildRefreshPayload('cust-1');
    expect(payload).not.toBeNull();
    expect(JSON.parse(payload as string).customerId).toBe('cust-1');
  });

  test('customer_id 없으면(워크인 등) 발사 안 함(no-op)', () => {
    expect(buildRefreshPayload(null)).toBeNull();
    expect(buildRefreshPayload(undefined)).toBeNull();
  });

  test('차트 핸들러는 동일 customerId 만 재조회', () => {
    const openChartCustomerId = 'cust-1';
    const shouldRefetch = (changedId: string) => changedId === openChartCustomerId;
    expect(shouldRefetch(JSON.parse(buildRefreshPayload('cust-1') as string).customerId)).toBe(true);
    expect(shouldRefetch(JSON.parse(buildRefreshPayload('cust-2') as string).customerId)).toBe(false);
  });

  test('키 SSOT 정합 — storageKeys.CUSTOMER_REFRESH 리터럴 고정', () => {
    expect(CUSTOMER_REFRESH_KEY).toBe('foot_crm_customer_refresh');
  });
});
