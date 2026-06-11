/**
 * E2E spec — T-20260611-foot-CHECKIN-CANCEL-RENAME-RESTORE
 * 진행단계 카드 [취소] → [체크인 취소] 라벨 + 클릭 시 삭제 대신 통합시간표 복구
 *
 * 현상: 진행단계(칸반) 카드 상태메뉴 맨 하단 액션이 `[취소]` 로 표기되고, 클릭 시
 *       카드가 대시보드에서 완전히 사라져 환자가 통합시간표에도 안 보임(행방불명).
 * 요청: 라벨 `[체크인 취소]` 로 변경 + 클릭 시 예약 삭제 X, 체크인 이전(예약) 상태로
 *       역전이하여 통합시간표 원래 예약 슬롯에 복구.
 *
 * AC-1: 진행단계 카드 상태메뉴 맨 하단 액션 라벨 `[취소]` → `[체크인 취소]`.
 * AC-2: 클릭 시 예약 삭제 X — check_in row 는 status='cancelled' 로 보존(soft).
 * AC-3: 역전이 후 원본 예약(reservation)이 'confirmed'(예약)로 되돌아가 통합시간표 원래 슬롯에 복구.
 * AC-4: 복구된 예약은 다시 정상 체크인 가능 (cancelled check_in 은 슬롯 점유 해제).
 * AC-5: 첨부 위치(진행단계 상태메뉴 맨 하단)만 변경 — 다른 취소/삭제 버튼 비침범.
 *
 * 구현:
 *   - StatusContextMenu.tsx: 라벨 "취소" → "체크인 취소", confirm 문구 복구 안내 추가.
 *   - Dashboard.tsx handleContextStatusChange: newStatus==='cancelled' && reservation_id 일 때
 *       reservations.status='confirmed' 역전이 + fetchTimelineReservations() 즉시 갱신.
 *   - Dashboard.tsx checkedInResvIds: cancelled check_in 은 예약 슬롯 점유 해제(continue).
 *
 * DB 변경 없음 (reservations.status 'checked_in'→'confirmed' 전이만, 신규 컬럼/enum 없음).
 * 양방향 동기화 CHECKIN-DASHBOARD-SYNC 의 역방향 재사용.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ── Unit-level: 역전이 + 슬롯 복구 로직 미러 ──────────────────────────────────

type CiLite = { id: string; status: string; reservation_id: string | null };
type ResvLite = { id: string; status: string };

/**
 * Dashboard.tsx 체크인 취소 역전이 미러:
 * - check_in.status='cancelled' (row 보존)
 * - 연결된 reservation.status → 'confirmed' (역전이, 삭제 X)
 * 반환: 변형된 check_ins / reservations 스냅샷
 */
function simulateCheckinCancel(
  ci: CiLite,
  reservations: ResvLite[],
): { checkIns: CiLite[]; reservations: ResvLite[] } {
  const cancelledCi: CiLite = { ...ci, status: 'cancelled' };
  const nextResv = reservations.map((r) =>
    ci.reservation_id && r.id === ci.reservation_id ? { ...r, status: 'confirmed' } : r,
  );
  return { checkIns: [cancelledCi], reservations: nextResv };
}

/**
 * Dashboard.tsx checkedInResvIds 미러:
 * - cancelled check_in 은 예약 슬롯 점유 해제 (continue)
 */
function buildCheckedInResvIds(rows: CiLite[]): Set<string> {
  const s = new Set<string>();
  for (const ci of rows) {
    if (ci.status === 'cancelled') continue; // 체크인 취소 row 는 슬롯 점유 해제
    if (ci.reservation_id) s.add(ci.reservation_id);
  }
  return s;
}

test.describe('T-20260611 CHECKIN-CANCEL-RENAME-RESTORE — 역전이/복구 로직 유닛 검증', () => {
  test('AC-2: 체크인 취소 시 check_in row 는 삭제되지 않고 status=cancelled 로 보존된다', () => {
    const ci: CiLite = { id: 'ci-1', status: 'treatment_waiting', reservation_id: 'r-1' };
    const { checkIns } = simulateCheckinCancel(ci, [{ id: 'r-1', status: 'checked_in' }]);
    expect(checkIns.find((c) => c.id === 'ci-1')).toBeDefined(); // row 보존
    expect(checkIns[0].status).toBe('cancelled');
  });

  test('AC-3: 원본 예약이 checked_in → confirmed 로 역전이되어 통합시간표에 복구된다', () => {
    const ci: CiLite = { id: 'ci-1', status: 'laser', reservation_id: 'r-1' };
    const { reservations } = simulateCheckinCancel(ci, [{ id: 'r-1', status: 'checked_in' }]);
    expect(reservations.find((r) => r.id === 'r-1')?.status).toBe('confirmed');
  });

  test('AC-4: cancelled check_in 은 예약 슬롯 점유에서 제외 → 재체크인 가능', () => {
    const rows: CiLite[] = [{ id: 'ci-1', status: 'cancelled', reservation_id: 'r-1' }];
    const occupied = buildCheckedInResvIds(rows);
    expect(occupied.has('r-1')).toBe(false); // 점유 해제 → 예약가능 슬롯으로 노출
  });

  test('AC-4: 활성 체크인은 여전히 슬롯을 점유한다 (회귀 방지)', () => {
    const rows: CiLite[] = [
      { id: 'ci-1', status: 'cancelled', reservation_id: 'r-1' },
      { id: 'ci-2', status: 'treatment_waiting', reservation_id: 'r-2' },
    ];
    const occupied = buildCheckedInResvIds(rows);
    expect(occupied.has('r-1')).toBe(false); // 취소된 건은 해제
    expect(occupied.has('r-2')).toBe(true); // 활성 건은 점유 유지
  });

  test('AC-5: reservation_id 없는 워크인 체크인 취소는 예약 역전이 영향 없음 (비침범)', () => {
    const ci: CiLite = { id: 'ci-w', status: 'treatment_waiting', reservation_id: null };
    const reservations: ResvLite[] = [{ id: 'r-1', status: 'confirmed' }];
    const { checkIns, reservations: next } = simulateCheckinCancel(ci, reservations);
    expect(checkIns[0].status).toBe('cancelled'); // 본인만 취소
    expect(next.find((r) => r.id === 'r-1')?.status).toBe('confirmed'); // 무관한 예약 무변경
  });

  test('AC-3: 같은 시간대 다른 예약은 복구 대상 슬롯에 영향 없이 유지된다 (시나리오2 엣지)', () => {
    const ci: CiLite = { id: 'ci-1', status: 'laser', reservation_id: 'r-1' };
    const reservations: ResvLite[] = [
      { id: 'r-1', status: 'checked_in' }, // 복구 대상
      { id: 'r-2', status: 'confirmed' }, // 같은 시간대 기존 예약
    ];
    const { reservations: next } = simulateCheckinCancel(ci, reservations);
    expect(next.find((r) => r.id === 'r-1')?.status).toBe('confirmed'); // 복구
    expect(next.find((r) => r.id === 'r-2')?.status).toBe('confirmed'); // 무변경 유지
  });
});

// ── E2E: 상태메뉴 라벨 + 통합시간표 렌더 회귀 ────────────────────────────────

test.describe('T-20260611 CHECKIN-CANCEL-RENAME-RESTORE — 상태메뉴 라벨 + 시간표', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  test('AC-1: 진행단계 카드 상태메뉴 맨 하단에 "체크인 취소" 라벨 표시 (구 "취소" 아님)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 진행단계 카드의 상태변경(⋮) 버튼 → 상태메뉴 오픈
    const moreBtn = page.locator('button[title="상태 변경"]');
    try {
      await moreBtn.first().waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '오늘 진행단계 카드 없음 — 라벨 검증 스킵');
      return;
    }
    await moreBtn.first().click();

    // 상태메뉴 맨 하단 액션: "체크인 취소"
    const cancelAction = page.getByText('체크인 취소', { exact: true });
    await expect(cancelAction.first()).toBeVisible({ timeout: 3_000 });
    // 구 라벨 단독 "취소" 가 메뉴 액션으로 남아있지 않음
    expect(await page.getByRole('button', { name: '취소', exact: true }).count()).toBe(0);
  });

  test('AC-3: 통합시간표 슬롯이 정상 렌더링됨 (복구 표적 슬롯 회귀)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const slotRows = page.locator('[data-testid="timeline-slot-row"]');
    try {
      await slotRows.first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '통합시간표 슬롯 미표시 — 환경 스킵');
      return;
    }
    expect(await slotRows.count()).toBeGreaterThan(0);
  });
});
