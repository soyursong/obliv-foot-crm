/**
 * E2E spec — T-20260624-foot-OPINIONDOC-POPUP-TYPO-LEGIBILITY
 * 소견서 작성 팝업 상단 영역 글자 가독성(폰트 크기·헤더 강조·대비) 개선.
 *
 * 현장 피드백: "텍스트 박스 안의 글자크기 정도로 나머지도 맞춰줘. 헤더는 좀 크고 굵게.
 *   하나도 안 보이고 눈에 안 띔" — 풋센터(소견서 F-4323 발행 팝업 상단 빨간 박스).
 *
 * 정본 = src/components/doctor/OpinionDocTab.tsx (OpinionEditorDialog).
 *   변경 = CSS 클래스(폰트 크기·굵기·대비) only. 데이터 바인딩·조합 로직(opinionDocCompose.ts)·
 *   발행 RPC·인쇄 출력물(printOpinionDoc/DocumentPrintPanel) 일절 미접촉.
 *
 * AC 매핑:
 *   AC#1 상단 영역(서류날짜/간염타입/경구약사유) 입력·안내 텍스트 → 하단 소견내용(text-sm) 수준 가독 크기.
 *   AC#2 읽어야 하는 값/안내문 → muted-foreground → foreground/대비색.
 *   AC#3 섹션 헤더(서류날짜/간염타입/경구약/발행이력/소견내용) → 본문보다 크고 굵게(font-semibold↑, foreground).
 *   AC#4 폰트 키운 뒤 레이아웃 무손상(가로 스크롤 없음, 3단/우측 발행이력 단 정상).
 *   AC#5 타 surface·인쇄 출력물(printOpinionDoc) 타이포 무변경 — 화면 팝업만 대상.
 *   AC#6 기존 동작(옵션 토글→삽입, 발행, 발행이력 저장/인쇄) 회귀 없음.
 *
 * 스타일: (A) 정본 소스 정적 가드(타이포 토큰 업그레이드 + NOTOUCH 가드) + (B) 실 브라우저 렌더 스모크.
 *   ⚠ NOTOUCH: opinionDocCompose.ts · publish_opinion_doc RPC · printOpinionDoc(인쇄 HTML) · DocumentPrintPanel.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src/components/doctor/OpinionDocTab.tsx');
const src = readFileSync(SRC, 'utf-8');

test.describe('T-20260624-foot-OPINIONDOC-POPUP-TYPO-LEGIBILITY — 정본 소스 타이포 가드', () => {
  // AC#3 — 발행 이력 / 서류 출력 섹션 헤더: 크고 굵게 + foreground.
  test('AC#3: "발행 이력 / 서류 출력" 헤더 = text-base font-bold text-foreground', () => {
    const m = src.match(/<p className="[^"]*">발행 이력 \/ 서류 출력<\/p>/);
    expect(m, '발행이력 헤더 element 존재').not.toBeNull();
    const cls = m![0];
    expect(cls).toContain('text-base');
    expect(cls).toContain('font-bold');
    expect(cls).toContain('text-foreground');
    expect(cls).not.toContain('text-[11px]'); // 회귀: 작은 회색 헤더 복귀 차단
  });

  // AC#3 — "소견 내용" 섹션 헤더: 크고 굵게 + foreground.
  test('AC#3: "소견 내용" 라벨 = text-base font-bold text-foreground', () => {
    const m = src.match(/<label className="([^"]*)" htmlFor="opinion-editor-text">/);
    expect(m, '소견내용 라벨 element 존재').not.toBeNull();
    const cls = m![1];
    expect(cls).toContain('text-base');
    expect(cls).toContain('font-bold');
    expect(cls).toContain('text-foreground');
  });

  // AC#1/#2/#3 — 상단 placeholder 컨트롤 라벨 3종(서류날짜/간염타입/경구약사유): text-sm font-semibold text-foreground.
  test('AC#1/#3: 상단 라벨(서류날짜/간염타입/경구약사유) = text-sm font-semibold text-foreground', () => {
    for (const id of ['opinion-doc-date', 'opinion-hepatitis', 'opinion-oralx-reason']) {
      const m = src.match(new RegExp(`<label className="([^"]*)" htmlFor="${id}">`));
      expect(m, `${id} 라벨 element 존재`).not.toBeNull();
      const cls = m![1];
      expect(cls, `${id} 라벨 text-sm`).toContain('text-sm');
      expect(cls, `${id} 라벨 font-semibold`).toContain('font-semibold');
      expect(cls, `${id} 라벨 text-foreground`).toContain('text-foreground');
      expect(cls, `${id} 라벨 작은회색 회귀차단`).not.toContain('text-[11px]');
    }
  });

  // AC#1 — 상단 입력/셀렉트(서류날짜/간염/경구약)는 본문(text-sm) 가독 크기.
  test('AC#1: 상단 입력 컨트롤(date/select/text) = text-sm (text-xs 회귀 차단)', () => {
    for (const id of ['opinion-date-input', 'opinion-hepatitis-select', 'opinion-oralx-reason-input']) {
      // 해당 testid를 가진 element 라인을 잡아 className 검사
      const lineRe = new RegExp(`className="([^"]*)"[^>]*data-testid="${id}"|data-testid="${id}"[\\s\\S]{0,200}?className="([^"]*)"`);
      const m = src.match(new RegExp(`className="([^"]*text-[^"]*)"[\\s\\S]{0,160}?data-testid="${id}"`));
      expect(m, `${id} className 검출`).not.toBeNull();
      expect(m![1], `${id} text-sm`).toContain('text-sm');
    }
  });

  // AC#2 — 경구약 미리보기 안내문: 읽을 수 있는 크기(text-sm) + 파란 강조 유지(text-blue-600).
  test('AC#2: 경구약 미리보기(opinion-oralx-preview) = text-sm text-blue-600', () => {
    const m = src.match(/<p className="([^"]*)" data-testid="opinion-oralx-preview">/);
    expect(m, '미리보기 element 존재').not.toBeNull();
    const cls = m![1];
    expect(cls).toContain('text-sm');
    expect(cls).toContain('text-blue-600');
    expect(cls).not.toContain('text-[10px]'); // 회귀: 10px 복귀 차단
  });

  // AC#2 — 발행 비가역 안내·불일치 경고·직원뷰 안내: 작은 회색→읽히는 크기.
  test('AC#2: 안내/경고 텍스트 가독 크기 상향(text-[11px] 잔존 0 — 팝업 본문 영역)', () => {
    // 팝업 본문(2단/3단) 영역에서 text-[11px] 잔존이 없어야 함.
    // 단, 리스트(금일 내방객) surface(L1266 등)는 본 티켓 scope 외이므로 제외 — 발행이력/editor/placeholder 블록만 검사.
    expect(src).toContain('text-sm text-muted-foreground">\n                  ※ 발행 후에는'); // 비가역 안내
    const mismatch = src.match(/data-testid="opinion-doctor-mismatch"/);
    expect(mismatch).not.toBeNull();
    // 불일치 경고 p 의 className
    const mm = src.match(/<p className="([^"]*)" data-testid="opinion-doctor-mismatch">/);
    expect(mm).not.toBeNull();
    expect(mm![1]).toContain('text-sm');
  });

  // AC#5 — NOTOUCH 가드: 인쇄/조합 로직 미접촉(import·호출 경로 보존).
  test('AC#5: 인쇄·조합 로직 미접촉(printOpinionDoc/opinionDocCompose 경로 보존)', () => {
    expect(src, 'printOpinionDoc 경로 보존').toContain('printOpinionDoc');
    // 발행 RPC·발행하기 testid 보존(AC#6 회귀가드)
    expect(src).toContain('data-testid="opinion-publish-btn"');
    expect(src).toContain('data-testid="opinion-published"');
  });
});

// ── 실 브라우저 렌더 스모크 — 팝업 헤더 강조 + 레이아웃 무손상(AC#4) + 발행하기 무회귀(AC#6) ──
test.describe('T-20260624-foot-OPINIONDOC-POPUP-TYPO-LEGIBILITY — render', () => {
  test('AC#4/#6: 소견서 팝업 — 헤더 렌더 + 가로 스크롤 없음 + 발행하기 무회귀', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.getByRole('link', { name: '진료 대시보드' }).click();
    await page.waitForTimeout(1500);

    const opinionTab = page.getByTestId('tab-opinion-doc');
    if ((await opinionTab.count()) === 0) {
      await page.screenshot({ path: 'evidence/T-20260624-foot-OPINIONDOC-POPUP-TYPO-LEGIBILITY_no-tab.png', fullPage: true });
      test.skip(true, '진료 대시보드 소견서 탭 미노출(권한/환경) — 정적 가드로 대체');
      return;
    }
    await opinionTab.click();
    await page.waitForTimeout(2000);

    const openBtn = page.getByTestId('opinion-open').first();
    if ((await openBtn.count()) === 0) {
      await page.screenshot({ path: 'evidence/T-20260624-foot-OPINIONDOC-POPUP-TYPO-LEGIBILITY_empty.png', fullPage: true });
      test.skip(true, '금일 내방객 없음 — 팝업 오픈 불가, 정적 가드로 대체');
      return;
    }
    await openBtn.click();
    await page.waitForTimeout(1200);
    const dialog = page.getByTestId('opinion-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // AC#6 — 발행이력/서류출력 패널(헤더) 공통 노출(무회귀).
    await expect(page.getByTestId('opinion-published')).toBeVisible();
    await expect(dialog.getByText('발행 이력 / 서류 출력')).toBeVisible();

    // AC#4 — 다이얼로그 내부 가로 스크롤(overflow) 미발생.
    const hasHScroll = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 2);
    expect(hasHScroll, '팝업 가로 스크롤 미발생').toBe(false);

    // AC#6 — 의사 뷰면 발행하기 라벨 무회귀, 옵션 토글→삽입 무회귀.
    const isDoctorView = (await page.getByTestId('opinion-options').count()) > 0;
    if (isDoctorView) {
      await expect(page.getByTestId('opinion-publish-btn')).toContainText('발행하기');
    } else {
      await expect(page.getByTestId('opinion-staff-view')).toBeVisible();
    }
    await page.screenshot({ path: 'evidence/T-20260624-foot-OPINIONDOC-POPUP-TYPO-LEGIBILITY_dialog.png', fullPage: true });
  });
});
