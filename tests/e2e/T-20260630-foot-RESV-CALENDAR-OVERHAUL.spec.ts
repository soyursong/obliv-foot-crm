/**
 * T-20260630-foot-RESV-CALENDAR-OVERHAUL — 예약관리 화면 대규모 UI 개선 10건
 *
 * ▣ 본 spec 커버리지 (Stage A+C 1차 배포분 — 표시/디스플레이 항목, 탭 제스처 의미 무변경):
 *   [항목1] 헤더 세로폭 ~50% 축소 + 본문 상단정렬
 *   [항목4] 시간 레이블 중앙정렬 + 폰트 1.5배 (일간·주간 = 항목10)
 *   [항목5] 고객박스 간략메모(brief_note)를 예약 정보 '최상단'에 표기 + 박스 기본 크기 소폭 확대 (일간·주간 = 항목10)
 *   [항목6] 취소 예약 UI — '취소됨' 라벨 제거 / 성함 취소선 제거 / 회색 배경 + 음각(inset shadow) /
 *           등록고객 취소건도 hover 간략정보 팝오버 정상노출(AC6-5R) (일간·주간 = 항목10)
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
  test('S1-1: 페이지 패딩 p-6 → 상단 컴팩트(pt-2 pb-3) 전환', () => {
    expect(RESV_SRC, '페이지 패딩 미축소').toContain('flex h-full flex-col px-6 pt-2 pb-3');
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
  test('S4-1: 일간 시간 레이블 = 중앙정렬 + text-[15px](10px×1.5)', () => {
    expect(RESV_SRC).toContain('flex-1 text-center text-[15px] font-semibold tabular-nums text-foreground');
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
  test('S5-3: 주간 카드 — brief_note 라인이 카드 상단(성함줄 위)로 이동', () => {
    // 상단 이동된 brief 블록이 카드 컨테이너(div className=cn(...)) 직후·성함 flex 행 이전에 위치
    const idxBrief = RESV_SRC.indexOf('[항목5]: 간략메모(brief_note)를 예약 정보 \'최상단\'에 표기(예약상태보다 위)');
    const idxName = RESV_SRC.indexOf('hover 팝업 + 우클릭 컨텍스트 메뉴\n');
    expect(idxBrief, '주간 상단 brief 블록 부재').toBeGreaterThan(0);
    expect(idxName, '주간 성함행 마커 부재').toBeGreaterThan(0);
    expect(idxBrief, 'brief 가 성함행보다 아래에 있음(상단 이동 실패)').toBeLessThan(idxName);
    // 구 위치(성함줄 아래 인라인 brief) 제거 — 동일 testid 중복 0
    expect((RESV_SRC.match(/data-testid=\{`resv-brief-\$\{r\.id\}`\}/g) ?? []).length, '주간 brief testid 중복(이중 렌더)').toBe(1);
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
  test('S6-3: 취소건 회색 배경 + 음각(inset shadow) — cn 마지막(컬러배경 덮어쓰기)', () => {
    const occ = (RESV_SRC.match(/r\.status === 'cancelled' && 'bg-gray-200 border-gray-300 text-gray-500 shadow-\[inset_0_1px_3px_rgba\(0,0,0,0\.18\)\]'/g) ?? []).length;
    expect(occ, '취소 회색+음각 스타일이 일간·주간 양쪽(2건) 적용되어야 함').toBe(2);
  });
  test('S6-4 (AC6-5R): 등록고객 취소건도 CustomerHoverCard 분기 — hover 간략정보 정상노출', () => {
    // 구 조건(취소건 hover 제외) 제거: `r.customer_id && r.status !== 'cancelled' ?` 잔존 0
    expect(RESV_SRC, '취소건 hover 제외 조건 잔존(AC6-5R 미반영)').not.toContain("r.customer_id && r.status !== 'cancelled' ?");
    // hover 분기 진입 조건이 customer_id 단독 — 일간/주간 2건
    expect((RESV_SRC.match(/\{r\.customer_id \? \(/g) ?? []).length, 'customer_id 단독 hover 분기 2건(일간·주간)').toBeGreaterThanOrEqual(2);
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
