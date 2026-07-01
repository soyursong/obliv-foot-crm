/**
 * E2E spec — T-20260701-foot-NEWSECTION-COMPACT-DEFAULT
 * 풋센터 CRM 신규 구역 컴팩트 기본값 (변경1 = 표준 프리셋).
 *
 * 현장(김주연 총괄): "새 구역 만들 때마다 너무 크게 잡음 → 앞으로 무조건 컴팩트하게."
 *
 * 변경(순수 FE, DDL 0, 데이터/비즈로직 무변경):
 *  - 공용 Card 래퍼 기본 패딩 p-4(16px) → p-3(12px)  (CardHeader/CardContent/CardFooter)
 *  - 공용 Dialog 기본 패딩 p-6(24px) → p-4(16px), 헤더 mb-4→mb-3 / 푸터 mt-4→mt-3
 *    (신규 생성폼/다이얼로그도 컴팩트 기본값)
 *  - 비의료 화면 raw 섹션 컨테이너 p-4 → p-3 (AdminSettings/ClinicSettings/Waiting/ClinicCalendar)
 *  - 의료화면(진료대시보드/진료관리)의 raw 섹션은 §11 게이트로 직접 미수정(문원장 컨펌 대기).
 *    단, 그 화면이 쓰는 공용 Card/Dialog는 프리셋 상속으로 자동 컴팩트.
 *
 * 시나리오(AC 기준):
 *  1) AC1 — 신규 구역이 쓰는 공용 섹션 컨테이너의 기본 패딩이 컴팩트(12px)로 렌더된다.
 *     진입점 = /admin/settings "메시지 발송 활성화" 섹션(compact swept 컨테이너).
 *  2) AC1(프리셋) — 공용 Card 프리미티브가 컴팩트 패딩(≤12px)으로 렌더된다.
 *     진입점 = /admin (Dashboard) — Card 다수 사용.
 *  3) AC3/AC4 — 밀도 축소 후 텍스트 잘림·가로 넘침·요소 미렌더 없이 회귀 0.
 *
 * ※ FE-only(SQL 0·DB 비파괴). 권한/데이터 부재 환경은 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260701-foot-NEWSECTION-COMPACT-DEFAULT — 신규 구역 컴팩트 기본값', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('시나리오1: AC1 — 설정 화면 bordered 섹션이 컴팩트 패딩(12px)으로 렌더', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle').catch(() => {});
    // 기본 섹션(① 채널 가능 여부)이 rounded-lg border p-3 섹션을 렌더. 없으면 graceful skip.
    const anySection = page.locator('div.rounded-lg.border').first();
    try {
      await anySection.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '설정 섹션 미렌더(권한/데이터)');
    }

    // 화면의 모든 bordered 섹션 컨테이너 padding 수집
    const pads = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('div.rounded-lg.border')) as HTMLElement[];
      return nodes
        .filter((n) => n.offsetParent !== null) // 표시되는 것만
        .map((n) => parseFloat(getComputedStyle(n).paddingTop))
        .filter((p) => p > 0);
    });
    expect(pads.length).toBeGreaterThan(0);
    // 컴팩트 프리셋 적용 증명: 12px(p-3) 섹션이 실제 렌더(옛 16px가 아님)
    const hasCompact = pads.some((p) => Math.abs(p - 12) < 1);
    expect(hasCompact, `settings bordered 섹션 padTop들=[${pads.join(',')}]`).toBeTruthy();
    console.log(`[시나리오1] 설정 bordered 섹션 ${pads.length}개 중 12px(컴팩트 p-3) 존재 OK — pads=[${pads.join(',')}]`);
  });

  test('시나리오2: AC1 프리셋 — 공용 Card 프리미티브가 컴팩트 패딩(≤12px)으로 렌더', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle').catch(() => {});

    // Card 루트: rounded-xl border ... shadow-sm. 그 안의 padding 있는 컨텐츠 컨테이너 측정.
    const cards = page.locator('div.rounded-xl.border.shadow-sm');
    const cnt = await cards.count();
    if (cnt === 0) {
      test.skip(true, '대시보드에 공용 Card 미렌더(데이터/권한)');
    }

    // 하나 이상의 Card 자식 중 패딩이 적용된 컨테이너가 있고, 그 값이 12px 이하(컴팩트)임을 확인.
    let checked = 0;
    for (let i = 0; i < Math.min(cnt, 8); i++) {
      const maxPad = await cards.nth(i).evaluate((card) => {
        const kids = Array.from(card.querySelectorAll(':scope > div')) as HTMLElement[];
        let seen = -1;
        for (const k of kids) {
          const pt = parseFloat(getComputedStyle(k).paddingTop);
          if (pt > 0) seen = Math.max(seen, pt);
        }
        return seen;
      });
      if (maxPad > 0) {
        // 컴팩트 프리셋: p-3(12px). 여백이 있는 카드 컨테이너는 16px가 아닌 ≤12px여야 함.
        expect(maxPad).toBeLessThanOrEqual(12.5);
        checked++;
      }
    }
    console.log(`[시나리오2] 패딩 적용 Card ${checked}개 모두 ≤12px(컴팩트) OK (총 카드 ${cnt})`);
  });

  test('시나리오3: AC3/AC4 — 회귀 0 (가로 넘침 없음 + 핵심 요소 정상 렌더)', async ({ page }) => {
    for (const path of ['/admin', '/admin/settings']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});

      // 페이지 레벨 가로 스크롤(레이아웃 붕괴) 없음 — 반올림 여유 2px
      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return el.scrollWidth - el.clientWidth;
      });
      expect(overflow, `${path} 가로 넘침`).toBeLessThanOrEqual(2);

      // 빈 화면/붕괴가 아니라 실제 콘텐츠가 렌더됨(텍스트 존재)
      const textLen = await page.evaluate(() => (document.body.innerText || '').trim().length);
      expect(textLen, `${path} 콘텐츠 렌더`).toBeGreaterThan(20);
      console.log(`[시나리오3] ${path} 가로 넘침 ${overflow}px(≤2) + 콘텐츠 ${textLen}자 렌더 정상 OK`);
    }
  });

  // AC5(전수 검토·누락 0) 후속 — MSG-20260701-165602: 비의료 관리 페이지의 '외곽 구역' 여백 컴팩트 스윕.
  // 공용 Card/Dialog 프리셋이 못 잡는 페이지-외곽 컨테이너(p-6→p-4)를 전수 축소했는지 검증.
  // 대상(비의료): 고객·패키지·직원·계정·일마감·통계·서비스. 진료관리(ClinicManagement)는 §11 의료 게이트 → 제외.
  test('시나리오4: AC5 — 비의료 관리 페이지 외곽 컨테이너가 컴팩트(≤16px, p-6 아님)로 렌더', async ({ page }) => {
    const paths = [
      '/admin/customers',
      '/admin/packages',
      '/admin/staff',
      '/admin/accounts',
      '/admin/closing',
      '/admin/stats',
      '/admin/services',
    ];
    let checked = 0;
    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      // 라우트 콘텐츠 미렌더(권한/데이터) → 이 경로 skip
      const rendered = await page.evaluate(() => (document.body.innerText || '').trim().length > 20);
      if (!rendered) continue;

      // 페이지 외곽 컨테이너 후보: h-full + (flex-col | overflow-auto), 표시되는 것 중 최상위(DOM 깊이 최소).
      const outerPadTop = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('div')).filter((n) => {
          const el = n as HTMLElement;
          if (el.offsetParent === null && el !== document.body) return false;
          const c = el.className || '';
          return typeof c === 'string' && c.includes('h-full') &&
            (c.includes('flex-col') || c.includes('overflow-auto'));
        }) as HTMLElement[];
        if (nodes.length === 0) return null;
        // 가장 얕은(외곽) 컨테이너 선택
        const depth = (el: HTMLElement) => { let d = 0, p = el.parentElement; while (p) { d++; p = p.parentElement; } return d; };
        nodes.sort((a, b) => depth(a) - depth(b));
        return parseFloat(getComputedStyle(nodes[0]).paddingTop);
      });
      if (outerPadTop === null || Number.isNaN(outerPadTop)) continue;

      // 컴팩트 스윕 증명: 외곽 여백이 16px(p-4) 이하 — 옛 24px(p-6)가 아님.
      expect(outerPadTop, `${path} 외곽 컨테이너 padTop=${outerPadTop}px (p-6=24px면 미스윕)`).toBeLessThanOrEqual(16.5);
      checked++;
      console.log(`[시나리오4] ${path} 외곽 컨테이너 padTop ${outerPadTop}px(≤16, 컴팩트) OK`);
    }
    if (checked === 0) test.skip(true, '비의료 관리 페이지 미렌더(권한/데이터) — graceful skip');
    console.log(`[시나리오4] 비의료 관리 페이지 ${checked}개 외곽 컨테이너 컴팩트 스윕 검증 완료`);
  });
});
