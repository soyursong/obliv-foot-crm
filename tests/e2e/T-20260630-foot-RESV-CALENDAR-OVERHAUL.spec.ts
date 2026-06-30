/**
 * T-20260630-foot-RESV-CALENDAR-OVERHAUL — 예약관리 화면 대규모 UI 개선 10건
 *
 * ▣ 본 spec 커버리지 (Stage A+C 1차 배포분 — 표시/디스플레이 항목, 탭 제스처 의미 무변경):
 *   [항목1] 헤더 세로폭 ~50% 축소 + 본문 상단정렬
 *   [항목4] 시간 레이블 중앙정렬 + 폰트 1.5배 (일간·주간 = 항목10)
 *   [항목5] 고객박스 간략메모(brief_note) 단일 표기 + 박스 기본 크기 소폭 확대 (일간·주간 = 항목10)
 *   [항목6] 취소 예약 UI — '취소됨' 라벨 제거 / 성함 취소선 제거 / 회색 배경 + 음각(shadow-inner) (일간·주간 = 항목10)
 *
 * ▣ REBASE 정합 (2026-07-06, origin/main 296커밋 재베이스 — FIX-REQUEST T-20260630-foot-RESV-CALENDAR-OVERHAUL):
 *   06-30 이후 main이 예약관리를 대규모 재아키텍처(격자 축전치·4행분할·주뷰 일뷰통일·dnd-kit)하며 항목1/4/5/6 코어를 독립 구현.
 *   본 재베이스는 main과 정합하여 (a) 헤더 마진 mb-1.5(항목1), (b) 주뷰 시간축 16px(항목4), (c) 카드 min-h(항목5) 만 순증분으로 적용.
 *   ▸ 항목5 '간략메모 최상단' → 이후 총괄(김주연) 확정 CUSTBOX-PADDING-MEMO-POS(07-02, 성함 하단 단일 렌더)가 supersede → spec은 '단일 렌더'로 검증.
 *   ▸ 항목6-5R '취소건 hover' → main WEEKBOX-DAYUNIFY(07-03, 취소 차트번호 배지 유지 = plain-span)와 정합 위해 별도 wave로 이연 → spec은 취소 plain-span 유지로 검증(일/주 대칭).
 *   ▸ 시간 라벨 클래스 문자열은 main 재아키텍처 실제 소스(일 text-[15px]·주 text-[16px])에 정합.
 *
 * ▣ 본 spec 미커버 (후속 wave — 별도 진행):
 *   [항목2·3] +새예약 버튼 제거 + 엑셀 격자(시간×치료사) 재구현 — planner FOLLOWUP(scenario_missing: 치료사 컬럼 데이터소스).
 *   [항목7·8·9] 1클릭 ctrl x/c/v(일간 확장) · 2클릭→2번차트 · hover 박스전체 확장 —
 *              탭/더블탭/hover 제스처 의미 변경 → 갤탭 실기기 confirm 선행(foot done-gate).
 *
 * 검증 방식: 이 레포 표준 = 소스 권위(Reservations.tsx 소스 문자열 검증, 환경 무관) + best-effort DOM 렌더.
 *  (라이브 예약 데이터 시딩 없이 결정적으로 검증 가능 — 변경이 전부 표시 레이어 className/JSX이므로.)
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const RESV_SRC = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|reservations|admin|$)/, { timeout: 10000 });
  }
}

// ── 시나리오 5(항목1·4): 헤더 축소 + 시간 폰트 ───────────────────────────────
test.describe('항목1: 헤더 세로폭 ~50% 축소 + 상단정렬', () => {
  test('S1-1: 페이지 패딩 p-6 → 상단 컴팩트(px-4 py-2, main 정합) 전환', () => {
    // rebase 정합: main(GRID-CLICKCREATE-7ADJ ①)이 p-6→px-4 py-2 로 헤더 ~50% 축소를 이미 달성 → px-4 py-2 검증.
    expect(RESV_SRC, '페이지 패딩 미축소').toContain('flex h-full flex-col px-4 py-2');
    expect(RESV_SRC, '구 p-6 헤더 컨테이너 잔존').not.toContain('<div className="flex h-full flex-col p-6">');
  });
  test('S1-2: 헤더 행 하단 마진 mb-4 → mb-1.5 축소', () => {
    expect(RESV_SRC).toContain('<div className="mb-1.5 flex items-center justify-between gap-4">');
  });
  test('S1-3: 일간/주간 전환 배너 버튼 높이 min-h-[44px] → [34px] 축소', () => {
    // 토글 두 버튼 className 직접 검증(일간·주간) — 둘 다 34px
    expect(RESV_SRC, '일간 버튼 높이 미축소').toContain("'px-3 min-h-[34px] text-xs font-medium transition flex items-center', viewMode === 'day'");
    expect(RESV_SRC, '주간 버튼 높이 미축소').toContain("'px-3 min-h-[34px] text-xs font-medium transition flex items-center', viewMode === 'week'");
    // 구 44px 토글 className 패턴 잔존 0 (주석 문구 'min-h-[44px]→[34px]'는 className이 아니므로 무관 — className 패턴으로 한정)
    expect(RESV_SRC, '구 44px 토글 버튼 className 잔존').not.toContain("'px-3 min-h-[44px] text-xs font-medium transition flex items-center'");
  });
});

test.describe('항목4: 시간 레이블 중앙정렬 + 폰트 1.5배 (일간·주간)', () => {
  test('S4-1: 일간 시간 레이블 = text-[15px](10px×1.5, main 축전치 재구현 정합)', () => {
    // rebase 정합: main RESVGRID-TIMEAXIS-EXCELCELL 축전치로 시간 라벨이 컬럼 헤더(중앙정렬 flex-col)에서 text-[15px] 렌더.
    expect(RESV_SRC).toContain('text-[15px] font-semibold tabular-nums leading-none text-foreground');
  });
  test('S4-2: 주간 시간축 레이블 = 중앙정렬 + text-[16px](11px×1.5)', () => {
    expect(RESV_SRC).toContain('text-center text-[16px] font-semibold leading-tight text-foreground');
  });
});

// ── 시나리오 2(항목5): 간략메모 최상단 + 박스 확대 ──────────────────────────
test.describe('항목5: 간략메모 박스 최상단 표기 + 박스 크기 소폭 확대 (일간·주간)', () => {
  test('S5-1: 일간 카드 — brief_note 상단 라인(data-testid resv-day-brief-*) 존재', () => {
    expect(RESV_SRC).toContain('data-testid={`resv-day-brief-${r.id}`}');
  });
  test('S5-2: 일간 카드 박스 기본 크기 확대(min-h-[2.75rem])', () => {
    expect(RESV_SRC).toContain('shadow-sm transition-opacity min-h-[2.75rem]');
  });
  test('S5-3: 주간 카드 — brief_note 단일 렌더(중복 0) · 총괄 07-02 확정(성함 하단)', () => {
    // rebase 정합: 항목5 '최상단' 배치는 총괄(김주연) CUSTBOX-PADDING-MEMO-POS(07-02, 성함 하단)가 supersede →
    //   main WEEKBOX-DAYUNIFY Row2(성함줄 아래)에서 단일 렌더. 핵심 회귀 가드 = testid 중복(이중 렌더) 0.
    expect((RESV_SRC.match(/data-testid=\{`resv-brief-\$\{r\.id\}`\}/g) ?? []).length, '주간 brief testid 중복(이중 렌더 = stale-base 잔재)').toBe(1);
    // brief 단일 블록이 WEEKBOX-DAYUNIFY Row2(성함 하단)에 존재
    expect(RESV_SRC, '주간 Row2 간략메모 블록 부재').toContain('WEEKBOX-DAYUNIFY Row2: 간략메모');
    // stale-base 상단 중복 블록 마커 잔존 0
    expect(RESV_SRC, '항목5 상단 중복 blob 잔존(stale-base 미제거)').not.toContain("[항목5]: 간략메모(brief_note)를 예약 정보 '최상단'에 표기(예약상태보다 위)");
  });
  test('S5-4: 주간 카드 박스 기본 크기 확대(min-h-[2.5rem])', () => {
    expect(RESV_SRC).toContain('transition-opacity min-h-[2.5rem]');
  });
});

// ── 시나리오 3(항목6): 취소 예약 UI ─────────────────────────────────────────
test.describe('항목6: 취소 예약 — 라벨/취소선 제거 · 회색+음각 · hover 정상노출(AC6-5R)', () => {
  test('S6-1: "취소됨" 텍스트 라벨 렌더 제거(일간·주간 모두)', () => {
    expect(RESV_SRC, '"취소됨" 라벨 잔존').not.toContain('>취소됨</span>');
  });
  test('S6-2: 취소건 성함 취소선(line-through) 제거', () => {
    expect(RESV_SRC, '취소 성함 line-through 잔존').not.toContain("'text-[11px] line-through'");
    expect(RESV_SRC).not.toContain("r.status === 'cancelled' && 'line-through'");
  });
  test('S6-3: 취소건 회색 배경 + 음각(shadow-inner) — 일간·주간 2건(main 7ADJ⑥ 정합)', () => {
    // rebase 정합: main(7ADJ⑥)이 취소 시각처리를 shadow-inner 로 통일(일·주). stale-base 중복 삽입된 shadow-[inset...] 라인은 제거됨.
    const occ = (RESV_SRC.match(/r\.status === 'cancelled' && 'border-gray-300 bg-gray-200 text-gray-500 shadow-inner'/g) ?? []).length;
    expect(occ, '취소 회색+음각(shadow-inner) 스타일이 일간·주간 양쪽(2건) 적용되어야 함').toBe(2);
    // stale-base 중복 스타일(shadow-[inset...]) 잔존 0
    expect(RESV_SRC, 'stale-base 중복 취소 스타일 잔존').not.toContain('shadow-[inset_0_1px_3px_rgba(0,0,0,0.18)]');
  });
  test('S6-4 (AC6-5R 이연): 취소건 plain-span 유지 — 일/주 대칭(main WEEKBOX-DAYUNIFY 07-03 정합)', () => {
    // rebase 정합: AC6-5R(취소건 hover)은 main WEEKBOX-DAYUNIFY(07-03, 취소 차트번호 배지 유지=plain-span)와 충돌 →
    //   별도 wave로 이연. 취소건은 일·주 모두 plain-span 유지(`r.status !== 'cancelled'` 조건) = 일/주 대칭·중복노출 0.
    expect((RESV_SRC.match(/r\.customer_id && r\.status !== 'cancelled' \?/g) ?? []).length, '취소 plain-span 분기 2건(일간·주간 대칭)').toBe(2);
    // stale-base 로 취소건 hover 진입(customer_id 단독) 조건 잔존 0
    expect(RESV_SRC, 'stale-base 취소 hover 조건 잔존(6-5R 미이연)').not.toContain('{r.customer_id ? (');
  });
});

// ── best-effort DOM: 예약관리 화면이 정상 렌더되고 헤더/전환 배너 존재 ─────────
test.describe('DOM(best-effort): 예약관리 렌더 + 회귀 가드', () => {
  test('D-1: 예약관리 진입 → 일간/주간 전환 배너 + 캘린더 컨테이너 렌더', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE_URL}/admin/reservations`).catch(() => {});
    await loginIfNeeded(page).catch(() => {});
    const reachable = await page.getByRole('button', { name: '일간' }).isVisible({ timeout: 8000 }).catch(() => false);
    test.skip(!reachable, 'DOM 환경 미가용(로그인/데이터) — 소스 권위 검증으로 대체');
    await expect(page.getByRole('button', { name: '주간' })).toBeVisible();
    await expect(page.getByTestId('resv-timetable-scroll')).toBeVisible();
    // 치명 콘솔 에러(렌더 크래시) 0
    expect(errors.filter((e) => /Reservations|render|Cannot read/.test(e))).toHaveLength(0);
  });
});
