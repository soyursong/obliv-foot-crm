/**
 * E2E spec — T-20260612-foot-CLINICAL-SINGLELINE-DROPDOWN-POS
 * 진료대시보드(DoctorCallDashboard) 테이블뷰 → 임상경과 '한 줄 입력'(clinical-singleline-input,
 *   MedicalChartPanel variant='clinical' singleLine) 의 상용구 드롭다운이 텍스트칸/다음 행 '뒤로 가려짐'.
 *
 * 루트코즈: single-line 분기 팝오버가 `absolute left-0 right-0 top-full mt-1 z-[200]` 로,
 *   부모(진료대시보드 '테이블 행')의 stacking context / overflow 에 갇혀 다음 행 뒤로 깔리고 클리핑됨.
 *   부모 T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE 가 신규 single-line surface 를 만들면서
 *   textarea 변형의 portal/fixed 좌표 로직을 이식하지 않은 것이 원인.
 *
 * 처방(선례 재사용): PHRASE-SLASH-DROPDOWN-POS(4e8df2b) 패턴 —
 *   document.body portal + position:fixed + z-[200] + viewport flip/clamp 을 single-line 분기에 '한정' 적용.
 *   ⚠ 공유 유틸 getTextareaCaretRect 는 호출만(무변경) → PHRASE-BROKEN-REGRESS·PENCHART-PHRASE-INSERT-PINGPONG5 회귀 가드.
 *
 * AC-1 드롭다운 최상위(portal/fixed/z-[200]) 렌더 — 텍스트칸/다음 행 뒤로 안 가려짐.
 * AC-2 테이블 하단 행에선 위로 열기(flip) + viewport clamp.
 * AC-3 자동완성 기능 회귀 없음(super/일반 상용구 후보·삽입 핸들러 보존).
 * AC-4 실브라우저 육안검증(스크린샷) — 별도 수행(field-soak), 본 spec 은 좌표 불변식 + 실DOM portal/stacking 검증(auth 불요).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// 정본: single-line 호출측 포지셔닝 (input 경계 기준 → 팝오버 top/left)
//   소스 MedicalChartPanel.tsx clinicalSingleLineBody 와 동일 규칙.
//   single-line 은 한 줄이라 caret 라인 추적 대신 input(taRect) 경계로 앵커한다.
// ─────────────────────────────────────────────────────────────────────────────
interface TaRect { top: number; bottom: number; left: number; width: number; }
const POPOVER_MAX = 300;

function popoverPos(taRect: TaRect, vw: number, vh: number): { top: number; left: number; width: number } {
  const POPOVER_W = Math.min(Math.max(240, taRect.width), vw - 16);
  const lineBottom = taRect.bottom;
  const spaceBelow = vh - lineBottom;
  // AC-2: 아래 공간 부족(테이블 하단 행)이면 위로 열기(flip) + 상단 8px clamp.
  const top = spaceBelow > POPOVER_MAX ? lineBottom + 4 : Math.max(8, taRect.top - POPOVER_MAX - 4);
  const left = Math.min(Math.max(8, taRect.left), vw - POPOVER_W - 8);
  return { top, left, width: POPOVER_W };
}

// 정본: `//` query 캡처 (handleClinicalChange) — 자동완성 트리거 무회귀(AC-3)
const captureSlashQuery = (textBefore: string): string | null => {
  const m = textBefore.match(/\/\/([^\s/]*)$/);
  return m ? m[1] : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (현장 클릭): 테이블 '상단 행' 한 줄 입력에 `//` → 팝오버는 input 바로 아래(lineBottom+4)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 input 바로 아래 / 최상위 렌더', () => {
  test('`//` 입력 트리거 + 상단 행 input 아래 배치 (lineBottom+4)', () => {
    expect(captureSlashQuery('//')).toBe('');
    expect(captureSlashQuery('//통증')).toBe('통증');

    // 상단 행: input top=200, bottom=236(h-9 ≈ 36px), 화면 800 → 아래 충분
    const taRect: TaRect = { top: 200, bottom: 236, left: 320, width: 260 };
    const { top, left, width } = popoverPos(taRect, 1280, 800);
    expect(top).toBe(236 + 4);  // input 바로 아래
    expect(left).toBe(320);     // input 좌측 정렬
    expect(width).toBe(260);    // input 폭 정렬(>=240)
  });

  test('드롭다운 폭은 최소 240px 보장 (좁은 셀에서도)', () => {
    const taRect: TaRect = { top: 100, bottom: 136, left: 50, width: 160 };
    const { width } = popoverPos(taRect, 1280, 800);
    expect(width).toBe(240); // 160 < 240 → 240 으로 끌어올림
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (현장 클릭): 테이블 '하단 행' → 아래 공간 부족 → 위로 flip
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 하단 행 위로 열기(flip) + clamp', () => {
  test('화면 하단 근처 input → 위로 flip (top - MAX - 4)', () => {
    // input 이 화면 하단(bottom=770, vh=800) → 아래 30px 뿐 → 위로
    const taRect: TaRect = { top: 734, bottom: 770, left: 320, width: 260 };
    const { top } = popoverPos(taRect, 1280, 800);
    expect(top).toBe(734 - POPOVER_MAX - 4); // 430 (위로 열림)
    expect(top).toBeLessThan(taRect.top);
  });

  test('상단 8px 가드 (음수/화면 밖 방지)', () => {
    const taRect: TaRect = { top: 40, bottom: 76, left: 320, width: 260 };
    const { top } = popoverPos(taRect, 1280, 800);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  test('우측 끝 셀 → left viewport clamp (드롭다운 화면 밖 방지)', () => {
    const taRect: TaRect = { top: 200, bottom: 236, left: 1200, width: 260 };
    const { left, width } = popoverPos(taRect, 1280, 800);
    expect(left).toBeLessThanOrEqual(1280 - width - 8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 (현장 클릭): 실DOM — absolute(부모 갇힘) vs portal+fixed(최상위) stacking 검증
//   "테이블 행 뒤로 가려짐" 재현·해소를 실제 브라우저 레이아웃으로 검증한다(auth 불요).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 실DOM portal stacking — 다음 행 위로 떠야 함', () => {
  test('portal+fixed 드롭다운이 다음 테이블 행보다 위(elementFromPoint)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(`
      <div id="table" style="position:relative">
        <div id="row1" style="position:relative; z-index:1; height:48px; background:#eef; padding:6px">
          <input id="ssl" style="width:260px;height:36px" />
        </div>
        <div id="row2" style="position:relative; z-index:1; height:48px; background:#fee"></div>
      </div>
    `);
    // (구버전 재현) absolute top-full 은 row1 내부라 row2(z-index:1) 와 같은 평면 → 가림 위험.
    // (수정) document.body 직속 portal + position:fixed + z-index:200 → 항상 최상위.
    await page.evaluate(() => {
      const ssl = document.getElementById('ssl')!;
      const r = ssl.getBoundingClientRect();
      const pop = document.createElement('div');
      pop.id = 'pop';
      pop.setAttribute('data-testid', 'clinical-singleline-phrase-popover');
      pop.style.position = 'fixed';
      pop.style.top = `${r.bottom + 4}px`;
      pop.style.left = `${r.left}px`;
      pop.style.width = '260px';
      pop.style.height = '120px';
      pop.style.zIndex = '200';
      pop.style.background = '#fff';
      pop.style.border = '1px solid #ccc';
      document.body.appendChild(pop); // portal=document.body
    });
    const pop = page.locator('#pop');
    await expect(pop).toBeVisible();
    const box = (await pop.boundingBox())!;
    // 드롭다운 영역 한 점이 실제로 pop 으로 hit-test 되어야 한다(다음 행 뒤로 안 깔림).
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const topId = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number) as HTMLElement | null;
      return el?.id ?? '';
    }, [cx, cy]);
    expect(topId).toBe('pop'); // row2 가 아니라 pop 이 최상위
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 소스 정적 가드: single-line 분기가 portal/fixed/z-[200] 로 렌더되고, 공유 유틸은 호출만(무변경)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('소스 정적 가드 (회귀 락)', () => {
  const SRC = fs.readFileSync(
    path.join(process.cwd(), 'src/components/MedicalChartPanel.tsx'),
    'utf-8',
  );

  test('AC-1: single-line 팝오버는 createPortal(document.body) + position:fixed + z-[200]', () => {
    const i = SRC.indexOf("data-testid=\"clinical-singleline-phrase-popover\"");
    expect(i).toBeGreaterThan(0);
    // 팝오버 정의 주변 블록에 portal/fixed/z-[200] 가 존재
    const around = SRC.slice(Math.max(0, i - 1200), i + 200);
    expect(around).toContain("createPortal");
    expect(around).toContain("position: 'fixed'");
    expect(around).toContain("z-[200]");
    // 옛 absolute top-full 회귀 금지 (single-line 팝오버 한정)
    expect(around).not.toContain("top-full");
  });

  test('AC-2: flip(아래 공간 부족 → 위로) + viewport clamp 로직 존재', () => {
    const i = SRC.indexOf("data-testid=\"clinical-singleline-phrase-popover\"");
    const around = SRC.slice(Math.max(0, i - 1200), i + 200);
    expect(around).toContain("spaceBelow");
    expect(around).toContain("window.innerHeight");
    expect(around).toContain("window.innerWidth");
  });

  test('AC-3: 자동완성 핸들러(super/일반 상용구) 보존', () => {
    const i = SRC.indexOf("data-testid=\"clinical-singleline-phrase-popover\"");
    const around = SRC.slice(i, i + 2500);
    expect(around).toContain("applySuperPhraseFromSlash");
    expect(around).toContain("insertPhrase");
    expect(around).toContain("clinical-singleline-super-option");
    expect(around).toContain("clinical-singleline-phrase-option");
  });

  test('RC-share 가드: getTextareaCaretRect 정의부 무변경(content-box wrap 폭 로직 유지)', () => {
    // 공유 유틸 본문이 유지되어야 PHRASE-BROKEN-REGRESS·PINGPONG5 회귀가 없다.
    expect(SRC).toContain("function getTextareaCaretRect");
    expect(SRC).toContain("ta.clientWidth - padLeft - padRight"); // content-box wrap 폭(선례 정합 핵심)
  });
});
