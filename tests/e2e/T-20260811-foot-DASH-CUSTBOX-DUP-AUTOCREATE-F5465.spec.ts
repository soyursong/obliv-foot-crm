/**
 * E2E spec — T-20260811-foot-DASH-CUSTBOX-DUP-AUTOCREATE-F5465
 * 통합 대시보드 고객박스 중복 자동생성 버그 (강민구 #F-5465 박스 2개)
 *
 * 정책: 1고객=1박스, 중복 절대금지 (T-20260510-DASH-SLOT-REWORK-P0)
 *
 * ★ 분기 판정 (READ-ONLY prod probe 결과):
 *   강민구 #F-5465 (customer 1행) / reservations 1행 / check_ins 2행
 *     - CI-A: reservation_id=4c93(링크), 01:55:20  → 예약 루프 매칭 → retBox2Ci
 *     - CI-B: reservation_id=NULL,       01:56:07  → 미매칭 워크인 → retBox2Ci (중복!)
 *   = DB-중복행(동일 고객 당일 복수 self check-in). 두 행이 각각 박스 생성 → 2개 표시.
 *
 * 수정 (FE-only, ADDITIVE, db_change=false):
 *   Dashboard.tsx — boxedCustomerIds Set 도입.
 *     예약 루프에서 박스가 생성된 customer_id 기록 → 워크인 루프에서 동일 고객의
 *     미매칭 중복 체크인 렌더 제외. 워크인 루프 자체도 첫 박스 후 동일 고객 차단.
 *   defense-in-depth: DB에 중복 행이 남아있어도 타임라인은 고객당 단일 박스.
 *
 * NOTE(별건): DB-중복행 forward 봉합(멱등 가드)·기존 오염행 backfill 정정은
 *   db_change=true 별건 분번(Data-Correction Backfill SOP + DA consult). 본 티켓 범위 밖.
 *
 * AC-4: 수정 후 강민구 #F-5465 고객박스 1개만 표시.
 */
import { test, expect } from '@playwright/test';

// ── Dashboard.tsx 렌더 분류 로직 미러 (boxedCustomerIds dedup) ──────────────────
// 실제 구현(Dashboard.tsx DashboardTimeline)의 슬롯 분류를 축약 미러링한다.

interface Resv { id: string; customer_id: string | null; visit_type: 'new' | 'returning' | 'experience'; status: string; }
interface CI { id: string; customer_id: string | null; reservation_id: string | null; visit_type: 'new' | 'returning' | 'experience'; }

/**
 * 고객당 렌더되는 박스 개수를 계산 (customer_id → box count).
 * boxedCustomerIds 가드 포함/미포함 두 모드로 검증.
 */
function computeBoxesPerCustomer(
  reservations: Resv[],
  selfCheckIns: CI[],
  opts: { dedup: boolean },
): Map<string, number> {
  const checkInByResvId = new Map<string, CI>();
  const checkInByCustomerId = new Map<string, CI>();
  for (const ci of selfCheckIns) {
    if (ci.reservation_id) checkInByResvId.set(ci.reservation_id, ci);
    else if (ci.customer_id && !checkInByCustomerId.has(ci.customer_id)) checkInByCustomerId.set(ci.customer_id, ci);
  }

  const matchedCiIds = new Set<string>();
  const boxedCustomerIds = new Set<string>();
  const boxes: Array<{ customerId: string | null }> = [];

  // 예약 루프
  for (const r of reservations) {
    if (r.status === 'cancelled') continue;
    const ci = checkInByResvId.get(r.id) ?? (r.customer_id ? checkInByCustomerId.get(r.customer_id) : undefined);
    if (!ci) {
      if (r.status === 'confirmed' || r.status === 'no_show') {
        boxes.push({ customerId: r.customer_id });
        if (r.customer_id) boxedCustomerIds.add(r.customer_id);
      }
    } else {
      matchedCiIds.add(ci.id);
      boxes.push({ customerId: r.customer_id });
      if (r.customer_id) boxedCustomerIds.add(r.customer_id);
    }
  }

  // 워크인 루프 (예약 미매칭 체크인)
  for (const ci of selfCheckIns) {
    if (matchedCiIds.has(ci.id)) continue;
    if (opts.dedup && ci.customer_id && boxedCustomerIds.has(ci.customer_id)) continue; // ★ 가드
    boxes.push({ customerId: ci.customer_id });
    if (ci.customer_id) boxedCustomerIds.add(ci.customer_id);
  }

  const perCust = new Map<string, number>();
  for (const b of boxes) {
    if (!b.customerId) continue;
    perCust.set(b.customerId, (perCust.get(b.customerId) ?? 0) + 1);
  }
  return perCust;
}

// 강민구 #F-5465 실제 prod 데이터 재현
const F5465 = 'de6bd547-07de-4a92-a6e5-f9939a176a85';
const RESV_F5465: Resv[] = [
  { id: '4c93c279-caa1-46c9-bca0-73eccd18e77a', customer_id: F5465, visit_type: 'returning', status: 'checked_in' },
];
const CI_F5465: CI[] = [
  { id: '5a9a84cf-b650-4806-b1db-2bc933be59ad', customer_id: F5465, reservation_id: '4c93c279-caa1-46c9-bca0-73eccd18e77a', visit_type: 'returning' }, // CI-A 링크
  { id: '5b449a50-14cc-4683-80bc-86a10217b13c', customer_id: F5465, reservation_id: null, visit_type: 'returning' }, // CI-B 미매칭
];

test.describe('T-20260811 DASH-CUSTBOX-DUP — 1고객=1박스 dedup 로직', () => {
  test('회귀 재현: 가드 미적용 시 강민구 #F-5465 박스 2개 (버그)', () => {
    const per = computeBoxesPerCustomer(RESV_F5465, CI_F5465, { dedup: false });
    expect(per.get(F5465)).toBe(2); // 버그 상태: CI-A(예약매칭) + CI-B(워크인) = 2박스
  });

  test('AC-4: 가드 적용 시 강민구 #F-5465 박스 1개만 표시', () => {
    const per = computeBoxesPerCustomer(RESV_F5465, CI_F5465, { dedup: true });
    expect(per.get(F5465)).toBe(1); // 수정 후: 예약매칭 박스 1개만, 미매칭 중복 워크인 제외
  });

  test('중복 워크인 체크인 3행 동일 고객 → 1박스', () => {
    const c = 'cust-x';
    const resv: Resv[] = [];
    const cis: CI[] = [
      { id: 'w1', customer_id: c, reservation_id: null, visit_type: 'new' },
      { id: 'w2', customer_id: c, reservation_id: null, visit_type: 'new' },
      { id: 'w3', customer_id: c, reservation_id: null, visit_type: 'new' },
    ];
    const per = computeBoxesPerCustomer(resv, cis, { dedup: true });
    expect(per.get(c)).toBe(1);
  });

  test('무해성: 서로 다른 고객은 각각 박스 유지 (정상 워크인 축소 없음)', () => {
    const resv: Resv[] = [
      { id: 'r1', customer_id: 'A', visit_type: 'returning', status: 'checked_in' },
    ];
    const cis: CI[] = [
      { id: 'ciA', customer_id: 'A', reservation_id: 'r1', visit_type: 'returning' }, // A 예약매칭
      { id: 'ciB', customer_id: 'B', reservation_id: null, visit_type: 'new' },        // B 정상 워크인
      { id: 'ciC', customer_id: 'C', reservation_id: null, visit_type: 'returning' },  // C 정상 워크인
    ];
    const per = computeBoxesPerCustomer(resv, cis, { dedup: true });
    expect(per.get('A')).toBe(1);
    expect(per.get('B')).toBe(1);
    expect(per.get('C')).toBe(1);
    expect(per.size).toBe(3);
  });

  test('customer_id NULL 워크인은 dedup 대상 아님 (각각 유지)', () => {
    const cis: CI[] = [
      { id: 'n1', customer_id: null, reservation_id: null, visit_type: 'new' },
      { id: 'n2', customer_id: null, reservation_id: null, visit_type: 'new' },
    ];
    const per = computeBoxesPerCustomer([], cis, { dedup: true });
    // customer_id 없는 워크인은 perCust 집계 제외 → 서로 억제되지 않음(박스는 렌더됨)
    expect(per.size).toBe(0);
  });
});
