import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260612-foot-WEEKCAL-HEADER-CARD-REDESIGN
 * 예약관리 주간 캘린더 — 시간대/요일 헤더 건수(2번) + 예약카드 색상박스(3번) 레이아웃 전면 재작업.
 * 원천: 김주연 총괄(C0ATE5P6JTH) MSG-20260612-133044-lv6e. ref: 롱래CRM 오블리브 One 주간뷰(F0B9MDF34UF).
 *
 * 범위(FE-only, db_change=false):
 *   2번 헤더 건수  — 요일 컬럼 헤더 + 슬롯 셀 건수를 칩/뱃지형으로 재디자인(초=초록/재=파랑/HL=노랑 칩).
 *   3번 예약카드   — 좌측 4px 컬러 액센트 + 풀 파스텔 배경 + 패딩/여백/타이포 롱래CRM 수준 재작업.
 *   색상 코딩 유지 — 초진=emerald / 재진=blue / 힐러(HL)=yellow.
 *
 * GUARD: 색상 코딩 임의 변경 금지. 클릭/우클릭/드래그/주간 네비 회귀 0. 건수=기존 reservations 집계.
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating + smoke. 실 렌더는 supervisor field-soak.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — 시간대/요일 헤더 건수 칩/뱃지형 재디자인 (2번)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1: 헤더 건수 칩형 재디자인 (2번)', () => {
  test('AC1-1: 요일 헤더 건수가 색상별 칩(rounded-full + bg)으로 표기', () => {
    expect(RESV_PAGE, '날짜 요약 testid 누락(회귀)').toContain('day-summary-');
    const m = RESV_PAGE.match(/data-testid=\{`day-summary-[\s\S]*?<\/div>\s*\);/);
    expect(m, 'day-summary 블록 파싱 실패').toBeTruthy();
    const body = m![0];
    // 초/재/HL 각 칩에 rounded-full + 색상 bg
    expect(body, '초진 칩(emerald rounded-full) 누락').toMatch(/rounded-full[^']*bg-emerald-100[\s\S]*?초 \{c\.n\}/);
    expect(body, '재진 칩(blue rounded-full) 누락').toMatch(/rounded-full[^']*bg-blue-100[\s\S]*?재 \{c\.r\}/);
    expect(body, 'HL 칩(yellow rounded-full) 누락').toMatch(/rounded-full[^']*bg-yellow-100[\s\S]*?HL \{c\.h\}/);
  });

  test('AC1-2: 총건수(초진+재진) 유지 — HL 합산 제외(회귀)', () => {
    expect(RESV_PAGE, '총건수가 초진+재진 합이 아님').toContain('총 {c.n + c.r}');
  });

  test('AC1-3: 슬롯 셀 건수도 칩형(rounded-full + bg)으로 일관', () => {
    expect(RESV_PAGE, '슬롯 카운트 testid 누락(회귀)').toContain('slot-kind-count-');
    const m = RESV_PAGE.match(/data-testid=\{`slot-kind-count-[\s\S]*?<\/div>\s*\);/);
    expect(m, 'slot-kind-count 블록 파싱 실패').toBeTruthy();
    const body = m![0];
    expect(body, '슬롯 초진 칩(emerald) 누락').toMatch(/rounded-full[^']*bg-emerald-100[\s\S]*?초 \{n\}/);
    expect(body, '슬롯 재진 칩(blue) 누락').toMatch(/rounded-full[^']*bg-blue-100[\s\S]*?재 \{rr\}/);
    expect(body, '슬롯 HL 칩(yellow) 누락').toMatch(/rounded-full[^']*bg-yellow-100[\s\S]*?HL \{h\}/);
  });

  test('AC1-4: 슬롯 건수 집계는 취소 제외 active 기준 유지(회귀)', () => {
    expect(RESV_PAGE, '슬롯 카운트가 취소 제외 active 기준 아님')
      .toContain("const active = list.filter((r) => r.status !== 'cancelled')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — 예약카드 색상박스 레이아웃 재작업 + 색상 코딩 유지 (3번)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-2: 카드 색상박스 재작업 (3번)', () => {
  test('AC2-1: KIND_CARD_STYLE 색상 코딩 유지 — 초진=emerald/재진=blue/힐러=yellow', () => {
    const m = RESV_PAGE.match(/const KIND_CARD_STYLE: Record<ResvKind, string> = \{([\s\S]*?)\};/);
    expect(m, 'KIND_CARD_STYLE 미정의').toBeTruthy();
    const body = m![1];
    expect(body, '초진=초록(emerald) 아님').toMatch(/new:\s*'[^']*emerald/);
    expect(body, '재진=파랑(blue) 아님').toMatch(/returning:\s*'[^']*blue/);
    expect(body, '힐러=노랑(yellow) 아님').toMatch(/healer:\s*'[^']*yellow/);
  });

  test('AC2-2: 카드 좌측 컬러 액센트 강화(border-l-4) + 풀 파스텔 배경', () => {
    const m = RESV_PAGE.match(/const KIND_CARD_STYLE: Record<ResvKind, string> = \{([\s\S]*?)\};/);
    const body = m![1];
    expect(body, '좌측 액센트 border-l-4 누락').toContain('border-l-4');
    // 풀 파스텔(bg-*-50, 이전 bg-*-50/60 투명도 제거)
    expect(body, '초진 풀 파스텔 배경(bg-emerald-50) 아님').toMatch(/new:\s*'[^']*bg-emerald-50'/);
  });

  test('AC2-3: 카드 색 적용은 KIND_CARD_STYLE(resvKind(r)) 경유 유지(회귀)', () => {
    expect(RESV_PAGE, '카드 색 적용이 KIND_CARD_STYLE(resvKind) 경유 아님')
      .toContain('KIND_CARD_STYLE[resvKind(r)]');
    expect(RESV_PAGE, '유형 점 색이 KIND_DOT 경유 아님').toContain('KIND_DOT[resvKind(r)]');
  });

  test('AC2-4: 카드 패딩/여백/타이포 개선 — px-2 py-1 + rounded-md + leading-snug', () => {
    // 카드 base className 라인
    expect(RESV_PAGE, '카드 패딩 px-2 py-1 미적용').toMatch(/rounded-md border px-2 py-1 text-xs leading-snug/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — 회귀 가드 (클릭/우클릭/드래그/주간 네비)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-3: 회귀 가드', () => {
  test('AC3-1: 카드 testid + draggable + 우클릭 컨텍스트메뉴 핸들러 유지', () => {
    expect(RESV_PAGE, '예약카드 testid 누락').toContain('data-testid={`resv-card-${r.id}`}');
    expect(RESV_PAGE, '카드 draggable(confirmed) 누락').toContain("draggable={r.status === 'confirmed'}");
    expect(RESV_PAGE, '카드 우클릭 컨텍스트메뉴 핸들러 누락').toContain('setResvContextMenu(');
    expect(RESV_PAGE, '카드 더블클릭 예약수정(openEdit) 누락').toContain('openEdit(r)');
  });

  test('AC3-2: 슬롯 내 유형순 정렬(KIND_ORDER) 유지', () => {
    expect(RESV_PAGE, '슬롯 정렬 누락').toContain('KIND_ORDER[resvKind(a)] - KIND_ORDER[resvKind(b)]');
  });

  test('AC3-3: 주간 네비 + 주간/일 뷰 토글 소스 유지', () => {
    expect(RESV_PAGE, 'weekStart 상태 누락').toContain('setWeekStart');
    expect(RESV_PAGE, "viewMode week 분기 누락").toContain("viewMode === 'week'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// smoke — 예약관리 페이지 로드 회귀
// ═══════════════════════════════════════════════════════════════════════════
test('smoke: 예약관리 페이지 정상 로드(회귀 없음)', async ({ page }) => {
  const response = await page.goto(`${BASE_URL}/admin/reservations`);
  expect(response?.status()).toBeLessThan(400);
  const html = await page.content();
  expect(html.length).toBeGreaterThan(100);
});
