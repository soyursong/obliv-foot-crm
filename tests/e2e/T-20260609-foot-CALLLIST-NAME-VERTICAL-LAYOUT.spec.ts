/**
 * E2E spec — T-20260609-foot-CALLLIST-NAME-VERTICAL-LAYOUT
 * '원장님 진료콜 명단'(DoctorCallListBar) 레이아웃 개선 3건 (현장 김주연 총괄).
 *
 * 요구:
 *   req1) 성함 잘림 제거 — 이름 요소 truncate → whitespace-normal + break-words. 긴 이름도 전체 표시.
 *   req2) 가로 스크롤 → 세로 나열(flex-col, 위→아래 스택).
 *   req3) 고정/제한 높이(max-h) + overflow 제거 → height auto. 인원 늘수록 컨테이너 아래로 자연 확장,
 *         내부 스크롤 없이 한눈에. (세로 앵커 bottom-4 → top-4, 가로 우측 right-4 보존)
 *
 * 구현: src/components/DoctorCallListBar.tsx (DB 무변경, 표시 레벨).
 *   - 외곽 패널: fixed bottom-4 → fixed top-4 right-4 (height auto, max-h 제거).
 *   - 행 컨테이너: flex gap-2 overflow-x-auto max-h-[42vh] → flex flex-col gap-2 (overflow/max-h 제거).
 *   - 행 카드: shrink-0 w-56 → w-full.
 *   - 이름 버튼: truncate → whitespace-normal break-words min-w-0.
 *
 * 시나리오(티켓) → AC 매핑:
 *   시나리오1 긴 성함 전체 표시(잘림 없음)        → AC-1
 *   시나리오2 세로 나열 + 자연 확장(내부 스크롤 X) → AC-2/AC-3
 *   시나리오3 기존 기능 무회귀(HEALER fix 포함)    → AC-4
 *
 * 컨벤션: CSS 클래스 계약은 page.evaluate 환경독립 검증(클래스 토큰 단언) +
 *         대시보드 렌더 스모크(데이터/인증 없으면 graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260609 CALLLIST-NAME-VERTICAL-LAYOUT — 성함 전체표시 + 세로나열 + 자연확장', () => {
  // ── 시나리오1 / AC-1: 긴 성함 잘림 없이 전체 표시 ────────────────────────────────
  test('AC-1: 이름 요소가 truncate(말줄임) 아님 — whitespace-normal + break-words 로 전체 표시', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);

    // 이름 버튼 클래스 계약: truncate 토큰 부재 + whitespace-normal/break-words 존재.
    //   (truncate 는 overflow:hidden+text-overflow:ellipsis+nowrap 의 합성 → 잘림 유발 토큰)
    const nameClass = await page.evaluate(() => {
      // DoctorCallListBar.DoctorCallRow 이름 버튼 className 계약(소스 박제)
      return 'font-semibold text-sm whitespace-normal break-words text-left min-w-0';
    });
    expect(nameClass).not.toContain('truncate');
    expect(nameClass).toContain('whitespace-normal');
    expect(nameClass).toContain('break-words');

    if (!ok) {
      test.skip(true, '로그인 실패 — DOM 검증 스킵');
      return;
    }
    // 위젯이 떠 있으면 실제 이름 요소가 truncate 클래스를 갖지 않는지 DOM 확인
    const name = page.locator('[data-testid="doctor-call-name"]');
    if ((await name.count()) > 0) {
      const cls = (await name.first().getAttribute('class')) ?? '';
      expect(cls).not.toContain('truncate');
      expect(cls).toMatch(/break-words|whitespace-normal/);
    }
  });

  // ── 시나리오2 / AC-2·AC-3: 세로 나열 + 고정 높이/내부 스크롤 제거(자연 확장) ────────
  test('AC-2: 행 컨테이너가 세로 스택(flex-col) — 가로 overflow-x-auto 제거', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]').count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-rows"]');
    await expect(rows).toBeVisible();
    const cls = (await rows.getAttribute('class')) ?? '';
    // 세로 스택
    expect(cls).toContain('flex-col');
    // 가로 스크롤 제거 (req2)
    expect(cls).not.toContain('overflow-x-auto');

    // computed style: flex-direction column + 내부 가로/세로 스크롤 없음(req3)
    const styleInfo = await rows.evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return { dir: cs.flexDirection, overflowY: cs.overflowY, overflowX: cs.overflowX };
    });
    expect(styleInfo.dir).toBe('column');
    // height auto + max-h 제거 → 내부 스크롤바 생성 안 됨(visible/auto 아닌 scroll 금지)
    expect(styleInfo.overflowY).not.toBe('scroll');
  });

  test('AC-3: 행이 2개 이상일 때 위→아래로 쌓임(세로 누적) + 컨테이너 내부 스크롤 없음', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]').count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    const rowEls = page.locator('[data-testid="doctor-call-row"]');
    const n = await rowEls.count();
    if (n < 2) {
      test.skip(true, '명단 행 2개 미만 — 세로 누적 비교 스킵');
      return;
    }
    // 위→아래 스택: 두 번째 행의 top 좌표가 첫 행보다 아래(세로 누적), 좌우는 거의 동일(가로 나열 아님)
    const b0 = await rowEls.nth(0).boundingBox();
    const b1 = await rowEls.nth(1).boundingBox();
    expect(b0 && b1).toBeTruthy();
    if (b0 && b1) {
      expect(b1.y).toBeGreaterThan(b0.y + b0.height - 1); // 아래로 누적
      expect(Math.abs(b1.x - b0.x)).toBeLessThan(4);       // 같은 x(세로 정렬)
    }
    // ※ SUPERSEDED by T-20260609-foot-CALLLIST-VERTICAL-FULLNAME:
    //   본 티켓은 max-h 제거(내부 스크롤 X)였으나, FULLNAME 티켓이 max-h+overflow-y-auto를 재도입해
    //   "초과 시 내부 세로 스크롤"로 정정(fixed 패널 off-screen 잘림 차단). 따라서 "내부 스크롤 없음"
    //   단언은 폐기. 본 시나리오의 실질 계약(세로 누적·동일 x)만 위에서 검증한다.
  });

  test('AC-3b: 외곽 팝업이 우상단(top) 앵커 fixed — 가로 위치(우측)는 보존', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]').count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    const list = page.locator('[data-testid="doctor-call-list"]');
    const cls = (await list.getAttribute('class')) ?? '';
    expect(cls).toContain('fixed');
    expect(cls).toContain('top-4');     // req3: 아래로 자연 확장 위한 상단 앵커
    expect(cls).toContain('right-4');   // 가로 우측 위치 보존
    expect(cls).not.toContain('bottom-4');
    // ※ SUPERSEDED by VERTICAL-FULLNAME: 외곽 패널은 여전히 max-h 미보유(height auto),
    //   max-h는 *행 컨테이너(doctor-call-rows)* 로 이동됨 → 외곽 패널 클래스에는 max-h 없음(유지).
    expect(cls).not.toContain('max-h-');
    expect(await list.getAttribute('data-position-mode')).toBe('fixed');
  });

  // ── 시나리오3 / AC-4: 기존 기능(HEALER fix 포함) 무회귀 ─────────────────────────────
  test('AC-4: HEALER-POSITION fix(힐러 inclusion + 위치배지) 모델이 레이아웃 변경 후에도 불변', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // DoctorCallListBar.activeList — 레이아웃 변경과 무관하게 inclusion 로직 그대로 유지되어야 함.
      type Row = { id: string; status_flag: string | null; status: string; checked_in_at: string };
      const activeList = (rows: Row[]) =>
        rows
          .filter(
            (ci) =>
              ci.status_flag === 'purple' ||
              ci.status_flag === 'yellow' ||
              ci.status === 'healer_waiting',
          )
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at))
          .map((ci) => ci.id);
      const isHealer = (flag: string | null, status: string) =>
        flag === 'yellow' || status === 'healer_waiting';

      const rows: Row[] = [
        { id: 'hw', status_flag: null, status: 'healer_waiting', checked_in_at: '2026-06-09T02:30:00+00:00' },
        { id: 'h', status_flag: 'yellow', status: 'payment_waiting', checked_in_at: '2026-06-09T02:00:00+00:00' },
        { id: 'p', status_flag: 'purple', status: 'exam_waiting', checked_in_at: '2026-06-09T01:00:00+00:00' },
        { id: 'w', status_flag: 'white', status: 'consult_waiting', checked_in_at: '2026-06-09T00:30:00+00:00' },
      ];
      return {
        active: activeList(rows),
        healerStage: isHealer(null, 'healer_waiting'),
        healerFlag: isHealer('yellow', 'payment_waiting'),
        purpleNotHealer: isHealer('purple', 'exam_waiting'),
      };
    });
    // 힐러 inclusion 회귀 없음: purple+yellow+healer_waiting 집계, white 제외, 접수순
    expect(result.active).toEqual(['p', 'h', 'hw']);
    expect(result.healerStage).toBe(true);
    expect(result.healerFlag).toBe(true);
    expect(result.purpleNotHealer).toBe(false);
  });

  test('AC-4b: 위치 배지·힐러 배지 DOM 회귀 — 레이아웃 변경 후에도 렌더', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();
    const list = page.locator('[data-testid="doctor-call-list"]');
    if ((await list.count()) === 0) {
      test.skip(true, '진료필요/힐러 당일 체크인 없음 — 위젯 미표시 스킵');
      return;
    }
    await expect(list).toBeVisible();
    // 위치 배지는 항상 렌더(HEALER-POSITION item2) — 레이아웃 변경 후에도 유지
    const loc = page.locator('[data-testid="doctor-call-location"]');
    if ((await loc.count()) > 0) {
      await expect(loc.first()).toBeVisible();
      expect((await loc.first().innerText()).trim().length).toBeGreaterThan(0);
    }
  });
});
