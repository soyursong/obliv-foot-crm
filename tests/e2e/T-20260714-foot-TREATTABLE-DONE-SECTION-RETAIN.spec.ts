/**
 * E2E Spec — T-20260714-foot-TREATTABLE-DONE-SECTION-RETAIN (P1, planner)
 *
 * 치료테이블 > 진료 환자 이력 탭:
 *   현재: 진료완료(status_flag 'pink') 환자가 상단 목록에 섞여 표시(완료/미완료 구분 흐림).
 *         완료 이후 플래그가 더 진행되면(수납완료 등) 목록에서 사라져 당일 완료건 열람 불가.
 *   교정: 진료완료(pink)를 상단 활성목록에서 빼서 하단 [진료완료] read-only 섹션으로 이동(완전소멸 X).
 *
 * AC-0(코드조사 확정):
 *   1. 목록 쿼리(useDoctorHistory)는 status='cancelled' 제외 + status_flag IN ('purple','pink') fetch.
 *      완료 status = status_flag 'pink'(진료완료) — SHAKEHAND-NO-COMPLETE field-soak 정합(purple→pink=완료 SSOT).
 *   2. 당일 범위 = checked_in_at [00:00,23:59:59] KST (부모 TreatmentTable 공통 날짜). 기간 누적 아님.
 *   3. 하단 섹션 정렬 = 완료시각 역순. 완료 timestamp = status_flag_history의 flag='pink' changed_at(1순위).
 *      부재 시 checked_in_at 폴백 + (접수) note. (applyStatusFlagTransition 는 completed_at 을 안 씀)
 *
 * AC:
 *   AC-1: 진료완료(pink) → 상단 활성목록 제거 + 하단 [진료완료] 섹션 표시(완전소멸 X).
 *   AC-2: 하단 섹션 read-only — 편집/상태변경 액션 없음(진료의=텍스트, O/X 표시 전용).
 *   AC-3: 상단 활성목록 기존 동작·역할필터(TREAT-TABLE-ROLE-OPEN) 회귀 0 — 쿼리 불변.
 *   AC-4: 당일 완료만 표시, 익일엔 전일 완료건 제외(쿼리 checked_in_at 당일 바운드로 자연 충족).
 *
 * 구성:
 *   A. 순수 로직 단언 — 컴포넌트가 실제 소비하는 동일 함수(splitByCompletion / derivePinkCompletionAt)를
 *      직접 import(drift 방지). AC-1/AC-3(정렬)/타임스탬프 파생 판정 로직 확정.
 *   B. 정적 소스 가드 — AC-2(하단 섹션에 편집 컨트롤 부재) + AC-3(쿼리 status_flag IN 불변) 소스 단언.
 *   C. 브라우저 재현 경로 — /admin/treatment-table → 진료 환자 이력 탭 → 활성목록/[진료완료] 섹션 프레임 가시화.
 *
 * 실행: npx playwright test T-20260714-foot-TREATTABLE-DONE-SECTION-RETAIN.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  splitByCompletion,
  derivePinkCompletionAt,
} from '../../src/components/treatment/DoctorHistorySection';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTION_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/DoctorHistorySection.tsx'), 'utf-8');

// 최소 DoctorHistoryRow 팩토리(테스트 전용). 파생 판정에 필요한 필드만 채운다.
type Row = ReturnType<typeof splitByCompletion>['active'][number];
function row(over: Partial<Row>): Row {
  return {
    checkInId: 'ci-x',
    customerId: 'cust-1',
    customerName: '홍길동',
    chartNumber: null,
    visitType: 'returning',
    checkedInAt: '2026-07-14T09:00:00+09:00',
    rxIssued: false,
    docRequested: false,
    opinionIssued: false,
    treatingDoctorId: null,
    statusFlag: 'purple',
    completedAt: null,
    ...over,
  } as Row;
}

// ─── A. 순수 로직 ─────────────────────────────────────────────────────────────

test.describe('AC-1 — splitByCompletion: 진료완료(pink)만 하단, 나머지는 상단 활성', () => {
  test('purple(진료필요) → active / pink(진료완료) → done', () => {
    const rows = [
      row({ checkInId: 'a', statusFlag: 'purple' }),
      row({ checkInId: 'b', statusFlag: 'pink', completedAt: '2026-07-14T10:00:00+09:00' }),
    ];
    const { active, done } = splitByCompletion(rows);
    expect(active.map((r) => r.checkInId)).toEqual(['a']);
    expect(done.map((r) => r.checkInId)).toEqual(['b']);
  });

  test('pink 이외 플래그(null/purple)는 모두 active — 완료로 오분류 없음', () => {
    const rows = [
      row({ checkInId: 'a', statusFlag: null }),
      row({ checkInId: 'b', statusFlag: 'purple' }),
    ];
    const { active, done } = splitByCompletion(rows);
    expect(active).toHaveLength(2);
    expect(done).toHaveLength(0);
  });

  test('완전소멸 X — 분리 후 total 보존(active + done = 입력)', () => {
    const rows = [
      row({ checkInId: 'a', statusFlag: 'purple' }),
      row({ checkInId: 'b', statusFlag: 'pink', completedAt: '2026-07-14T10:00:00+09:00' }),
      row({ checkInId: 'c', statusFlag: 'pink', completedAt: '2026-07-14T11:00:00+09:00' }),
    ];
    const { active, done } = splitByCompletion(rows);
    expect(active.length + done.length).toBe(rows.length);
  });

  test('빈 입력 → 빈 분리', () => {
    const { active, done } = splitByCompletion([]);
    expect(active).toEqual([]);
    expect(done).toEqual([]);
  });
});

test.describe('AC-0 §3 — 하단 [진료완료] 정렬 = 완료시각 역순(폴백 checked_in_at)', () => {
  test('completedAt desc 정렬', () => {
    const rows = [
      row({ checkInId: 'early', statusFlag: 'pink', completedAt: '2026-07-14T09:30:00+09:00' }),
      row({ checkInId: 'late', statusFlag: 'pink', completedAt: '2026-07-14T14:15:00+09:00' }),
      row({ checkInId: 'mid', statusFlag: 'pink', completedAt: '2026-07-14T11:00:00+09:00' }),
    ];
    const { done } = splitByCompletion(rows);
    expect(done.map((r) => r.checkInId)).toEqual(['late', 'mid', 'early']);
  });

  test('completedAt 부재 → checked_in_at 폴백 키로 정렬(누락 행도 소멸 X)', () => {
    const rows = [
      row({ checkInId: 'noTs', statusFlag: 'pink', completedAt: null, checkedInAt: '2026-07-14T08:00:00+09:00' }),
      row({ checkInId: 'hasTs', statusFlag: 'pink', completedAt: '2026-07-14T10:00:00+09:00' }),
    ];
    const { done } = splitByCompletion(rows);
    expect(done).toHaveLength(2); // 폴백 행도 포함
    // hasTs(10:00) > noTs(08:00 폴백) → hasTs 먼저
    expect(done[0].checkInId).toBe('hasTs');
  });
});

test.describe('AC-0 §3 — derivePinkCompletionAt: pink 전이 시각 파생', () => {
  test('flag=pink 엔트리 중 최신 changed_at', () => {
    const at = derivePinkCompletionAt([
      { flag: 'purple', changed_at: '2026-07-14T09:00:00+09:00' },
      { flag: 'pink', changed_at: '2026-07-14T10:00:00+09:00' },
      { flag: 'pink', changed_at: '2026-07-14T10:30:00+09:00' }, // 재완료/재전이 최신
    ]);
    expect(at).toBe('2026-07-14T10:30:00+09:00');
  });

  test('pink 엔트리 없음 → null(폴백 트리거)', () => {
    expect(derivePinkCompletionAt([{ flag: 'purple', changed_at: '2026-07-14T09:00:00+09:00' }])).toBeNull();
  });

  test('history null/빈 배열 → null', () => {
    expect(derivePinkCompletionAt(null)).toBeNull();
    expect(derivePinkCompletionAt(undefined)).toBeNull();
    expect(derivePinkCompletionAt([])).toBeNull();
  });
});

// ─── B. 정적 소스 가드 ────────────────────────────────────────────────────────

test.describe('AC-3 — 목록 쿼리 불변(회귀 0)', () => {
  test("useDoctorHistory 쿼리는 여전히 status_flag IN ('purple','pink') fetch(범위 확장/축소 없음)", () => {
    const src = SECTION_SRC();
    expect(src).toContain(".in('status_flag', ['purple', 'pink'])");
    expect(src).toContain(".neq('status', 'cancelled')");
    // 당일 바운드(AC-4) — checked_in_at day bounds 유지
    expect(src).toContain(".gte('checked_in_at', start)");
    expect(src).toContain(".lte('checked_in_at', end)");
  });
});

test.describe('AC-2 — 하단 [진료완료] 섹션 read-only(편집/상태변경 컨트롤 부재)', () => {
  test('done-section 렌더 블록에 TreatingDoctorSelect(쓰기 셀렉트)·컨텍스트메뉴가 없다', () => {
    const src = SECTION_SRC();
    const start = src.indexOf('doctor-history-done-section');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('</>', start);
    expect(end).toBeGreaterThan(start);
    const doneBlock = src.slice(start, end);
    // 편집 셀렉트(진료의 저장)·우클릭 CRM 액션 메뉴 부재
    expect(doneBlock).not.toContain('TreatingDoctorSelect');
    expect(doneBlock).not.toContain('onContextMenu');
    // 진료의는 텍스트 셀로만 표기
    expect(doneBlock).toContain('dh-done-doctor');
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

test.describe('브라우저 재현 — 진료 환자 이력 탭 활성목록 + [진료완료] 섹션', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('탭 진입 → 섹션 프레임 가시화(당일 데이터 유무 무관)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');

    const tabs = page.getByTestId('treatment-section-tabs');
    await expect(tabs).toBeVisible({ timeout: 10000 });

    const historyTab = page.getByTestId('tab-doctor-history');
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    const section = page.getByTestId('doctor-history-section');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 명단 有 → 활성테이블 or 활성-empty note(모두 완료 시) / 명단 無 → 빈 상태. 셋 중 하나는 렌더.
    const activeTable = page.getByTestId('doctor-history-table');
    const activeEmpty = page.getByTestId('doctor-history-active-empty');
    const empty = page.getByTestId('doctor-history-empty');
    await expect(activeTable.or(activeEmpty).or(empty)).toBeVisible({ timeout: 10000 });

    // [진료완료] 섹션은 완료건이 있을 때만 노출 — 있으면 read-only 테이블 프레임 확인.
    const doneSection = page.getByTestId('doctor-history-done-section');
    if (await doneSection.isVisible().catch(() => false)) {
      await expect(page.getByTestId('doctor-history-done-table')).toBeVisible();
      // read-only: 완료 행에는 편집용 진료의 셀렉트가 없고 텍스트 셀만 존재
      await expect(page.getByTestId('dh-done-doctor').first()).toBeVisible();
    }
  });
});
