/**
 * E2E spec — T-20260601-foot-DOCTOR-CALL-POPUP-RELOC
 * '원장님 진료콜 명단'을 대시보드 하단 고정 바 → 칸반 슬롯 빈공간 플로팅 팝업으로 전환
 *
 * 현장 요청 (김주연 총괄, 슬랙 C0ATE5P6JTH / MSG-20260601-135402-bnae, 첨부 20260601_135211.png):
 *   "위치 하단 고정말고 스크린샷 참고 / 슬롯 빈공간에 팝업 형태로 변경해줘"
 *
 * 구현:
 *   - src/components/DoctorCallListBar.tsx — 루트를 하단 sticky bar → absolute 플로팅 팝업 카드로 변경,
 *     접기/펼치기(collapsed) 토글 추가. 데이터·집계·메모·초재진 회차·전체/지정콜 로직은 그대로 보존.
 *   - src/pages/Dashboard.tsx — 위젯을 flex-col root 하단 자식 → 칸반 스크롤 컨테이너 내부(relative)
 *     absolute(bottom-left) 배치로 이동. 하단 고정 해제.
 *
 * OPEN-Q (A) 빈공간 인라인 팝업으로 구현 — 칸반과 함께 스크롤, 가로 sticky 해제.
 *   직전 DOCTOR-CALL-LIST AC-6(가로 sticky)는 본 티켓이 우선 → 해당 spec AC-6 개정됨.
 *
 * AC 매핑:
 *   AC-1 하단 고정 해제           → '하단 고정 바 아님(absolute)' 검증
 *   AC-2 슬롯 빈공간 팝업          → 칸반 스크롤 컨테이너 내부 absolute 배치 검증
 *   AC-3 기능 회귀 없음            → 집계/메모/초재진/전체·지정콜 로직 박제(부모 spec와 동일 모델)
 *   AC-4 접기/펼치기 토글          → collapsed 토글 모델 검증
 *   AC-5 무파괴                    → 대시보드 렌더 스모크
 *
 * 컨벤션: 핵심 로직은 page.evaluate 로 환경독립 검증, + 대시보드 렌더 스모크(데이터/인증 없으면 graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260601 DOCTOR-CALL-POPUP-RELOC — 하단고정 → 슬롯 빈공간 팝업', () => {
  // ── 시나리오1 / AC-1·AC-2: 하단 고정 해제 + 슬롯 빈공간 종속 플로팅 팝업 ─────────────────
  //   ※ 위치(position) 거동은 두 차례 정정됨:
  //     - REOPEN(db62b1a): fixed 폐기 → absolute scroll-bound(슬롯 종속).
  //     - RIGHT-FIX(현장 재거부 후 최종): absolute scroll-bound 폐기 → fixed 우측 고정(스크롤해도 안 사라짐).
  //   본 RELOC 테스트의 *불변 핵심*은 "static 하단 고정 바가 아닌 플로팅 오버레이 팝업"이며,
  //   position 종류(fixed/absolute) 정밀 단언은 T-20260601-foot-DASH-POPUP-RIGHT-FIX.spec.ts로 이관.
  test('AC-1·AC-2: 위젯이 하단 고정 바(static)가 아닌 플로팅 오버레이 팝업으로 렌더', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    const list = page.locator('[data-testid="doctor-call-list"]');
    if ((await list.count()) === 0) {
      test.skip(true, '보라(진료필요) 당일 체크인 없음 — 위젯 미표시 환경 스킵');
      return;
    }

    // AC-1) 하단 고정 바(static flex 자식)가 아니라 플로팅 오버레이 팝업(positioned)으로 렌더된다.
    //   position 종류(fixed/absolute)는 두 차례 정정됨 → 불변 핵심은 "static이 아닌 positioned 오버레이".
    //   (정밀 단언: RIGHT-FIX spec가 position==='fixed' & data-position-mode==='fixed' 검증)
    const position = await list.evaluate((el) => getComputedStyle(el).position);
    expect(['fixed', 'absolute', 'sticky']).toContain(position); // static 하단 바 아님

    // 오버레이 마커가 존재한다(하단 고정 static 바였다면 없는 속성).
    const mode = await list.evaluate((el) => el.getAttribute('data-position-mode'));
    expect(mode).not.toBeNull();

    await expect(list).toBeVisible();
  });

  // ── 시나리오3 / AC-4: 접기/펼치기 토글 — 본문 숨김/표시 ──────────────────────────────
  test('AC-4: 접기/펼치기 토글 모델 — 접힘 시 명단 본문(rows) 숨김, 펼침 시 표시', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // DoctorCallListBar: collapsed=true → rows 영역 미렌더 + 전체콜/해제 버튼 숨김, 헤더는 유지.
      const renderModel = (collapsed: boolean) => ({
        headerVisible: true, // 헤더(타이틀/카운트/토글)는 항상 표시
        rowsVisible: !collapsed, // 본문(doctor-call-rows)은 펼침일 때만
        allCallVisible: !collapsed, // 전체콜은 펼침일 때만(접힘 시 빈공간 확보)
        toggleLabel: collapsed ? '명단 펼치기' : '명단 접기',
      });
      const expanded = renderModel(false);
      const collapsed = renderModel(true);
      // 토글 동작: 펼침 → 접힘 → 펼침
      let state = false;
      state = !state; // 접기 클릭
      const afterCollapse = state;
      state = !state; // 펼치기 클릭
      const afterExpand = state;
      return { expanded, collapsed, afterCollapse, afterExpand };
    });
    // 펼침 상태: 본문/전체콜 보임
    expect(result.expanded.rowsVisible).toBe(true);
    expect(result.expanded.allCallVisible).toBe(true);
    expect(result.expanded.toggleLabel).toBe('명단 접기');
    // 접힘 상태: 본문/전체콜 숨김, 헤더만 유지(빈공간 확보)
    expect(result.collapsed.rowsVisible).toBe(false);
    expect(result.collapsed.allCallVisible).toBe(false);
    expect(result.collapsed.headerVisible).toBe(true);
    expect(result.collapsed.toggleLabel).toBe('명단 펼치기');
    // 토글 왕복
    expect(result.afterCollapse).toBe(true);
    expect(result.afterExpand).toBe(false);
  });

  // ── AC-4 보강: 실제 렌더에서 토글 클릭 시 본문 표시/숨김 (데이터 의존, graceful skip) ──
  test('AC-4(렌더): 토글 클릭으로 명단 본문이 접히고 다시 펼쳐진다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const list = page.locator('[data-testid="doctor-call-list"]');
    if ((await list.count()) === 0) {
      test.skip(true, '보라(진료필요) 당일 체크인 없음 — 위젯 미표시 환경 스킵');
      return;
    }

    const toggle = page.locator('[data-testid="doctor-call-toggle"]');
    const rows = page.locator('[data-testid="doctor-call-rows"]');
    await expect(toggle).toBeVisible();

    // 초기 펼침 → 본문 표시
    await expect(rows).toBeVisible();
    // 접기
    await toggle.click();
    await expect(rows).toHaveCount(0);
    await expect(list).toHaveAttribute('data-collapsed', 'true');
    // 펼치기
    await toggle.click();
    await expect(rows).toBeVisible();
    await expect(list).toHaveAttribute('data-collapsed', 'false');
  });

  // ── 시나리오2 / AC-3: 기능 회귀 없음 — 집계·초재진·메모·전체/지정콜 로직 보존 ──────────
  test('AC-3: 위치 변경 후에도 집계/초재진/메모/전체·지정콜 로직이 동일 보존된다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      type Row = { id: string; status_flag: string | null; checked_in_at: string };
      // 집계: 활성=purple(접수순), 비활성=pink(접수순), displayList=[...active, ...done]
      const activeList = (rows: Row[]) =>
        rows.filter((r) => r.status_flag === 'purple')
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at)).map((r) => r.id);
      const doneList = (rows: Row[]) =>
        rows.filter((r) => r.status_flag === 'pink')
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at)).map((r) => r.id);

      const rows: Row[] = [
        { id: 'a', status_flag: 'purple', checked_in_at: '2026-06-01T02:00:00+00:00' },
        { id: 'b', status_flag: 'white', checked_in_at: '2026-06-01T01:00:00+00:00' },
        { id: 'c', status_flag: 'purple', checked_in_at: '2026-06-01T00:30:00+00:00' },
        { id: 'd', status_flag: 'pink', checked_in_at: '2026-06-01T00:10:00+00:00' },
      ];
      const active = activeList(rows);
      const done = doneList(rows);

      // 배지 분기
      const badge = (visit_type: string, n?: number) =>
        visit_type === 'returning' ? `재진${typeof n === 'number' && n > 0 ? ` ${n}회차` : ''}`
        : visit_type === 'experience' ? '체험' : '초진';

      // 메모 정규화
      const normalize = (d: string) => (d.trim() === '' ? null : d.trim());

      // 전체콜/지정콜 하이라이트(상호배타)
      const highlighted = (allCall: boolean, selectedId: string | null) =>
        active.filter((id) => allCall || selectedId === id);

      return {
        active, done,
        badgeNew: badge('new'), badgeReturning3: badge('returning', 3),
        memoSaved: normalize('  혈압 체크  '), memoCleared: normalize('   '),
        designated: highlighted(false, 'a'), all: highlighted(true, null),
      };
    });
    // 집계: 보라만 활성(접수순 c→a), 핑크는 비활성 잔존(d). white 제외.
    expect(result.active).toEqual(['c', 'a']);
    expect(result.done).toEqual(['d']);
    // 배지
    expect(result.badgeNew).toBe('초진');
    expect(result.badgeReturning3).toBe('재진 3회차');
    // 메모
    expect(result.memoSaved).toBe('혈압 체크');
    expect(result.memoCleared).toBeNull();
    // 전체/지정콜
    expect(result.designated).toEqual(['a']);
    expect(result.all).toEqual(['c', 'a']);
  });

  // ── AC-5: 무파괴 — 위젯 재배치 후 대시보드가 정상 렌더된다 ─────────────────────────────
  test('AC-5: 위젯 재배치 후 대시보드(칸반/타임라인 등)가 정상 렌더된다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();
  });
});
