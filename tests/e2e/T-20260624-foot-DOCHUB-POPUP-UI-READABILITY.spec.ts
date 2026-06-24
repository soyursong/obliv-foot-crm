/**
 * E2E spec — T-20260624-foot-DOCHUB-POPUP-UI-READABILITY
 * 진료대시보드 '서류 발급 허브'(DoctorDocsHubDialog) 팝업 가독성 개선.
 *
 * 현장 피드백(문지은 대표원장, 안주연 F-1237): ①글씨 가독성 저하 ②여백 부족
 *   ③팝업창 작음 + 글씨 겹침 — 서류 발급 허브 메뉴(카드 3개).
 *
 * 정본 = src/components/doctor/DoctorDocsHubDialog.tsx (허브 메뉴 + HubButton).
 *   변경 = CSS 클래스(width·padding·gap·line-height·폰트크기) only.
 *   activeDoc 상태머신·HubButton onClick·각 서류 컴포넌트(OpinionEditorDialog/
 *   DocumentPrintPanel/KohPublishedResults) 재사용·발행/출력/불변 로직 일절 미접촉(회귀 0).
 *
 * AC 매핑:
 *   AC1 허브 DialogContent width 확대(max-w-md → max-w-lg↑) — 긴 제목 겹침 0.
 *   AC2 HubButton padding 증가(px-3 py-2.5 → px-4 py-3.5).
 *   AC3 카드 내 title↔desc 수직 간격/leading 확보(겹침 0).
 *   AC4 카드 간 gap 증가(gap-2 → gap-3↑).
 *   AC5 desc 폰트 상향(text-[11px] → text-xs↑).
 *   AC6 회귀 0 — data-testid(docs-hub-dialog/opinion/print/koh) 보존, 진입 동작 무변경.
 *
 * 스타일: (A) 정본 소스 정적 가드(토큰 업그레이드 + NOTOUCH 가드) + (B) 실 브라우저 렌더 스모크.
 *   ⚠ NOTOUCH: activeDoc 상태머신 · OpinionEditorDialog · DocumentPrintPanel · KohPublishedResults.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src/components/doctor/DoctorDocsHubDialog.tsx');
const src = readFileSync(SRC, 'utf-8');

test.describe('T-20260624-foot-DOCHUB-POPUP-UI-READABILITY — 정본 소스 가독성 가드', () => {
  // AC1 — 허브 메뉴 DialogContent width 확대(max-w-md → max-w-lg 이상). max-w-md 회귀 차단.
  test('AC1: 허브 DialogContent = max-w-lg 이상 (max-w-md 회귀 차단)', () => {
    const m = src.match(/<DialogContent className="([^"]*)" data-testid="docs-hub-dialog">/);
    expect(m, 'docs-hub-dialog DialogContent 존재').not.toBeNull();
    const cls = m![1];
    expect(cls, '확대된 width(lg/xl/2xl)').toMatch(/max-w-(lg|xl|2xl)/);
    expect(cls, 'max-w-md 좁은폭 회귀 차단').not.toContain('max-w-md');
  });

  // AC4 — 카드 컨테이너 gap 증가(gap-2 → gap-3 이상).
  test('AC4: 카드 컨테이너 gap-3 이상 (gap-2 회귀 차단)', () => {
    const m = src.match(/<div className="(mt-2 flex flex-col [^"]*)">/);
    expect(m, '카드 컨테이너 div 존재').not.toBeNull();
    const cls = m![1];
    expect(cls, 'gap-3 이상').toMatch(/gap-(3|4|5)/);
    expect(cls, 'gap-2 회귀 차단').not.toMatch(/gap-2(\s|$|")/);
  });

  // AC2 — HubButton padding 증가(px-3 py-2.5 → px-4 py-3.5 이상).
  test('AC2: HubButton padding 증가(px-4 py-3.5↑, px-3/py-2.5 회귀 차단)', () => {
    // HubButton 내부 <button className="...">
    const m = src.match(/className="(flex [^"]*rounded-lg border border-input[^"]*)"/);
    expect(m, 'HubButton button className 존재').not.toBeNull();
    const cls = m![1];
    expect(cls, '좌우 padding 증가(px-4↑)').toMatch(/px-(4|5|6)/);
    expect(cls, '상하 padding 증가(py-3/3.5↑)').toMatch(/py-(3|3\.5|4)/);
    expect(cls, '좁은 px-3 회귀 차단').not.toMatch(/px-3(\s|")/);
    expect(cls, '좁은 py-2.5 회귀 차단').not.toContain('py-2.5');
  });

  // AC3 — title: leading 확보(겹침 0). desc와 분리되도록 leading-snug 등 + foreground 유지.
  test('AC3: 카드 title = text-sm font-medium + leading 확보', () => {
    const m = src.match(/<span className="(block text-sm font-medium[^"]*)">\{title\}<\/span>/);
    expect(m, 'title span 존재').not.toBeNull();
    const cls = m![1];
    expect(cls, 'title leading 토큰 존재(겹침 방지)').toMatch(/leading-(snug|tight|normal|relaxed)/);
    expect(cls).toContain('text-foreground');
  });

  // AC3 + AC5 — desc: title과 수직 간격(mt) + 폰트 상향(text-xs 이상) + leading 확보.
  test('AC5/AC3: 카드 desc = text-xs 이상 + mt 간격 + leading (text-[11px] 회귀 차단)', () => {
    const m = src.match(/<span className="([^"]*text-muted-foreground[^"]*)">\{desc\}<\/span>/);
    expect(m, 'desc span 존재').not.toBeNull();
    const cls = m![1];
    expect(cls, 'desc 폰트 상향(text-xs/sm)').toMatch(/text-(xs|sm)/);
    expect(cls, 'desc 11px 작은글씨 회귀 차단').not.toContain('text-[11px]');
    expect(cls, 'title↔desc 수직 간격(mt)').toMatch(/mt-(0\.5|1|1\.5|2)/);
    expect(cls, 'desc leading 확보').toMatch(/leading-(relaxed|normal|snug)/);
  });

  // AC6 — 진입 testid 4종 + activeDoc 분기·재사용 컴포넌트 import 보존(회귀 가드).
  test('AC6: 진입 testid 4종 + 재사용 컴포넌트/상태머신 보존', () => {
    // 허브 다이얼로그 컨테이너 testid(리터럴)
    expect(src, 'docs-hub-dialog 보존').toContain('data-testid="docs-hub-dialog"');
    // 카드 3종 testid는 HubButton에 testId prop으로 전달 → testId="..." 형태로 보존
    for (const tid of ['docs-hub-opinion', 'docs-hub-print', 'docs-hub-koh']) {
      expect(src, `${tid} 보존`).toContain(`testId="${tid}"`);
    }
    // HubButton이 prop을 data-testid로 렌더(보존)
    expect(src).toContain('data-testid={testId}');
    // 개별 서류 팝업 testid 보존
    expect(src).toContain('data-testid="docs-hub-print-dialog"');
    expect(src).toContain('data-testid="docs-hub-koh-dialog"');
    // 재사용 컴포넌트 import 경로 보존(NOTOUCH)
    expect(src).toContain('DocumentPrintPanel');
    expect(src).toContain('KohPublishedResults');
    expect(src).toContain('OpinionEditorDialog');
    // activeDoc 상태머신 분기 보존
    expect(src).toContain("setActiveDoc('opinion')");
    expect(src).toContain("setActiveDoc('print')");
    expect(src).toContain("setActiveDoc('koh')");
  });
});

// ── 실 브라우저 렌더 스모크 — 시나리오1(가독성) + 시나리오2(진입 회귀) ──
test.describe('T-20260624-foot-DOCHUB-POPUP-UI-READABILITY — render', () => {
  test('시나리오1/2: 허브 팝업 렌더 + 카드 겹침 0 + 진입 동작 무회귀', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    const dashLink = page.getByRole('link', { name: '진료 대시보드' });
    if ((await dashLink.count()) === 0) {
      await page.screenshot({ path: 'evidence/T-20260624-foot-DOCHUB-POPUP-UI-READABILITY_no-dash.png', fullPage: true });
      test.skip(true, '진료 대시보드 링크 미노출(권한/환경) — 정적 가드로 대체');
      return;
    }
    await dashLink.click();
    await page.waitForTimeout(2000);

    // 내원객 행의 [서류 발급] 진입 버튼(대시보드). 없거나 클릭 불가(금일 내방객 없음) → 정적 가드로 대체.
    const docBtn = page.getByRole('button', { name: /서류/ }).first();
    if ((await docBtn.count()) === 0) {
      await page.screenshot({ path: 'evidence/T-20260624-foot-DOCHUB-POPUP-UI-READABILITY_empty.png', fullPage: true });
      test.skip(true, '금일 내방객/서류 버튼 없음 — 허브 오픈 불가, 정적 가드로 대체');
      return;
    }
    try {
      await docBtn.click({ timeout: 4000 });
    } catch {
      await page.screenshot({ path: 'evidence/T-20260624-foot-DOCHUB-POPUP-UI-READABILITY_noclick.png', fullPage: true });
      test.skip(true, '서류 버튼 클릭 불가(내방객 행 없음/비활성) — 정적 가드로 대체');
      return;
    }
    await page.waitForTimeout(1000);

    const hub = page.getByTestId('docs-hub-dialog');
    if ((await hub.count()) === 0) {
      await page.screenshot({ path: 'evidence/T-20260624-foot-DOCHUB-POPUP-UI-READABILITY_nohub.png', fullPage: true });
      test.skip(true, '서류 발급 허브 미오픈(다른 동선) — 정적 가드로 대체');
      return;
    }
    await expect(hub).toBeVisible({ timeout: 5000 });

    // 시나리오1 — 카드 3종 노출 + 긴 제목 카드 겹침 없음(가로 스크롤 미발생).
    await expect(page.getByTestId('docs-hub-opinion')).toBeVisible();
    await expect(page.getByTestId('docs-hub-print')).toBeVisible();
    await expect(page.getByTestId('docs-hub-koh')).toBeVisible();
    const hasHScroll = await hub.evaluate((el) => el.scrollWidth > el.clientWidth + 2);
    expect(hasHScroll, '허브 팝업 가로 스크롤 미발생').toBe(false);

    // 시나리오2 — [서류 발급] 카드 클릭 → DocumentPrintPanel 팝업 전환(진입 무회귀).
    await page.getByTestId('docs-hub-print').click();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('docs-hub-print-dialog')).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'evidence/T-20260624-foot-DOCHUB-POPUP-UI-READABILITY_hub.png', fullPage: true });
  });
});
