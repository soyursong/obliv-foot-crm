import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-RESVCAL-DISPLAY-REWORK — 예약관리 캘린더 개편 7건
 * 원천: 김주연 총괄(C0ATE5P6JTH). MQ: MSG-20260611-172945 (OVERHAUL은 superseded → 본 정본 기준).
 *
 * 본 커밋 구현 범위 = item1 / item2 / item3 / item6 (FE-only, 비파괴·게이트 무관):
 *   item1 날짜 헤더 요약  — `총 N(초진+재진)` + 초/재 카운트, 힐러(HL)는 합산 제외·별도 표기.
 *   item2 시간대별 카운트 — 슬롯 셀 상단 `초 N / 재 N / HL N`.
 *   item3 카드 유형색      — 초진=초록 / 재진=파랑 / 힐러(HL)=노랑 (이전 초진=파랑/재진=초록 반전).
 *   item6 슬롯 내 정렬     — 초진 → 재진 → 힐러 순 (stable sort).
 *
 * 보류(이번 커밋 제외, planner FOLLOWUP):
 *   item4 카드내용+상태배지(정상/취소/노쇼/방문완료) — 2026-06-11T18:18 현장 되물음 Q1~Q3
 *         (경과분석 대상자 연동 vs 예약등록(+) 버튼) 미해소 → 본 티켓 OPEN, dev 착수 보류.
 *   item5 힐러 차감 연동   — investigate-first. 차감 단일경로 autoDeductSession→deduct_session_atomic
 *         (DEDUCT-DUPKEY / PKGDEDUCT 동일 테이블) 조사 보고 후 설계 확정. 코드 변경 보류.
 *   item7 '내 예약' 드롭   — reservations.created_by 미적재(insert 경로 누락) + registrar는 마스터명
 *         (로그인 신원≠) → '본인 등록' 신뢰 필드 부재. 데이터소스 확정 후 구현.
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating. 실 렌더는 supervisor field-soak.
 * DB 무관(FE-only).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ═══════════════════════════════════════════════════════════════════════════
// item3 — 카드 유형색 반전(초진=초록/재진=파랑/힐러=노랑) + 분류 헬퍼
// ═══════════════════════════════════════════════════════════════════════════
test.describe('item3: 카드 유형별 배경색', () => {
  test('AC3-1: resvKind() 분류 헬퍼 — 힐러(healer_flag) 우선', () => {
    expect(RESV_PAGE, 'resvKind 헬퍼 미정의').toContain('function resvKind(r: Reservation): ResvKind');
    const m = RESV_PAGE.match(/function resvKind\(r: Reservation\): ResvKind \{([\s\S]*?)\n\}/);
    expect(m, 'resvKind 본문 파싱 실패').toBeTruthy();
    const body = m![1];
    expect(body, '힐러 우선 분기 누락').toContain("if (r.healer_flag) return 'healer'");
    expect(body, '초진 분기 누락').toContain("r.visit_type === 'new'");
    expect(body, '재진 분기 누락').toContain("r.visit_type === 'returning'");
  });

  test('AC3-2: KIND_CARD_STYLE — 초진=emerald/재진=blue/힐러=yellow', () => {
    const m = RESV_PAGE.match(/const KIND_CARD_STYLE: Record<ResvKind, string> = \{([\s\S]*?)\};/);
    expect(m, 'KIND_CARD_STYLE 미정의').toBeTruthy();
    const body = m![1];
    expect(body, '초진=초록(emerald) 아님').toMatch(/new:\s*'[^']*emerald/);
    expect(body, '재진=파랑(blue) 아님').toMatch(/returning:\s*'[^']*blue/);
    expect(body, '힐러=노랑(yellow) 아님').toMatch(/healer:\s*'[^']*yellow/);
  });

  test('AC3-3: 카드 className이 유형별 색을 KIND_CARD_STYLE(resvKind(r))로 적용', () => {
    expect(RESV_PAGE, '카드 색 적용이 KIND_CARD_STYLE(resvKind) 경유 아님')
      .toContain('KIND_CARD_STYLE[resvKind(r)]');
    expect(RESV_PAGE, '구(舊) VISIT_TYPE_STYLE 잔존(반전 누락)').not.toContain('VISIT_TYPE_STYLE');
  });

  test('AC3-4: 유형 점 색상도 KIND_DOT(resvKind(r))로 일치', () => {
    expect(RESV_PAGE, '점 색이 KIND_DOT 경유 아님').toContain('KIND_DOT[resvKind(r)]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// item1 — 날짜 헤더 요약 (총=초진+재진, HL 합산 제외)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('item1: 날짜 헤더 총건수 요약', () => {
  test('AC1-1: dayKindCounts 집계 — 취소 제외 + 유형 분리', () => {
    const m = RESV_PAGE.match(/const dayKindCounts = useMemo\(\(\) => \{([\s\S]*?)\}, \[rows\]\);/);
    expect(m, 'dayKindCounts useMemo 미정의 또는 deps≠[rows]').toBeTruthy();
    const body = m![1];
    expect(body, '취소 예약 제외 누락').toContain("if (row.status === 'cancelled') continue");
    expect(body, '유형 분류 누락').toContain('resvKind(row)');
  });

  test('AC1-2: 헤더 요약 = 총(초진+재진), HL 별도(합산 제외)', () => {
    expect(RESV_PAGE, '날짜 요약 testid 누락').toContain('day-summary-');
    // 총건수 = c.n + c.r (힐러 c.h 미포함)
    expect(RESV_PAGE, '총건수가 초진+재진 합이 아님').toContain('총 {c.n + c.r}');
    expect(RESV_PAGE, 'HL 별도표기(c.h) 누락').toContain('HL {c.h}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// item2 — 시간대(슬롯)별 유형 카운트
// ═══════════════════════════════════════════════════════════════════════════
test.describe('item2: 슬롯별 유형 카운트', () => {
  test('AC2-1: 슬롯 카운트 testid + 초/재/HL 표기', () => {
    expect(RESV_PAGE, '슬롯 카운트 testid 누락').toContain('slot-kind-count-');
    expect(RESV_PAGE, '슬롯 카운트가 취소 제외 active 기준 아님')
      .toContain("const active = list.filter((r) => r.status !== 'cancelled')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// item6 — 슬롯 내 정렬 초진 → 재진 → 힐러
// ═══════════════════════════════════════════════════════════════════════════
test.describe('item6: 슬롯 내 유형순 정렬', () => {
  test('AC6-1: KIND_ORDER = 초진(0)→재진(1)→힐러(2)→기타(3)', () => {
    const m = RESV_PAGE.match(/const KIND_ORDER: Record<ResvKind, number> = \{([\s\S]*?)\};/);
    expect(m, 'KIND_ORDER 미정의').toBeTruthy();
    const body = m![1];
    expect(body, '정렬 순서 초진<재진<힐러 아님').toMatch(/new:\s*0[\s\S]*returning:\s*1[\s\S]*healer:\s*2/);
  });

  test('AC6-2: 슬롯 list가 KIND_ORDER 기준 정렬됨', () => {
    expect(RESV_PAGE, '슬롯 list 정렬(sort by KIND_ORDER) 누락')
      .toContain('KIND_ORDER[resvKind(a)] - KIND_ORDER[resvKind(b)]');
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
