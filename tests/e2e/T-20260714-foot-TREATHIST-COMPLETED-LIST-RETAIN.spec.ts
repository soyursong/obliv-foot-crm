/**
 * E2E Spec — T-20260714-foot-TREATHIST-COMPLETED-LIST-RETAIN (P2, planner / 김주연 총괄)
 *
 * 치료테이블 > 진료 환자 이력 탭:
 *   현재: 환자의 상태변경을 풀면(revert/unset → status_flag null) 목록 쿼리 필터
 *         (status_flag IN ('purple','pink'))에서 탈락 → 리스트에서 완전히 사라짐(추적 불가).
 *   교정(db_change=false, FE 리스트 쿼리/그룹핑 레이어):
 *     상태 풀림(status_flag null)이라도 '한번 올라왔던'(status_flag_history 에 purple|pink 이력) 환자는
 *     소멸하지 않고 하단 [진료완료] 섹션으로 이동해 보존. 상태해제 건은 '상태해제' 배지로 구분.
 *
 * Discovery 확정(§확인필요):
 *   1. 상태전이 특정: '풀림' = 상태 플래그 메뉴에서 활성 flag(purple/pink) 재클릭 → onFlagChange(ci, null)
 *      (StatusContextMenu L116) → applyStatusFlagTransition(null). status_flag=null 로 초기화.
 *   2. '한번 올라왔던' 정의 = (a) 오늘 진료콜 흐름 진입 전체 = status_flag_history 에 purple|pink 엔트리 有.
 *   3. [진료완료] 섹션 = 활성 리스트에서 내려온 보존 섹션. pink(진료완료) + released(상태해제) 모두 담되,
 *      released 는 '상태해제' 배지로 라벨 정합 확보.
 *   4. 리셋 주기 = 당일(쿼리 checked_in_at [00:00,23:59:59] KST 바운드 → 익일 자연 초기화).
 *
 * AC:
 *   AC-1: 상태를 풀어도(null) 해당 환자가 리스트에서 완전히 사라지지 않는다(하단 done 편입).
 *   AC-2: 한번 올라왔던(history purple|pink) 환자는 명단 하단 [진료완료] 섹션에 표시된다.
 *   AC-3: 상태를 다시 활성(purple)화하면 활성 명단으로 복귀하고 [진료완료]에서 제거된다.
 *   AC-4: DB 스키마/RPC 변경 없이 FE 리스트 필터·그룹핑 레이어에서 해결(db_change=false).
 *   AC-5: T-20260614 HANDSTATE-COLORCYCLE '되돌리기'와 상태전이 중복 시 코드경로 충돌 없음
 *         (본 fix 는 write 경로 불간섭, read/쿼리/그룹핑 레이어만 — 소스 가드로 단언).
 *
 * 구성:
 *   A. 순수 로직 — 컴포넌트가 소비하는 동일 함수(historyHadDoctorCall / splitByCompletion / retainReason)를
 *      직접 import(drift 방지). AC-1/2/3 그룹핑 판정 확정.
 *   B. 정적 소스 가드 — q1(진료콜 명단) 불변 + q2(status_flag IS NULL) 보존 쿼리 추가 + write 경로 미접점(AC-4/5).
 *   C. 브라우저 재현 경로 — 시나리오 1~3 프레임 가시화.
 *
 * 실행: npx playwright test T-20260714-foot-TREATHIST-COMPLETED-LIST-RETAIN.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  splitByCompletion,
  historyHadDoctorCall,
  retainReason,
} from '../../src/components/treatment/DoctorHistorySection';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTION_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/DoctorHistorySection.tsx'), 'utf-8');

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

test.describe('§확인필요-2 — historyHadDoctorCall: 한번 올라왔던(진료콜 등재 이력) 판정', () => {
  test('history 에 purple 엔트리 有 → true (진료필요로 올라온 적 있음)', () => {
    expect(
      historyHadDoctorCall([{ flag: 'purple', changed_at: '2026-07-14T09:00:00+09:00' } as never]),
    ).toBe(true);
  });

  test('history 에 pink 엔트리 有 → true (진료완료를 거침)', () => {
    expect(
      historyHadDoctorCall([
        { flag: 'purple', changed_at: '2026-07-14T09:00:00+09:00' } as never,
        { flag: 'pink', changed_at: '2026-07-14T10:00:00+09:00' } as never,
        { flag: null, changed_at: '2026-07-14T10:30:00+09:00' } as never, // 이후 풀림
      ]),
    ).toBe(true);
  });

  test('history 에 purple/pink 없음(white/gray 만) → false (진료콜 등재 이력 없음)', () => {
    expect(
      historyHadDoctorCall([{ flag: 'white', changed_at: '2026-07-14T09:00:00+09:00' } as never]),
    ).toBe(false);
  });

  test('history null/빈 배열 → false (시나리오3 — 한번도 안 올라온 환자 제외)', () => {
    expect(historyHadDoctorCall(null)).toBe(false);
    expect(historyHadDoctorCall(undefined)).toBe(false);
    expect(historyHadDoctorCall([])).toBe(false);
  });
});

test.describe('AC-1/AC-3 — splitByCompletion: purple 만 active / pink·null(상태해제)은 done', () => {
  test('시나리오1 — 상태 풀림(null)은 소멸 X, done 으로 편입', () => {
    const rows = [
      row({ checkInId: 'active', statusFlag: 'purple' }),
      row({ checkInId: 'reverted', statusFlag: null }), // 풀린 환자
    ];
    const { active, done } = splitByCompletion(rows);
    expect(active.map((r) => r.checkInId)).toEqual(['active']);
    expect(done.map((r) => r.checkInId)).toEqual(['reverted']); // 사라지지 않음
  });

  test('pink(진료완료) + null(상태해제) 모두 done', () => {
    const rows = [
      row({ checkInId: 'done-pink', statusFlag: 'pink', completedAt: '2026-07-14T10:00:00+09:00' }),
      row({ checkInId: 'released', statusFlag: null }),
      row({ checkInId: 'live', statusFlag: 'purple' }),
    ];
    const { active, done } = splitByCompletion(rows);
    expect(active.map((r) => r.checkInId)).toEqual(['live']);
    expect(done.map((r) => r.checkInId).sort()).toEqual(['done-pink', 'released']);
  });

  test('AC-3 — 다시 활성(purple)으로 지정하면 active 복귀(done 에서 제거)', () => {
    // 재활성 = 그 행의 statusFlag 가 purple 로 돌아온 상태.
    const rows = [row({ checkInId: 'reactivated', statusFlag: 'purple' })];
    const { active, done } = splitByCompletion(rows);
    expect(active.map((r) => r.checkInId)).toEqual(['reactivated']);
    expect(done).toHaveLength(0);
  });

  test('완전소멸 X — 분리 후 total 보존(active + done = 입력)', () => {
    const rows = [
      row({ checkInId: 'a', statusFlag: 'purple' }),
      row({ checkInId: 'b', statusFlag: 'pink', completedAt: '2026-07-14T10:00:00+09:00' }),
      row({ checkInId: 'c', statusFlag: null }),
    ];
    const { active, done } = splitByCompletion(rows);
    expect(active.length + done.length).toBe(rows.length);
  });
});

test.describe('§확인필요-3 — retainReason: 라벨 정합(진료완료 vs 상태해제)', () => {
  test('pink → completed(진료완료)', () => {
    expect(retainReason('pink')).toBe('completed');
  });
  test('null(풀림) → released(상태해제)', () => {
    expect(retainReason(null)).toBe('released');
  });
  test('그 외 flag → released(활성 purple 이 아닌 이상 하단 보존/해제로 취급)', () => {
    expect(retainReason('white')).toBe('released');
  });
});

// ─── B. 정적 소스 가드 ────────────────────────────────────────────────────────

test.describe('AC-4 — q1 진료콜 명단 불변 + q2 상태해제 보존 쿼리 추가', () => {
  test("q1 은 여전히 status_flag IN ('purple','pink') fetch(회귀 0)", () => {
    const src = SECTION_SRC();
    expect(src).toContain(".in('status_flag', ['purple', 'pink'])");
    expect(src).toContain(".neq('status', 'cancelled')");
  });

  test('q2 — status_flag IS NULL 보존 쿼리 + 당일 바운드 + history 기반 클라이언트 필터', () => {
    const src = SECTION_SRC();
    expect(src).toContain(".is('status_flag', null)"); // 풀림 = null 재확보
    expect(src).toContain('historyHadDoctorCall('); // '한번 올라왔던' 클라이언트 필터
    // 당일 바운드(AC-4 리셋=당일) — q1/q2 공통
    expect(src).toContain(".gte('checked_in_at', start)");
    expect(src).toContain(".lte('checked_in_at', end)");
  });

  test('AC-4 — DB 스키마/RPC 변경 없음(마이그레이션/rpc 호출 신설 없음)', () => {
    const src = SECTION_SRC();
    // read-only 파생만 — 신규 rpc/insert/delete 없음(status_flag write 는 이 섹션 밖 SSOT 소관).
    expect(src).not.toContain('.rpc(');
    expect(src).not.toContain('.insert(');
    expect(src).not.toContain('.delete(');
  });
});

test.describe('AC-5 — HANDSTATE 되돌리기와 코드경로 충돌 없음(write 경로 불간섭)', () => {
  test('DoctorHistorySection 은 status_flag write(applyStatusFlagTransition/update status_flag) 를 하지 않는다', () => {
    const src = SECTION_SRC();
    // 상태전이 write 경로(SSOT) 미사용 — 리스트 read/쿼리/그룹핑 레이어만.
    //   (설명 주석에는 applyStatusFlagTransition 이 언급될 수 있으므로 '실제 import·호출'만 단언.)
    expect(src).not.toMatch(/import\s+\{[^}]*applyStatusFlagTransition/);
    expect(src).not.toMatch(/applyStatusFlagTransition\s*\(/); // 함수 호출 없음
    expect(src).not.toMatch(/\.update\(\s*\{[^}]*status_flag/); // check_ins.status_flag write 없음
    expect(src).not.toContain('onFlagChange'); // 칸반 flag 변경 핸들러 미사용
  });
});

test.describe('AC-2 — 하단 [진료완료] 보존 섹션 read-only + 상태해제 배지', () => {
  test('done-row 에 retain-reason 속성 + released 배지 렌더', () => {
    const src = SECTION_SRC();
    expect(src).toContain('data-retain-reason');
    expect(src).toContain('dh-done-released-badge');
    expect(src).toContain('상태해제');
  });

  test('done 섹션 read-only — 편집 셀렉트(TreatingDoctorSelect)·우클릭 액션 부재', () => {
    const src = SECTION_SRC();
    const start = src.indexOf('doctor-history-done-section');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('</>', start);
    expect(end).toBeGreaterThan(start);
    const doneBlock = src.slice(start, end);
    expect(doneBlock).not.toContain('TreatingDoctorSelect');
    expect(doneBlock).not.toContain('onContextMenu');
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

test.describe('브라우저 재현 — 진료 환자 이력: 활성목록 + [진료완료] 보존 섹션', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('탭 진입 → 섹션 프레임 가시화 + (보존건 有 시) 상태해제 배지 확인', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');

    const tabs = page.getByTestId('treatment-section-tabs');
    await expect(tabs).toBeVisible({ timeout: 10000 });

    const historyTab = page.getByTestId('tab-doctor-history');
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    const section = page.getByTestId('doctor-history-section');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 활성테이블 / 활성-empty(모두 완료·해제) / 전체 빈 상태 중 하나는 렌더.
    const activeTable = page.getByTestId('doctor-history-table');
    const activeEmpty = page.getByTestId('doctor-history-active-empty');
    const empty = page.getByTestId('doctor-history-empty');
    await expect(activeTable.or(activeEmpty).or(empty)).toBeVisible({ timeout: 10000 });

    // 하단 [진료완료] 보존 섹션 — 완료/해제 건이 있을 때만 노출.
    const doneSection = page.getByTestId('doctor-history-done-section');
    if (await doneSection.isVisible().catch(() => false)) {
      await expect(page.getByTestId('doctor-history-done-table')).toBeVisible();
      // 보존 행은 편입 사유 속성을 갖는다(completed | released).
      const firstDoneRow = page.getByTestId('doctor-history-done-row').first();
      await expect(firstDoneRow).toHaveAttribute('data-retain-reason', /completed|released/);
    }
  });
});
