/**
 * T-20260527-foot-PMW-CODENAME-TRUNC
 * 결제 미니창 "수가 항목" 코드명 text-overflow: ellipsis 잘림 해소
 *
 * 검증 항목:
 * AC-1: truncate(text-overflow:ellipsis) 클래스 제거 확인
 * AC-2: break-words 클래스 적용 — 줄바꿈 허용으로 전체 표시
 * AC-3: 5건+ 레이아웃 안정 (pricing-list scrollable container 확인)
 * AC-4: 금액·수량 우측 영역 shrink-0 유지 (밀림 없음)
 * AC-5: 빌드 통과 (별도 npm run build로 검증)
 */

import { test, expect } from '@playwright/test';

test.describe('T-20260527-foot-PMW-CODENAME-TRUNC: 수가 항목 코드명 잘림 해소', () => {
  // ── 소스 코드 정적 검증 ────────────────────────────────────────────────────

  test('AC-1: SortablePricingRow 코드명 span의 className에 truncate 없음', async ({ page: _page }) => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL(
        '../../src/components/PaymentMiniWindow.tsx',
        import.meta.url,
      ).pathname,
      'utf-8',
    );

    // SortablePricingRow 코드명 span의 className 속성 값만 추출
    // title={service.name}을 가진 span 태그의 className 값 파싱
    const classMatch = src.match(
      /<span\s+className="([^"]+)"\s+title=\{service\.name\}/,
    );
    expect(classMatch, '코드명 span(title=service.name)을 찾지 못함').toBeTruthy();
    const className = classMatch![1];

    // className에 truncate가 없어야 함 (주석 텍스트와 분리해서 검사)
    expect(
      className,
      `SortablePricingRow 코드명 span className "${className}" 에 truncate가 남아있으면 안 됨`,
    ).not.toContain('truncate');
  });

  test('AC-2: SortablePricingRow 코드명 span에 break-words 클래스 적용', async ({ page: _page }) => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL(
        '../../src/components/PaymentMiniWindow.tsx',
        import.meta.url,
      ).pathname,
      'utf-8',
    );

    // break-words 클래스 확인 (줄바꿈 허용)
    expect(
      src,
      'break-words 클래스가 SortablePricingRow 코드명 span에 적용되어야 함',
    ).toContain('"flex-1 font-medium break-words min-w-0 leading-tight"');
  });

  test('AC-2: title 속성으로 전체 코드명 툴팁 제공', async ({ page: _page }) => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL(
        '../../src/components/PaymentMiniWindow.tsx',
        import.meta.url,
      ).pathname,
      'utf-8',
    );

    // title={service.name} 유지 확인
    const match = src.match(
      /<span[^>]*break-words[^>]*title=\{service\.name\}/,
    );
    expect(match, 'break-words span에 title={service.name} 툴팁이 있어야 함').toBeTruthy();
  });

  test('AC-3: pricing-list 컨테이너에 overflow-y-auto 유지 (5건+ 스크롤)', async ({ page: _page }) => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL(
        '../../src/components/PaymentMiniWindow.tsx',
        import.meta.url,
      ).pathname,
      'utf-8',
    );

    // pricing-list 스크롤 컨테이너 확인
    expect(
      src,
      'pricing-list div에 overflow-y-auto가 있어야 5건+ 스크롤 가능',
    ).toContain('"pricing-list"');
    expect(
      src,
      'pricing-list에 overflow-y-auto 필요',
    ).toContain('overflow-y-auto p-2 min-h-0 space-y-1 scroll-smooth');
  });

  test('AC-4: price / tax / remove 고정 요소에 shrink-0 유지 (우측 밀림 없음)', async ({ page: _page }) => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL(
        '../../src/components/PaymentMiniWindow.tsx',
        import.meta.url,
      ).pathname,
      'utf-8',
    );

    // price 버튼: w-16 shrink-0
    expect(src).toContain('w-16 shrink-0 text-[10px] tabular-nums text-right');
    // remove 버튼: shrink-0
    expect(src).toContain('shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5');
  });

  test('AC-2 회귀: break-words 줄바꿈 CSS 속성 확인 (white-space 미설정)', async ({ page: _page }) => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL(
        '../../src/components/PaymentMiniWindow.tsx',
        import.meta.url,
      ).pathname,
      'utf-8',
    );

    // truncate 제거로 white-space:nowrap 해소 확인 (코드명 span 주변에만 없어야 함)
    // SortablePricingRow 컴포넌트 범위에서 코드명 span만 확인
    const componentSrc = src.slice(
      src.indexOf('function SortablePricingRow('),
      src.indexOf('interface Props {'),
    );

    // 코드명 span 라인에 truncate가 없는지 재확인
    const namespanMatch = componentSrc.match(/<span[^>]*break-words[^>]*>/);
    expect(namespanMatch, 'break-words span을 찾지 못함').toBeTruthy();
    expect(namespanMatch![0]).not.toContain('truncate');
  });
});
