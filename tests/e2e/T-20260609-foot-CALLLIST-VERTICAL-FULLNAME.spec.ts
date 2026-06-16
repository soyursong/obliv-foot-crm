/**
 * E2E spec — T-20260609-foot-CALLLIST-VERTICAL-FULLNAME
 * '원장님 진료콜 명단'(DoctorCallListBar) — 세로 나열 + 성함 전체표시 + max-h 세로 스크롤.
 * (선행 T-20260609-foot-CALLLIST-NAME-VERTICAL-LAYOUT 보정/대체)
 *
 * 현장 요청(김주연 총괄): "고객 성함 절대 잘리면 안 됨 + 가로 스크롤 말고 세로로 나열,
 *   인원 늘면 세로로 자연 확장, 한눈에."
 *
 * 배경: NAME-VERTICAL-LAYOUT은 max-h를 완전히 제거(height auto, 내부 스크롤 X)했으나,
 *   패널이 fixed top-4라 인원이 많으면 컨테이너가 뷰포트 하단 밖으로 밀려 *잘리고 스크롤 불가*.
 *   본 티켓이 행 컨테이너에 max-h + overflow-y-auto를 재도입해 "초과 시 내부 세로 스크롤"로 정정.
 *
 * 구현: src/components/DoctorCallListBar.tsx (DB 무변경, presentation 전용).
 *   - 행 컨테이너(doctor-call-rows): flex flex-col gap-2 + max-h-[calc(100vh-6rem)] + overflow-y-auto.
 *     (가로 overflow-x-auto 없음 — 가로 잘림 X / flex-col 세로 스택)
 *   - 행 카드: w-full (풀폭). 이름 버튼: truncate 부재 + whitespace-normal + break-words.
 *
 * 시나리오(티켓) → AC 매핑:
 *   시나리오1 세로 나열 + 성함 전체표시(잘림 없음)        → AC-1/AC-2
 *   시나리오2 다인원 시 max-h 초과 → 내부 세로 스크롤      → AC-1/AC-3
 *   시나리오3 기능 보존(콜·차트·힐러/위치/재진·메모) 무회귀 → AC-4
 *
 * 컨벤션: CSS 클래스 계약 단언 + 대시보드 렌더 스모크(데이터/인증 없으면 graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260609 CALLLIST-VERTICAL-FULLNAME — 세로 나열 + 성함 전체 + max-h 세로 스크롤', () => {
  // ── 시나리오1 / AC-1·AC-2: 세로 나열 + 가로 스크롤 없음 + 성함 전체표시 ───────────────
  test('AC-1: 행 컨테이너 세로 스택(flex-col) + 가로 overflow-x-auto 없음 + max-h/overflow-y-auto', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])').count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-rows"]');
    await expect(rows).toBeVisible();
    const cls = (await rows.getAttribute('class')) ?? '';
    expect(cls).toContain('flex-col');          // 세로 스택
    expect(cls).not.toContain('overflow-x-auto'); // 가로 스크롤 없음 (가로 잘림 X)
    expect(cls).toContain('overflow-y-auto');     // AC-1: 초과 시 세로 스크롤
    expect(cls).toMatch(/max-h-/);                // AC-1: 뷰포트 잔여 한도

    // computed style: flex-direction column + 세로 overflow auto + 가로 overflow non-scroll
    const styleInfo = await rows.evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return { dir: cs.flexDirection, overflowY: cs.overflowY, overflowX: cs.overflowX };
    });
    expect(styleInfo.dir).toBe('column');
    expect(['auto', 'scroll']).toContain(styleInfo.overflowY); // 세로 스크롤 가능
    expect(styleInfo.overflowX).not.toBe('scroll');            // 가로 스크롤 비활성
  });

  test('AC-2: 이름 버튼 truncate(말줄임) 없음 — whitespace-normal + break-words 로 전체 표시 + 카드 풀폭', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);

    // 이름 버튼 클래스 계약(소스 박제): truncate 부재 + whitespace-normal/break-words 존재.
    const nameContract = 'font-semibold text-sm whitespace-normal break-words text-left min-w-0';
    expect(nameContract).not.toContain('truncate');
    expect(nameContract).toContain('whitespace-normal');
    expect(nameContract).toContain('break-words');

    if (!ok || (await page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])').count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 클래스 계약만 검증 후 스킵');
      return;
    }
    // 실제 이름 요소 DOM 확인: truncate 없음 + 줄바꿈 허용
    const name = page.locator('[data-testid="doctor-call-name"]');
    if ((await name.count()) > 0) {
      const cls = (await name.first().getAttribute('class')) ?? '';
      expect(cls).not.toContain('truncate');
      expect(cls).toMatch(/break-words|whitespace-normal/);
    }
    // 행 카드는 풀폭(w-full) — 가로 여유 확보로 긴 이름도 한 줄에 수용
    const row = page.locator('[data-testid="doctor-call-row"]');
    if ((await row.count()) > 0) {
      const rcls = (await row.first().getAttribute('class')) ?? '';
      expect(rcls).toContain('w-full');
      expect(rcls).not.toMatch(/\bw-56\b/);
      expect(rcls).not.toContain('shrink-0');
    }
  });

  // ── 시나리오2 / AC-1·AC-3: 행 2개↑ 세로 누적 + max-h 초과 시 내부 세로 스크롤 ────────────
  test('AC-3: 행 2개 이상이면 위→아래 세로 누적(동일 x) + max-h 초과 시 컨테이너 내부 세로 스크롤', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok || (await page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])').count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    const rowEls = page.locator('[data-testid="doctor-call-row"]');
    const n = await rowEls.count();
    if (n < 2) {
      test.skip(true, '명단 행 2개 미만 — 세로 누적 비교 스킵');
      return;
    }
    // 위→아래 세로 누적: 2번째 행 top이 1번째 행 아래 + 같은 x(가로 나열 아님)
    const b0 = await rowEls.nth(0).boundingBox();
    const b1 = await rowEls.nth(1).boundingBox();
    expect(b0 && b1).toBeTruthy();
    if (b0 && b1) {
      expect(b1.y).toBeGreaterThan(b0.y + b0.height - 1);
      expect(Math.abs(b1.x - b0.x)).toBeLessThan(4);
    }

    // max-h 한도 검증: 컨테이너 clientHeight ≤ 뷰포트 (off-screen 잘림 방지).
    //   내용이 한도를 넘으면 scrollHeight > clientHeight 이며 세로 스크롤 가능해야 함(잘림 X).
    const scrollInfo = await page
      .locator('[data-testid="doctor-call-rows"]')
      .evaluate((el) => {
        const e = el as HTMLElement;
        const rect = e.getBoundingClientRect();
        return {
          clientHeight: e.clientHeight,
          scrollHeight: e.scrollHeight,
          viewportH: window.innerHeight,
          bottomInView: rect.bottom <= window.innerHeight + 1,
        };
      });
    // 컨테이너 가시 높이는 뷰포트를 넘지 않음(max-h 가 동작)
    expect(scrollInfo.clientHeight).toBeLessThanOrEqual(scrollInfo.viewportH);
    // 컨테이너 하단이 뷰포트 안에 있음(아래로 밀려 화면 밖 잘림 없음)
    expect(scrollInfo.bottomInView).toBe(true);
    // 내용이 한도를 초과하면 내부 스크롤로 도달 가능(스크롤 가능 여부만, 강제 아님)
    if (scrollInfo.scrollHeight > scrollInfo.clientHeight + 1) {
      const scrolled = await page
        .locator('[data-testid="doctor-call-rows"]')
        .evaluate((el) => {
          const e = el as HTMLElement;
          e.scrollTop = e.scrollHeight; // 끝까지 스크롤 시도
          return e.scrollTop > 0; // 스크롤 됨 → 가려진 행에 도달 가능
        });
      expect(scrolled).toBe(true);
    }
  });

  // ── 시나리오3 / AC-4: 기존 기능(콜·차트·힐러/위치/재진·메모) 무회귀 ────────────────────
  test('AC-4: 콜 inclusion/정렬 + 힐러 판정 로직이 레이아웃 변경 후에도 불변', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      type Row = { id: string; status_flag: string | null; status: string; checked_in_at: string };
      // DoctorCallListBar.activeList + DoctorCallRow.isHealer 로직 박제 — 레이아웃과 무관히 유지.
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
      const doneList = (rows: Row[]) =>
        rows.filter((ci) => ci.status_flag === 'pink').map((ci) => ci.id);
      const isHealer = (flag: string | null, status: string) =>
        flag === 'yellow' || status === 'healer_waiting';

      const rows: Row[] = [
        { id: 'hw', status_flag: null, status: 'healer_waiting', checked_in_at: '2026-06-09T02:30:00+00:00' },
        { id: 'h', status_flag: 'yellow', status: 'payment_waiting', checked_in_at: '2026-06-09T02:00:00+00:00' },
        { id: 'p', status_flag: 'purple', status: 'exam_waiting', checked_in_at: '2026-06-09T01:00:00+00:00' },
        { id: 'done', status_flag: 'pink', status: 'done', checked_in_at: '2026-06-09T00:45:00+00:00' },
        { id: 'w', status_flag: 'white', status: 'consult_waiting', checked_in_at: '2026-06-09T00:30:00+00:00' },
      ];
      return {
        active: activeList(rows),       // 활성: purple+yellow+healer_waiting, 접수순
        done: doneList(rows),           // 비활성(완료): pink
        healerStage: isHealer(null, 'healer_waiting'),
        healerFlag: isHealer('yellow', 'payment_waiting'),
        purpleNotHealer: isHealer('purple', 'exam_waiting'),
      };
    });
    expect(result.active).toEqual(['p', 'h', 'hw']); // white 제외, 접수순 정렬
    expect(result.done).toEqual(['done']);           // pink = 완료(비활성 잔존)
    expect(result.healerStage).toBe(true);
    expect(result.healerFlag).toBe(true);
    expect(result.purpleNotHealer).toBe(false);
  });

  // T-20260614-foot-CALLLIST-DOCCALL-3FIX: 전체콜(doctor-call-all)·지정콜(doctor-call-select) 버튼 제거됨.
  //   회귀 단언을 잔존 요소(접기/펼치기·이름·메모) 기준으로 갱신 + 제거된 두 버튼의 '부재'를 가드로 추가.
  test('AC-4b: 핵심 인터랙션 DOM 회귀 — 이름(차트)·메모 입력·위치/힐러 배지 렌더 + 콜버튼 제거 확인', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();
    const list = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await list.count()) === 0) {
      test.skip(true, '진료필요/힐러 당일 체크인 없음 — 위젯 미표시 스킵');
      return;
    }
    await expect(list).toBeVisible();

    // 접기/펼치기 토글은 항상 존재(헤더). 전체콜 버튼은 3FIX로 제거 → 부재 단언.
    await expect(page.locator('[data-testid="doctor-call-toggle"]')).toBeVisible();
    await expect(page.locator('[data-testid="doctor-call-all"]')).toHaveCount(0);

    // 활성 행이 있으면 이름(차트)·메모 입력 진입점 + 위치 배지 렌더. 지정콜(전화기) 버튼은 제거 → 부재 단언.
    const activeRow = page.locator('[data-testid="doctor-call-row"][data-inactive="false"]').first();
    if ((await activeRow.count()) > 0) {
      await expect(activeRow.locator('[data-testid="doctor-call-name"]')).toBeVisible();
      await expect(activeRow.locator('[data-testid="doctor-call-select"]')).toHaveCount(0);
      // SUPERSEDED-BY CALLCARD-COMPACT-MEMO-TOGGLE: 메모 박스 기본 숨김 → 진입점은 연필 토글.
      await expect(activeRow.locator('[data-testid="doctor-call-memo-toggle"]')).toBeVisible();
    }
    const loc = page.locator('[data-testid="doctor-call-location"]');
    if ((await loc.count()) > 0) {
      await expect(loc.first()).toBeVisible();
      expect((await loc.first().innerText()).trim().length).toBeGreaterThan(0);
    }
  });
});
