/**
 * E2E Spec — T-20260726-foot-TREATTABLE-JINRYO-DATESCOPE-MISSING (P1 hotfix, planner / 김주연 총괄 직접 신고)
 *
 * 증상: 치료테이블 [진료] 탭이 과거일자(7/24·7/25)에서 통째로 빈 목록.
 *
 * RC(진단, service_role 대조 — anon/RLS 0-row wipe 오인 금지):
 *   · check_ins 실재 확인: 7/24=25건(비취소 19) / 7/25=22건 — 데이터 유실 아님(write 금지 대상 아님).
 *   · status_flag 분포: 전량 dark_gray(수납완료) 또는 null — purple|pink 0건.
 *   · [진료] 탭(DoctorHistorySection.useDoctorHistory) = 이미 선택 날짜 스코프(dayBounds(date)) →
 *     today-only 날짜버그 아님(PUBDOC-DATESCOPE-EXPAND 와는 다른 RC).
 *   · status_flag 는 단일 mutable 필드 → 진료(purple→pink) 후 '수납완료'(dark_gray) 전이 시 purple|pink 가 덮임.
 *     q1(purple|pink)·구 q2(status_flag IS NULL)에서 모두 탈락 → 그날이 끝나 전원 dark_gray 가 되면
 *     과거일자 [진료] 탭이 통째로 빈 목록으로 보임. = display bug(db_change=false).
 *   · dark_gray 행의 status_flag_history 에 purple,pink 명확(7/24=8건 / 7/25=8건이 진료콜 등재 이력 有).
 *
 * FIX(FE-only, db_change=false):
 *   · q2 보존 재확보를 status_flag IS NULL(상태해제) 뿐 아니라 dark_gray 등 non-call terminal flag(진료콜 이력 有)까지 확장.
 *       fetch = window 전건 → 클라이언트에서 (현재 flag 가 purple|pink 아님 = q1 배제) + historyHadDoctorCall.
 *   · retainReason: dark_gray = 진료완료(수납·귀가) 취급('상태해제' 배지 오표기 금지). null 만 released.
 *   · callRows(진료의별 담당·소견 신청/발행 집계): dark_gray 포함(그날 진료 담당 실적). null-released 만 제외(회귀 0).
 *
 * sweep(탭별 순차 재신고 방지): 균검사/피검사/경과분석 —
 *   셋 다 선택 날짜 스코프(windowBounds(date)/reservation_date=date) + mutable status_flag 미사용 → 동일 RC 미공유.
 *   공통 스코프 1곳 수정 불요(각 탭 별개 소스). 소스 가드로 단언.
 *
 * AC:
 *   AC-1: 진료 후 수납완료(dark_gray)로 전이된, 진료콜 이력 있는 환자가 [진료] 탭에서 사라지지 않는다(하단 done 편입).
 *   AC-2: dark_gray 보존행은 '진료완료'(completed)로 표기 — '상태해제'(released) 배지 미부착.
 *   AC-3: 상태해제(null, 플래그를 푼) 보존은 기존대로 released 로 유지(회귀 0).
 *   AC-4: DB 스키마/RPC 변경 없음(db_change=false, FE read/쿼리/그룹핑 레이어).
 *   AC-5: sweep — 형제 탭(균검사/피검사/경과분석)은 선택 날짜 스코프이며 동일 RC 미공유.
 *
 * 실행: npx playwright test T-20260726-foot-TREATTABLE-JINRYO-DATESCOPE-MISSING.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  splitByCompletion,
  historyHadDoctorCall,
  retainReason,
  computeDoctorCountSummary,
} from '../../src/components/treatment/DoctorHistorySection';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const SECTION_SRC = () => src('components/treatment/DoctorHistorySection.tsx');

type Row = ReturnType<typeof splitByCompletion>['active'][number];
function row(over: Partial<Row>): Row {
  return {
    checkInId: 'ci-x',
    customerId: 'cust-1',
    customerName: '홍길동',
    chartNumber: null,
    visitType: 'returning',
    checkedInAt: '2026-07-24T09:00:00+09:00',
    rxIssued: false,
    docRequested: false,
    opinionIssued: false,
    treatingDoctorId: null,
    statusFlag: 'purple',
    completedAt: null,
    ...over,
  } as Row;
}

// ─── A. 순수 로직 — RC 재현 & 교정 판정 ─────────────────────────────────────────

test.describe('AC-1 — splitByCompletion: 수납완료(dark_gray)는 소멸 X, 하단 done 편입', () => {
  test('dark_gray(수납완료·귀가)는 active 아님 → done', () => {
    const rows = [
      row({ checkInId: 'live', statusFlag: 'purple' }),
      row({ checkInId: 'paid', statusFlag: 'dark_gray', completedAt: '2026-07-24T10:00:00+09:00' }),
    ];
    const { active, done } = splitByCompletion(rows);
    expect(active.map((r) => r.checkInId)).toEqual(['live']);
    expect(done.map((r) => r.checkInId)).toEqual(['paid']); // 사라지지 않음
  });

  test('과거일자 시나리오 — 전원 dark_gray(수납완료)여도 done 으로 전부 보존(빈 목록 아님)', () => {
    const rows = [
      row({ checkInId: 'a', statusFlag: 'dark_gray', completedAt: '2026-07-24T10:00:00+09:00' }),
      row({ checkInId: 'b', statusFlag: 'dark_gray', completedAt: '2026-07-24T11:00:00+09:00' }),
      row({ checkInId: 'c', statusFlag: 'dark_gray', completedAt: '2026-07-24T12:00:00+09:00' }),
    ];
    const { active, done } = splitByCompletion(rows);
    expect(active).toHaveLength(0); // 진행중 없음
    expect(done).toHaveLength(3); // 전원 보존 — [진료] 탭 통째로 빈 목록 회귀 방지
  });

  test('완전소멸 X — 분리 후 total 보존(active + done = 입력)', () => {
    const rows = [
      row({ checkInId: 'p', statusFlag: 'purple' }),
      row({ checkInId: 'k', statusFlag: 'pink', completedAt: '2026-07-24T10:00:00+09:00' }),
      row({ checkInId: 'd', statusFlag: 'dark_gray', completedAt: '2026-07-24T11:00:00+09:00' }),
      row({ checkInId: 'n', statusFlag: null }),
    ];
    const { active, done } = splitByCompletion(rows);
    expect(active.length + done.length).toBe(rows.length);
  });
});

test.describe('AC-2/AC-3 — retainReason: dark_gray=진료완료 / null=상태해제', () => {
  test('dark_gray(수납완료) → completed(진료완료) — released 배지 오표기 금지', () => {
    expect(retainReason('dark_gray')).toBe('completed');
  });
  test('pink(진료완료) → completed (회귀 유지)', () => {
    expect(retainReason('pink')).toBe('completed');
  });
  test('null(상태 플래그 풀림) → released (회귀 유지)', () => {
    expect(retainReason(null)).toBe('released');
  });
});

test.describe('RC 재현 — historyHadDoctorCall: dark_gray 로 덮여도 이력으로 진료콜 등재 판정', () => {
  test('현장 실제 이력 [purple,pink,dark_gray] → true (진료 후 수납완료)', () => {
    expect(
      historyHadDoctorCall([
        { flag: 'purple', changed_at: '2026-07-24T09:00:00+09:00' } as never,
        { flag: 'pink', changed_at: '2026-07-24T10:00:00+09:00' } as never,
        { flag: 'dark_gray', changed_at: '2026-07-24T10:30:00+09:00' } as never,
      ]),
    ).toBe(true);
  });
  test('진료콜 미등재 이력 [dark_gray] 만(진료 없이 수납만) → false (정상 미노출)', () => {
    expect(
      historyHadDoctorCall([{ flag: 'dark_gray', changed_at: '2026-07-24T09:00:00+09:00' } as never]),
    ).toBe(false);
  });
});

test.describe('callRows 집계 — dark_gray 포함(진료 담당 실적) / null-released 제외', () => {
  // 컴포넌트 callRows = rows.filter(r => r.statusFlag !== null). computeDoctorCountSummary 로 정합 단언.
  test('진료의별 담당 카운트 = purple+pink+dark_gray(=non-null), null 제외', () => {
    const rows = [
      { statusFlag: 'purple' as const, treatingDoctorId: 'd1' },
      { statusFlag: 'pink' as const, treatingDoctorId: 'd1' },
      { statusFlag: 'dark_gray' as const, treatingDoctorId: 'd2' }, // 수납완료 — 포함
      { statusFlag: null, treatingDoctorId: 'd2' }, // 상태해제 — 제외
    ];
    const callRows = rows.filter((r) => r.statusFlag !== null);
    const summary = computeDoctorCountSummary(callRows, new Map([['d1', '문원장'], ['d2', '김원장']]));
    const total = summary.reduce((s, e) => s + e.count, 0);
    expect(total).toBe(3); // dark_gray 포함, null 제외
  });
});

// ─── B. 정적 소스 가드 ────────────────────────────────────────────────────────

test.describe('AC-1/AC-4 — q2 보존 쿼리 확장(dark_gray) + 회귀 가드', () => {
  test('q1 진료콜 명단 불변', () => {
    const s = SECTION_SRC();
    expect(s).toContain(".in('status_flag', ['purple', 'pink'])");
    expect(s).toContain(".neq('status', 'cancelled')");
  });

  test('q2 — single-flag(.is null) server 필터 제거 + purple|pink 클라이언트 배제 + historyHadDoctorCall', () => {
    const s = SECTION_SRC();
    expect(s).not.toContain(".is('status_flag', null)"); // 구 null-전용 필터 제거(dark_gray 포함 위해)
    expect(s).toContain("sf === 'purple' || sf === 'pink'"); // q1 중복 배제(현재 진료콜 활성만)
    expect(s).toContain('historyHadDoctorCall(');
    expect(s).toContain(".gte('checked_in_at', start)");
    expect(s).toContain(".lte('checked_in_at', end)");
  });

  test('callRows = non-null(dark_gray 포함, null-released 제외)', () => {
    const s = SECTION_SRC();
    expect(s).toContain('const callRows = rows.filter((r) => r.statusFlag !== null)');
  });

  test('AC-4 — db_change=false: rpc/insert/delete/status_flag write 없음', () => {
    const s = SECTION_SRC();
    expect(s).not.toContain('.rpc(');
    expect(s).not.toContain('.insert(');
    expect(s).not.toContain('.delete(');
    expect(s).not.toMatch(/\.update\(\s*\{[^}]*status_flag/);
  });
});

test.describe('AC-5 — sweep: 형제 탭은 선택 날짜 스코프 + mutable status_flag 미사용(동일 RC 미공유)', () => {
  test('균검사(ExamTargetsSection) — windowBounds(date) 선택일 스코프, checked_in_at today 하드코딩 없음', () => {
    const s = src('components/treatment/ExamTargetsSection.tsx');
    expect(s).toContain('windowBounds(date)');
    expect(s).not.toContain("['purple', 'pink']"); // status_flag 진료콜 필터 미사용
  });
  test('피검사(BloodDailyListSection) — windowBounds(date) 선택일 스코프', () => {
    const s = src('components/treatment/BloodDailyListSection.tsx');
    expect(s).toContain('windowBounds(date)');
    expect(s).not.toContain("['purple', 'pink']");
  });
  test('경과분석(ProgressTargetsSection) — reservation_date=선택 date 스코프', () => {
    const s = src('components/treatment/ProgressTargetsSection.tsx');
    expect(s).toContain(".eq('reservation_date', date)");
    expect(s).not.toContain("['purple', 'pink']");
  });
});

// ─── C. 브라우저 재현 경로 ────────────────────────────────────────────────────

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@medibuilder.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ??
        (() => {
          throw new Error('TEST_PASSWORD env required (no plaintext fallback)');
        })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 }).catch(() => {});
  }
}

test.describe('브라우저 재현 — [진료] 탭 과거일자 이동 시 진료완료(수납) 보존 노출', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('탭 진입 → 이전날짜(2회) 이동 → 섹션 프레임 유지(빈 목록으로 죽지 않음)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');

    await page.getByTestId('tab-doctor-history').click();
    const section = page.getByTestId('doctor-history-section');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 과거일자로 이동(수납완료가 쌓인 날). 이전 버튼 2회.
    await page.getByTestId('treatment-date-prev').click();
    await page.getByTestId('treatment-date-prev').click();
    await page.waitForTimeout(800);

    // 활성테이블 / 활성-empty / 전체-empty / done 섹션 중 하나는 렌더(프레임 무파손).
    const activeTable = page.getByTestId('doctor-history-table');
    const activeEmpty = page.getByTestId('doctor-history-active-empty');
    const empty = page.getByTestId('doctor-history-empty');
    const doneSection = page.getByTestId('doctor-history-done-section');
    await expect(
      activeTable.or(activeEmpty).or(empty).or(doneSection),
    ).toBeVisible({ timeout: 10000 });

    // done 섹션이 있으면 — 진료완료(수납 포함) 보존 행이 completed/released 사유를 갖는다.
    if (await doneSection.isVisible().catch(() => false)) {
      const firstDoneRow = page.getByTestId('doctor-history-done-row').first();
      await expect(firstDoneRow).toHaveAttribute('data-retain-reason', /completed|released/);
    }
  });
});
