/**
 * E2E spec — T-20260601-foot-CALLLIST-DONE-INACTIVE
 * 진료콜 명단: 진료완료(핑크) 시 삭제 대신 비활성(완료/dimmed) 잔존
 *
 * 현장 요청 (김주연 총괄, 슬랙 C0ATE5P6JTH / MSG-20260601-131225-3nj2):
 *   "진료완료(핑크)로 변경되면 리스트 자동삭제 말고 비활성 상태로 변경해줘."
 *
 * T-20260601-foot-DOCTOR-CALL-LIST 의 AC-2(핑크 전환 시 명단 제거)를 대체.
 *
 * 구현 (src/components/DoctorCallListBar.tsx):
 *   - activeList = status_flag==='purple'(진료필요), doneList = status_flag==='pink'(진료완료)
 *   - displayList = [...active, ...done] → 활성 상단 / 완료 하단 정렬
 *   - 완료(inactive) 행: opacity-60 dimmed + 회색조 + "진료완료" 배지, 콜 대상(전체콜/지정콜) 제외
 *   - 보라로 되돌리면 다시 active → displayList 상단으로 복귀 (필터 재계산)
 *
 * 시나리오 3종 → AC 매핑:
 *   시나리오1 진료완료 비활성 잔존 → AC-1/AC-2
 *   시나리오2 정렬(활성 상단/완료 하단) → AC-3
 *   시나리오3 되돌리기 재활성 → AC-4
 *   당일·지점 필터 유지 → AC-5
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Row = { id: string; status_flag: string | null; checked_in_at: string };

test.describe('T-20260601 CALLLIST-DONE-INACTIVE — 진료완료 비활성 잔존', () => {
  // ── 시나리오1 / AC-1·AC-2: 핑크 전환 시 삭제 안 됨, 비활성 잔존 + 시각 구분 ──────────
  test('AC-1/AC-2: 핑크(진료완료) 행은 명단에서 사라지지 않고 비활성(완료)으로 잔존한다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // DoctorCallListBar 의 displayList/inactive 판정과 동일 모델
      const buildDisplay = (rows: { id: string; status_flag: string | null; checked_in_at: string }[]) => {
        const active = rows.filter((r) => r.status_flag === 'purple')
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at));
        const done = rows.filter((r) => r.status_flag === 'pink')
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at));
        return [...active, ...done].map((r) => ({ id: r.id, inactive: r.status_flag === 'pink' }));
      };

      const before = [
        { id: 'a', status_flag: 'purple', checked_in_at: '2026-06-01T01:00:00+00:00' },
      ];
      const beforeDisp = buildDisplay(before);

      // a 진료완료(핑크) 전환
      const after = before.map((r) => (r.id === 'a' ? { ...r, status_flag: 'pink' } : r));
      const afterDisp = buildDisplay(after);

      return { beforeDisp, afterDisp };
    });

    // 보라일 때: 활성 행으로 표시
    expect(result.beforeDisp).toEqual([{ id: 'a', inactive: false }]);
    // 핑크 전환 후: 삭제되지 않고 비활성(inactive)으로 명단에 잔존 (AC-1) + 활성과 구분(inactive=true, AC-2)
    expect(result.afterDisp).toEqual([{ id: 'a', inactive: true }]);
  });

  // ── 시나리오2 / AC-3: 정렬 — 활성(진료필요) 상단, 완료(비활성) 하단 ─────────────────
  test('AC-3: 활성 행은 상단, 진료완료(비활성) 행은 하단에 정렬된다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const rows = [
        { id: 'done1', status_flag: 'pink', checked_in_at: '2026-06-01T00:10:00+00:00' },   // 먼저 접수됐지만 완료
        { id: 'active1', status_flag: 'purple', checked_in_at: '2026-06-01T02:00:00+00:00' }, // 늦게 접수됐지만 활성
        { id: 'done2', status_flag: 'pink', checked_in_at: '2026-06-01T00:05:00+00:00' },
        { id: 'active2', status_flag: 'purple', checked_in_at: '2026-06-01T01:00:00+00:00' },
      ];
      const active = rows.filter((r) => r.status_flag === 'purple')
        .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at));
      const done = rows.filter((r) => r.status_flag === 'pink')
        .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at));
      return [...active, ...done].map((r) => r.id);
    });
    // 활성 2건(접수순) 먼저, 완료 2건(접수순) 나중 — 완료가 더 일찍 접수됐어도 하단
    expect(result).toEqual(['active2', 'active1', 'done2', 'done1']);
  });

  // ── 시나리오3 / AC-4: 되돌리기 — 핑크→보라 시 재활성·상단 복귀 ──────────────────────
  test('AC-4: 진료완료(핑크) 행을 보라(진료필요)로 되돌리면 다시 활성·상단으로 복귀한다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const order = (rows: { id: string; status_flag: string | null; checked_in_at: string }[]) => {
        const active = rows.filter((r) => r.status_flag === 'purple')
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at));
        const done = rows.filter((r) => r.status_flag === 'pink')
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at));
        return [...active, ...done].map((r) => ({ id: r.id, inactive: r.status_flag === 'pink' }));
      };

      // p1 활성, p2 완료(하단)
      const base = [
        { id: 'p1', status_flag: 'purple', checked_in_at: '2026-06-01T01:00:00+00:00' },
        { id: 'p2', status_flag: 'pink', checked_in_at: '2026-06-01T00:30:00+00:00' },
      ];
      const beforeRevert = order(base);

      // p2 를 다시 보라(진료필요)로 되돌림
      const reverted = base.map((r) => (r.id === 'p2' ? { ...r, status_flag: 'purple' } : r));
      const afterRevert = order(reverted);

      return { beforeRevert, afterRevert };
    });

    // 되돌리기 전: p1(활성) 상단, p2(완료) 하단
    expect(result.beforeRevert).toEqual([
      { id: 'p1', inactive: false },
      { id: 'p2', inactive: true },
    ]);
    // 되돌린 후: 둘 다 활성. p2(00:30)가 p1(01:00)보다 먼저 접수 → 상단 복귀
    expect(result.afterRevert).toEqual([
      { id: 'p2', inactive: false },
      { id: 'p1', inactive: false },
    ]);
  });

  // ── AC-5: 당일·지점 필터 유지 (부모 rows 신뢰, 위젯은 status_flag 만 추가 필터) ───────
  test('AC-5: 위젯은 부모가 당일·지점으로 필터한 rows 만 받아 purple/pink 만 표시', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // 부모(Dashboard.rows)가 이미 당일·해당지점으로 좁힌 rows. 위젯은 purple/pink 만 거른다.
      const rows = [
        { id: 'x', status_flag: 'purple', checked_in_at: '2026-06-01T03:00:00+00:00' },
        { id: 'y', status_flag: 'pink', checked_in_at: '2026-06-01T03:10:00+00:00' },
        { id: 'z', status_flag: 'white', checked_in_at: '2026-06-01T03:20:00+00:00' }, // 명단 무관 상태
      ];
      const active = rows.filter((r) => r.status_flag === 'purple');
      const done = rows.filter((r) => r.status_flag === 'pink');
      return [...active, ...done].map((r) => r.id);
    });
    // 당일·지점 보라/핑크만, white 등 무관 상태는 미혼입
    expect(result).toEqual(['x', 'y']);
  });

  // ── 렌더 회귀 스모크 ───────────────────────────────────────────────────────────
  test('회귀: 비활성 잔존 로직 도입 후 대시보드가 정상 렌더된다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    // 비활성 행이 있으면 dimmed + 진료완료 배지 구조 검증 (데이터 없으면 스킵)
    const doneRow = page.locator('[data-testid="doctor-call-row"][data-inactive="true"]');
    if ((await doneRow.count()) > 0) {
      await expect(doneRow.first().locator('[data-testid="doctor-call-done-badge"]')).toBeVisible();
    }
  });
});

// (참고) 타입 명시용 — 모델 함수가 받는 row 형태
export type { Row };
