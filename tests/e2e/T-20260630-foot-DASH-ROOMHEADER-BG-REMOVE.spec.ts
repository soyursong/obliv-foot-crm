/**
 * T-20260630-foot-DASH-ROOMHEADER-BG-REMOVE — 풋 대시보드 섹션 헤더 배경색 제거
 *
 *  대시보드 좌측 룸별 섹션 헤더 4개(상담실·진료·치료실·레이저실)의 컬러 배경 박스 제거.
 *  bg-blue-100 / bg-violet-100 / bg-amber-100 / bg-rose-100 → bg-muted/30 (무색 중립 톤)으로 통일.
 *  코드 적용: 84e2817c(BG-REMOVE) + a4176597(BORDER-RESTORE: 무색 외곽선만 재추가, 배경 무색 유지).
 *
 *  AC1(시나리오1): 4개 섹션 헤더 배경이 컬러 박스(빨강/주황/분홍/파랑/보라) → 무색(bg-muted) 기본 배경.
 *  AC2: 텍스트·"(N실)"·정렬·폰트·레이아웃 유지(색 토큰만 변경, 레이아웃 시프트 없음).
 *  AC3(시나리오2 / carve-out): 섹션 헤더 外 상태/단계 의미색(칸반 상태색·visit-type·활성/비활성 슬롯·
 *      미수/완료 배지·대기 하이라이트) 미접촉. 무색 헤더(진료대기/치료대기/힐러대기/레이저대기) 현행 유지.
 *
 *  컨벤션: 핵심 불변식은 환경독립(소스 정적 검증)으로 확정 + 대시보드 실렌더 스모크(인증/데이터 없으면 graceful skip).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const DASHBOARD_SRC = resolve(process.cwd(), 'src/pages/Dashboard.tsx');
// BG-REMOVE 대상이던 구 컬러 배경 토큰(연한 -100 틴트). 섹션 헤더 라인에 재유입 금지.
const REMOVED_HEADER_BG = /bg-(blue|violet|amber|rose)-100/;
const ANY_COLORED_BG = /bg-(blue|violet|amber|rose|red|orange|pink)-\d{2,3}/;

function readSrc(): string {
  return readFileSync(DASHBOARD_SRC, 'utf8');
}

test.describe('ROOMHEADER-BG-REMOVE — 소스 불변식 (환경독립)', () => {
  const src = readSrc();

  // 시나리오1 / AC1: 4개 룸 섹션 헤더 색 토큰이 무색(bg-muted/30 text-foreground)로 통일됐는지.
  //   진료·치료실·레이저실 = RoomSection color prop, 상담실 = 인라인 헤더 className.
  test('AC1: 3개 RoomSection(진료·치료실·레이저실) color prop = bg-muted (컬러 배경 미잔존)', () => {
    const colorProps = src
      .split('\n')
      .filter((l) => l.includes('color="bg-muted/30 text-foreground"'));
    // 진료 + 치료실 + 레이저실 = 최소 3개
    expect(colorProps.length, '3개 RoomSection이 무색 color prop을 가져야 함').toBeGreaterThanOrEqual(3);
    for (const l of colorProps) {
      expect(REMOVED_HEADER_BG.test(l), `구 컬러 배경(-100) 재유입: ${l}`).toBe(false);
      expect(ANY_COLORED_BG.test(l), `컬러 배경 재유입: ${l}`).toBe(false);
    }
  });

  test('AC1/AC2: 상담실 인라인 헤더 = 무색 배경 + "(N실)" 라벨 유지', () => {
    const lines = src.split('\n');
    const idx = lines.findIndex(
      (l) => l.includes('bg-muted/30 text-foreground') && l.includes('rounded-t-lg'),
    );
    expect(idx, '상담실 인라인 헤더(rounded-t-lg + bg-muted)가 있어야 함').toBeGreaterThan(-1);
    const block = lines.slice(idx, idx + 3).join(' ');
    expect(block, '상담실 라벨 유지').toContain('상담실');
    expect(block, '"(N실)" 카운트 라벨 유지').toContain('실)');
    expect(ANY_COLORED_BG.test(lines[idx]), '상담실 헤더 컬러 배경 미잔존').toBe(false);
  });

  // AC1: 컬러 헤더로 회귀하는 4개 구 토큰이 소스 전체에서 섹션 헤더로 부활하지 않았는지(전역 가드).
  test('AC1: 구 섹션 헤더 컬러 토큰(bg-*-100)이 RoomSection/상담실 헤더 라인에서 제거됨', () => {
    const headerLikeLines = src
      .split('\n')
      .filter(
        (l) =>
          (l.includes('color="bg-') || l.includes('text-xs font-bold')) &&
          REMOVED_HEADER_BG.test(l),
      );
    expect(
      headerLikeLines,
      `구 컬러 헤더 토큰이 섹션 헤더 라인에 잔존: ${headerLikeLines.join(' | ')}`,
    ).toHaveLength(0);
  });

  // 시나리오2 / AC3 carve-out: 헤더 外 의미색(칸반/대기 하이라이트/드래그바/배지) 미접촉 — 잔존 확인.
  test('AC3: carve-out 의미색 토큰 미접촉 — 잔존 확인', () => {
    expect(src, '진료대기 하이라이트').toContain('text-violet-700');
    expect(src, '상담대기 하이라이트').toContain('text-blue-700');
    expect(src, '수납대기 하이라이트').toContain('text-purple-700');
    expect(src, '드래그 우선표시 바').toContain('bg-teal-500');
    expect(src, '상담실 미배정 경고 배너(amber)').toContain('bg-amber-50');
  });
});

test.describe('ROOMHEADER-BG-REMOVE — 대시보드 실렌더 스모크 (graceful skip)', () => {
  // 시나리오1: 4개 섹션 헤더가 무색(컬러 없는) 배경으로 렌더되는지.
  test('시나리오1: 4개 섹션 헤더 배경이 컬러 톤(파랑/보라/주황/분홍)이 아님', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '인증/대시보드 렌더 불가 — graceful skip (소스 불변식으로 핵심 검증 완료)');

    await page.waitForTimeout(800);

    // 제거된 컬러 틴트들의 대략적 RGB 채도 가드: 헤더 배경이 강한 단색 틴트가 아니어야 함.
    for (const name of ['상담실', '진료', '치료실', '레이저실']) {
      const header = page
        .locator('div.rounded-t-lg, div.rounded-lg')
        .filter({ hasText: name })
        .first();
      if ((await header.count()) === 0) continue; // 빈 데이터 섹션 — 다음으로

      const bg = await header.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
      // bg-muted/30 = 매우 옅은 중립 회색(채널 간 편차 작음). 구 -100 틴트는 특정 채널이 두드러짐.
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const [r, g, b] = m[1].split(',').map((v) => parseFloat(v));
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      expect(spread, `${name} 헤더 배경이 무채색(중립)이어야 함 — spread=${spread} bg=${bg}`).toBeLessThan(24);
    }
  });
});
