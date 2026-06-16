/**
 * E2E spec — T-20260616-foot-CRM-COLUMN-TEXT-CRUSHED
 * 진료대시보드(의료차트 환자목록 = DoctorPatientList) 칼럼 셀 텍스트 '세로뜨기/압축' 회귀 수정 검증.
 * (문지은 대표원장 6/16, 스크린샷 F0BAU9239R8: 칼럼 셀 글씨가 한 글자씩 세로로 배열되고 폭 압축으로 눌림.)
 *
 * 원인(회귀): T-20260615 FONT-PRETENDARD-GLOBAL(글리프 메트릭 확대) + T-20260613/14 컬럼폭 타이트화로
 *   배지(VisitTypeBadge/StatusCell/PrescriptionStatusBadge/HealerLaserBadge)의 한글 라벨이 좁은 트랙에서
 *   - 다단어 라벨('처방전 O','레이저 ✅')은 공백에서 줄바꿈
 *   - 단일 한글어('진료완료','초진')는 CJK 문자 사이 자동 줄바꿈
 *   → '세로로 뜨고' 증상. 데이터 텍스트 셀(이름/차트번호/처방/메모)은 이미 truncate(=nowrap)라 안전.
 *
 * 수정(FE-only, GO): 위 배지 span 전부에 `whitespace-nowrap` 추가 → 세로 wrap 차단.
 *   자형/자간 무변경(폭 부족은 nowrap으로 한 줄 유지 — 압축의 원인인 wrap 제거). 컬럼폭(grid-template) 보존(AC-3).
 *
 * 검증 대상:
 *   AC-1/2: 셀 텍스트 세로뜨기/압축 없이 가로 1줄 렌더, 데이터 셀은 폭 부족 시 ellipsis(…).
 *   AC-3: 인접 칼럼·colwidth 보존 — 오늘/이력 모드 grid-cols 템플릿(T-20260613/14 작업분) 무변경.
 *
 * 스타일: (1) 소스 가드(배지 className에 whitespace-nowrap 존재) + (2) 실제 렌더(좁은 셀에서 nowrap 단일행/ellipsis)
 *   + (3) 회귀 가드(grid 템플릿 문자열 보존). 인접 spec(COLWIDTH/DATEMODE)과 동일한 정본-모사 패턴.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirnameLocal, '../../src/components/doctor/DoctorPatientList.tsx');
const source = readFileSync(SRC, 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 소스 가드 — 진료대시보드 배지 라벨 전부 whitespace-nowrap (세로 wrap 차단 SSOT)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 배지 nowrap 소스 가드(AC-1/2)', () => {
  // 한글 라벨을 렌더하는 배지 span들 — 좁은 칼럼에서 세로 wrap 나던 지점.
  const badgeAnchors = [
    { name: '처방전 O(confirmed sky)', anchor: 'border-sky-200 bg-sky-100' },
    { name: '임시(pending amber)', anchor: 'bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700' },
    { name: '처방전 X(none gray)', anchor: 'border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400' },
    { name: 'VisitTypeBadge(초진/재진)', anchor: 'data-testid="visit-type-badge"' },
    { name: 'StatusCell 진료완료(pink emerald)', anchor: 'data-state="treatment-done"' },
    { name: 'StatusCell 귀가(done gray)', anchor: 'bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600' },
    { name: 'HealerLaserBadge(레이저 ✅/❌)', anchor: 'data-testid="healer-laser-badge"' },
  ];

  for (const { name, anchor } of badgeAnchors) {
    test(`${name} 배지 span에 whitespace-nowrap 존재`, () => {
      const idx = source.indexOf(anchor);
      expect(idx, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
      // anchor 주변(앞 240자) className 블록에 whitespace-nowrap 동반 — 같은 span의 클래스 문자열.
      const window = source.slice(Math.max(0, idx - 240), idx + anchor.length);
      expect(window, `${name}: whitespace-nowrap 누락 → 세로 wrap 재발`).toContain('whitespace-nowrap');
    });
  }

  test('in-clinic 상태 셀은 truncate(=nowrap 포함) 유지', () => {
    expect(source).toContain('truncate" data-testid="status-cell" data-state="in-clinic"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 실제 렌더 — 좁은 칼럼에서 nowrap 단일행 + ellipsis(데이터 셀), wrap 미발생
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 좁은 셀 렌더 — 세로 wrap 차단(AC-1/2)', () => {
  test('배지 라벨: nowrap이면 한글이 좁은 트랙에서도 1줄(세로 stack 금지)', async ({ page }) => {
    // 동일한 좁은 트랙(20px, 한글 1~2자 폭)에 같은 라벨. nowrap=1줄 vs normal+break=세로 stack 대조.
    await page.setContent(`
      <div style="font-family: Pretendard, sans-serif; font-size: 10px; line-height: 1.2;">
        <span id="fixed" style="display:inline-block; width:20px; white-space:nowrap;">진료완료</span>
        <hr/>
        <span id="broken" style="display:inline-block; width:20px; white-space:normal; word-break:break-all;">진료완료</span>
      </div>
    `);
    const fixedH = await page.locator('#fixed').evaluate((el) => (el as HTMLElement).clientHeight);
    const brokenH = await page.locator('#broken').evaluate((el) => (el as HTMLElement).clientHeight);
    // nowrap = 1줄, normal+break = 여러 줄(세로 stack). 수정 후 모든 배지는 fixed 거동.
    expect(fixedH).toBeLessThan(brokenH);
    // 1줄 높이 가드(line-height 1.2 * 10px ≈ 12px, 여유 18px 미만).
    expect(fixedH).toBeLessThan(18);
  });

  test('데이터 셀: nowrap+overflow-hidden+ellipsis → 폭 부족 시 말줄임(세로 wrap 아님)', async ({ page }) => {
    await page.setContent(`
      <div style="font-family: Pretendard, sans-serif; font-size: 13px; line-height: 1.3;">
        <span id="name" style="display:inline-block; max-width:80px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">홍길동홍길동홍길동홍길동</span>
      </div>
    `);
    const el = page.locator('#name');
    const h = await el.evaluate((n) => (n as HTMLElement).clientHeight);
    const overflow = await el.evaluate((n) => {
      const s = getComputedStyle(n as HTMLElement);
      return { ws: s.whiteSpace, ov: s.overflow, te: s.textOverflow, scroll: (n as HTMLElement).scrollWidth, client: (n as HTMLElement).clientWidth };
    });
    expect(overflow.ws).toBe('nowrap');
    expect(overflow.te).toBe('ellipsis');
    expect(overflow.scroll).toBeGreaterThan(overflow.client); // 실제로 넘쳐서 말줄임 발동
    expect(h).toBeLessThan(22); // 1줄 유지(세로 stack 아님)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 회귀 가드 — 컬럼폭(grid-template) 보존(AC-3, T-20260613/14 작업분 무변)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 colwidth 회귀 가드(AC-3)', () => {
  test('오늘 모드 grid-cols 템플릿 보존', () => {
    expect(source).toContain(
      'grid-cols-[4.75rem_3.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto]',
    );
  });

  test('이력 모드 grid-cols 템플릿 보존', () => {
    expect(source).toContain('grid-cols-[3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto_auto]');
  });

  test('데이터 셀 truncate(이름/차트번호) 보존 — ellipsis 동선 유지', () => {
    expect(source).toContain('truncate text-left text-[15px] font-semibold text-gray-900'); // 이름
    expect(source).toContain('truncate text-left font-mono text-[13px] text-gray-500'); // 차트번호
  });

  test('자형/자간 직접 조작 흔적 없음 — letter-spacing/tracking/scaleX 미사용(폭/wrap 처리로만 해소)', () => {
    // 이 티켓은 자간/자형 손대지 말 것(planner). 압축은 폭 부족 결과 → nowrap으로만 해소.
    expect(source).not.toContain('letter-spacing');
    expect(source).not.toMatch(/tracking-(tighter|tight|wide|wider|widest)/);
    expect(source).not.toContain('scaleX');
  });
});
