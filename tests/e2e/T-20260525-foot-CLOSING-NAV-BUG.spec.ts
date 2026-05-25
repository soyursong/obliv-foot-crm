/**
 * E2E spec — T-20260525-foot-CLOSING-NAV-BUG
 * 일마감 결제내역 새로고침 시 총합계 페이지 돌아감 / 매번 새로고침 필요
 *
 * AC-1: 결제내역 탭에서 새로고침 시 동일 탭(결제내역) 유지
 * AC-2: URL hash로 현재 탭 위치 보존 (/closing#payments)
 * AC-3: 새로운 결제 건 발생 시 realtime subscription으로 자동 갱신
 * AC-4: 자동 갱신 시 현재 스크롤 위치 유지 (paymentsTableRef + useLayoutEffect)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC = 'src/pages/Closing.tsx';

// ─── 소스 정적 검증 (AC-1 / AC-2) ────────────────────────────────────────────
test.describe('T-20260525-CLOSING-NAV-BUG AC-1/AC-2 — URL hash 탭 유지 소스 검증', () => {

  test('AC-1: useLocation + hash 기반 탭 초기값 구현 확인', () => {
    const src = fs.readFileSync(SRC, 'utf-8');

    // useLocation import
    expect(src).toContain('useLocation');

    // tabFromHash: location.hash === '#payments' → 'payments'
    expect(src).toContain("location.hash === '#payments'");
    expect(src).toContain('tabFromHash');

    // useState 초기값으로 tabFromHash 함수(lazy initializer) 사용
    expect(src).toContain('useState<\'summary\' | \'payments\'>(tabFromHash)');
  });

  test('AC-1: 브라우저 앞/뒤 네비게이션 시 탭 동기화 useEffect 존재', () => {
    const src = fs.readFileSync(SRC, 'utf-8');

    // location.hash 변경 감지 → setTab(tabFromHash()) 동기화
    expect(src).toContain('setTab(tabFromHash())');
    expect(src).toContain('location.hash');
  });

  test('AC-2: handleTabChange가 navigate({ hash: #payments }) 로 URL hash 업데이트', () => {
    const src = fs.readFileSync(SRC, 'utf-8');

    expect(src).toContain('handleTabChange');
    expect(src).toContain("hash: next === 'payments' ? '#payments' : ''");
    expect(src).toContain('replace: true');
  });

  test('AC-2: Tabs onValueChange가 handleTabChange 사용 (setTab 직접 호출 없음)', () => {
    const src = fs.readFileSync(SRC, 'utf-8');

    // <Tabs value={tab} onValueChange={handleTabChange}> 확인
    const tabsIdx = src.indexOf('<Tabs value={tab}');
    expect(tabsIdx).toBeGreaterThan(0);

    const tabsLine = src.slice(tabsIdx, tabsIdx + 120);
    expect(tabsLine).toContain('onValueChange={handleTabChange}');
  });
});

// ─── 소스 정적 검증 (AC-3) ────────────────────────────────────────────────────
test.describe('T-20260525-CLOSING-NAV-BUG AC-3 — Realtime 자동 갱신 소스 검증', () => {

  test('AC-3: payments / package_payments / closing_manual_payments 3채널 realtime 구독', () => {
    const src = fs.readFileSync(SRC, 'utf-8');

    // Supabase realtime channel 생성
    expect(src).toContain("supabase.channel(`closing-");

    // 3개 테이블 postgres_changes 구독
    expect(src).toContain("table: 'payments'");
    expect(src).toContain("table: 'package_payments'");
    expect(src).toContain("table: 'closing_manual_payments'");

    // invalidateQueries로 캐시 무효화 → 자동 refetch
    expect(src).toContain('qc.invalidateQueries');
    expect(src).toContain("'closing-payments'");
    expect(src).toContain("'closing-pkg-payments'");
    expect(src).toContain("'closing-manual'");

    // cleanup: channel 해제
    expect(src).toContain('supabase.removeChannel(channel)');
  });
});

// ─── 소스 정적 검증 (AC-4) ────────────────────────────────────────────────────
test.describe('T-20260525-CLOSING-NAV-BUG AC-4 — 스크롤 위치 보존 소스 검증', () => {

  test('AC-4: paymentsTableRef + scrollTopRef useRef 선언 확인', () => {
    const src = fs.readFileSync(SRC, 'utf-8');

    expect(src).toContain('paymentsTableRef');
    expect(src).toContain('scrollTopRef');
    expect(src).toContain('useRef<HTMLDivElement>(null)');
    expect(src).toContain('useRef(0)');
  });

  test('AC-4: useLayoutEffect로 filteredEnrichedRows 변경 시 scrollTop 복원', () => {
    const src = fs.readFileSync(SRC, 'utf-8');

    // useLayoutEffect import
    expect(src).toContain('useLayoutEffect');

    // scrollTop 복원 로직
    expect(src).toContain('el.scrollTop = scrollTopRef.current');

    // filteredEnrichedRows를 dep으로 사용
    expect(src).toContain('}, [filteredEnrichedRows]);');
  });

  test('AC-4: 결제내역 테이블 overflow-auto div에 ref + onScroll 연결', () => {
    const src = fs.readFileSync(SRC, 'utf-8');

    // ref 연결
    expect(src).toContain('ref={paymentsTableRef}');

    // onScroll 핸들러로 scrollTop 저장
    expect(src).toContain('scrollTopRef.current = e.currentTarget.scrollTop');
  });
});

// ─── Playwright 기능 테스트 (AC-1/AC-2 브라우저) ─────────────────────────────
test.describe('T-20260525-CLOSING-NAV-BUG — 브라우저 기능 검증', () => {

  test('AC-1/AC-2: /closing#payments 직접 접근 시 결제내역 탭 활성화', async ({ page }) => {
    // hash를 포함한 URL 직접 접근 — 새로고침(F5) 시나리오 시뮬레이션
    await page.goto('/closing#payments');
    await page.waitForLoadState('networkidle');

    // 결제내역 탭 트리거가 선택된 상태인지 확인
    const paymentsTab = page.getByRole('tab', { name: /결제내역/ });
    // tab이 존재하면 selected 상태 확인 (data-state="active" 또는 aria-selected="true")
    const count = await paymentsTab.count();
    if (count > 0) {
      // 탭이 보이면 active 상태 확인
      const dataState = await paymentsTab.getAttribute('data-state');
      const ariaSelected = await paymentsTab.getAttribute('aria-selected');
      const isActive = dataState === 'active' || ariaSelected === 'true';
      console.log(`결제내역 탭 상태: data-state=${dataState}, aria-selected=${ariaSelected}`);
      expect(isActive).toBe(true);
    } else {
      // 로그인 페이지로 리다이렉트된 경우 — 인증 미설정 환경에서 skip
      console.log('인증 미설정 환경 — 탭 렌더 스킵');
      test.skip(true, '인증 없이 closing 페이지 접근 불가 — storageState 필요');
    }
  });

  test('AC-2: 결제내역 탭 클릭 시 URL hash가 #payments로 변경됨', async ({ page }) => {
    await page.goto('/closing');
    await page.waitForLoadState('networkidle');

    const paymentsTab = page.getByRole('tab', { name: /결제내역/ });
    const count = await paymentsTab.count();

    if (count === 0) {
      test.skip(true, '인증 없이 closing 페이지 접근 불가 — storageState 필요');
      return;
    }

    await paymentsTab.click();
    await page.waitForTimeout(300);

    const url = page.url();
    console.log('탭 클릭 후 URL:', url);
    expect(url).toContain('#payments');
  });
});
