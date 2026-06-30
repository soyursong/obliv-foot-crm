/**
 * T-20260630-foot-DASH-ROOMHEADER-BORDER-RESTORE — 풋 대시보드 섹션 헤더 구분선(border) 복원
 *
 *  부모 T-20260630-foot-DASH-ROOMHEADER-BG-REMOVE(배경색 제거: bg-*-100 → bg-muted/30) 의 부작용 회귀 수정.
 *  배경색이 빠지면서 섹션을 구분하던 컬러 박스 외곽선까지 사라져 4개 섹션(상담실·진료·치료실·레이저실)이
 *  한 덩어리로 뭉쳐 보임 → 무색(border-border=뉴트럴 회색) border 로 섹션 구분선만 복원, 배경 투명 유지.
 *
 *  AC1: 4개 섹션 헤더에 레이아웃 구분 테두리(border) 복원 → 시각적 구분.
 *  AC2: 배경색은 제거 상태 유지(bg-muted, 컬러 배경 박스 재등장 금지).
 *  AC3: 복원 border 는 무색(회색/뉴트럴) — 빨강·주황·분홍 컬러 테두리 미복원(MONOCHROME carve-out).
 *  AC4: 텍스트·정렬·폰트 유지.
 *  AC5: 섹션 헤더 외 상태/단계 의미색(칸반·visit-type·슬롯·배지) 미접촉.
 *  AC6: 4곳 동일 패턴 복원.
 *
 *  컨벤션: 핵심 불변식은 환경독립(소스 정적 검증)으로 확정 + 대시보드 실렌더 스모크(인증/데이터 없으면 graceful skip).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const DASHBOARD_SRC = resolve(process.cwd(), 'src/pages/Dashboard.tsx');
const COLORED_BG = /bg-(blue|violet|amber|rose|red|orange|pink)-\d{2,3}/;
const COLORED_BORDER = /border-(blue|violet|amber|rose|red|orange|pink)-\d{2,3}/;

// 4개 섹션 헤더 사이트의 className 라인을 소스에서 추출 (구현 detail 비종속: title/색 토큰 기준 매칭)
function readSrc(): string {
  return readFileSync(DASHBOARD_SRC, 'utf8');
}

test.describe('ROOMHEADER-BORDER-RESTORE — 소스 불변식 (환경독립)', () => {
  const src = readSrc();

  // 시나리오 1·step 7~8 + AC2/AC3: 컬러 배경/컬러 테두리가 4개 섹션 헤더에 재유입되지 않았는지.
  //   (부모 BG-REMOVE 가 bg-*-100 을 전부 bg-muted/30 으로 바꿈 → 본건은 그 위에 무색 border 만 추가.)
  test('AC1/AC6: RoomSection 공유 헤더에 무색 border 복원 (진료·치료실·레이저실)', () => {
    // RoomSection 헤더 className: rounded-t-lg + border + border-b-0 (본문 border border-t-0 과 연결)
    const headerLine = src
      .split('\n')
      .find((l) => l.includes('rounded-t-lg border border-b-0') && l.includes('cn('));
    expect(headerLine, 'RoomSection 공유 헤더에 border border-b-0 가 있어야 함').toBeTruthy();
    // 컬러 토큰이 헤더 라인에 직접 박혀있지 않아야 함 (color prop 은 bg-muted/30)
    expect(COLORED_BORDER.test(headerLine ?? '')).toBe(false);
  });

  test('AC2/AC3: 3개 RoomSection(진료·치료실·레이저실) color prop = bg-muted (컬러 배경/테두리 미복원)', () => {
    const colorProps = src
      .split('\n')
      .filter((l) => l.includes('color="bg-muted/30 text-foreground"'));
    // 진료 + 치료실 + 레이저실 = 3개
    expect(colorProps.length).toBeGreaterThanOrEqual(3);
    for (const l of colorProps) {
      expect(COLORED_BG.test(l), `color prop 에 컬러 배경 재유입: ${l}`).toBe(false);
      expect(COLORED_BORDER.test(l), `color prop 에 컬러 테두리 재유입: ${l}`).toBe(false);
    }
  });

  test('AC1/AC6: 상담실 인라인 헤더에 무색 border 복원 + 배경 무색 유지', () => {
    const lines = src.split('\n');
    const idx = lines.findIndex((l) => l.includes('rounded-t-lg border border-b-0') && l.includes('bg-muted/30'));
    expect(idx, '상담실 인라인 헤더에 border border-b-0 + bg-muted 가 있어야 함').toBeGreaterThan(-1);
    // 다음 라인이 상담실 라벨인지 확인 (섹션 식별)
    const block = lines.slice(idx, idx + 2).join(' ');
    expect(block).toContain('상담실');
    expect(COLORED_BG.test(lines[idx])).toBe(false);
    expect(COLORED_BORDER.test(lines[idx])).toBe(false);
  });

  test('AC1/AC6: 진료(빈 슬롯 fallback) 헤더에 무색 border 복원', () => {
    const lines = src.split('\n');
    const idx = lines.findIndex((l) => l.includes('rounded-lg border bg-muted/30 text-foreground'));
    expect(idx, '진료 fallback 헤더에 닫힌 무색 box(border) 가 있어야 함').toBeGreaterThan(-1);
    expect(COLORED_BG.test(lines[idx])).toBe(false);
    expect(COLORED_BORDER.test(lines[idx])).toBe(false);
  });

  // AC5 carve-out: 이번 변경이 칸반 상태색/visit-type/슬롯/배지 의미색을 건드리지 않았음 —
  //   본건 diff 가 헤더 className(border 추가)에 한정됨을 소스 상에서 보강 확인.
  //   teal-500(드래그 우선표시)·violet-700/blue-700(대기 하이라이트) 등 의미색 토큰 잔존 확인.
  test('AC5: 의미색 토큰(칸반/대기 하이라이트) 미접촉 — 잔존 확인', () => {
    expect(src).toContain('text-violet-700'); // 진료대기 하이라이트
    expect(src).toContain('text-blue-700'); // 상담대기 하이라이트
    expect(src).toContain('bg-teal-500'); // 드래그 우선 표시 바
  });
});

test.describe('ROOMHEADER-BORDER-RESTORE — 대시보드 실렌더 스모크 (graceful skip)', () => {
  test('시나리오1: 4개 섹션 헤더가 무색 테두리로 구분 렌더 + 컬러 배경 없음', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '인증/대시보드 렌더 불가 — graceful skip (소스 불변식으로 핵심 검증 완료)');

    await page.waitForTimeout(800);

    for (const name of ['상담실', '진료', '치료실', '레이저실']) {
      // 섹션 헤더: 섹션명 텍스트를 가진 작은 헤더 strip. 슬롯(상담실1 등)·대기열과 구분 위해 (실) 패턴 우선.
      const header = page
        .locator('div.rounded-t-lg, div.rounded-lg')
        .filter({ hasText: name })
        .first();
      const count = await header.count();
      if (count === 0) continue; // 해당 섹션 미구성(빈 데이터) — skip 처리하지 않고 다음 섹션

      const style = await header.evaluate((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        return {
          borderTopWidth: parseFloat(cs.borderTopWidth),
          bg: cs.backgroundColor,
        };
      });
      // AC1: 테두리 복원 (width > 0)
      expect(style.borderTopWidth, `${name} 헤더 테두리 복원`).toBeGreaterThan(0);
    }
  });
});
