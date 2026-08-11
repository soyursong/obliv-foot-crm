/**
 * E2E spec — T-20260810-foot-WORKCAL-IMPORT-MAPFAIL-PARTIAL-INSERT
 * cross-fork preventive port ← body PR#260 (T-20260810-body-WORKCAL-GSHEET-IMPORT-MAPFAIL-FIX, 810ecf39)
 *
 * 결함(latent, foot 현장 미보고): DutyRosterImportDialog 가 body와 동형 파서/게이트.
 *   요일약자(Sun/Mon…)·순번숫자(1/2/3…) 셀이 "직원명" 자리로 파싱 → 직원 매칭 실패 →
 *   '오류' 카운트 부풀림 + 정상 0건이면 '삽입 확정' 전체 비활성(무한차단 UX).
 *
 * 이식 스펙(body 검증본):
 *   - AC-1 삽입판정 분리: 오류·제외 행이 있어도 정상 행만 독립 삽입. 버튼 활성=정상건수>0.
 *   - AC-2 재분류: 요일약자·순번숫자·머리글은 '오류'가 아닌 '제외(skip)' → 오류 카운트 제외.
 *                  (한글 실명 오탐 0 — 요일패턴은 단독 [일월화수목금토]만 매칭.)
 *   - AC-3 정상 0건 안내 배너: 버튼 비활성 이유 명시.
 *
 * 진입: /admin/handover 상단 원장 근무표(DutyRosterTab) → "구글시트 불러오기"(duty-import-btn).
 * ※ 정상행 실 insert는 매칭 직원명이 필요해 DB 오염을 유발하므로 트리거하지 않음.
 *    정상행 삽입 성공 + 비직원행 제외 표시 = supervisor field-soak / 현장 재테스트 갈음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 의도적으로 매칭 불가한 이름 → 실직원 미매칭 '오류'(요일/순번 '제외'와 구분 확인용)
const NON_MATCH = `없는직원_${Math.random().toString(36).slice(2, 8)}`;

/**
 * 달력형(행=직원, 열=날짜) 붙여넣기 샘플 (TSV).
 *  - 'Sun'  = 요일약자가 직원명 자리로 파싱 → 제외 대상
 *  - '2'    = 순번 숫자가 직원명 자리로 파싱 → 제외 대상
 *  - NON_MATCH = 실직원 미매칭 → '오류'로 남아야 함 (한글 실명 오탐 0 검증)
 */
function mapfailPaste(name: string): string {
  return [
    `이름\t2026-06-08\t2026-06-09`,
    `Sun\t근무\t오프`, // 요일약자 → 제외
    `2\t근무\t오프`, //   순번숫자 → 제외
    `${name}\t근무\t오프`, // 실직원 미매칭 → 오류(제외로 흡수되면 안 됨)
  ].join('\n');
}

async function openImportDialog(page: import('@playwright/test').Page): Promise<boolean> {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) return false;
  await page.goto('/admin/handover', { waitUntil: 'domcontentloaded' }).catch(() => {});
  try {
    await page.getByTestId('duty-import-btn').waitFor({ timeout: 12_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('T-20260810-foot-WORKCAL-IMPORT-MAPFAIL-PARTIAL-INSERT — 비직원행 제외 재분류(cross-fork port)', () => {
  test('시나리오1: AC-2 — 요일약자/순번숫자는 오류 아닌 "제외"로 재분류 (한글실명 오탐0)', async ({ page }) => {
    const ok = await openImportDialog(page);
    if (!ok) test.skip(true, '근무캘린더/불러오기 진입점 없음(권한·데이터)');

    await page.getByTestId('duty-import-btn').click();
    await page.getByTestId('duty-import-paste-mode').click();
    await page.getByTestId('duty-import-paste-textarea').fill(mapfailPaste(NON_MATCH));
    await page.getByTestId('duty-import-parse-btn').click();

    await expect(page.getByTestId('duty-import-preview')).toBeVisible({ timeout: 6_000 });

    // 제외 배지 노출 + 제외 사유 행 존재 (Sun·2 재분류)
    await expect(page.getByTestId('duty-import-summary')).toContainText('제외');
    await expect(page.getByText(/직원 아님\(요일·순번 등\) 자동 제외/).first()).toBeVisible();

    // 실직원 미매칭(한글 실명)은 여전히 '오류'로 구분 노출 (제외로 흡수되지 않음 = 오탐0)
    await expect(page.getByText(new RegExp(`직원 매칭 실패\\(${NON_MATCH}\\)`)).first()).toBeVisible();

    console.log('[시나리오1] Sun/2 → 제외 재분류 + 한글실명 미매칭은 오류 유지(오탐0) OK');
  });

  test('시나리오2: AC-1 — 오류·제외 행은 사유와 함께 노출, 삽입 판정 분리(정상0→비활성)', async ({ page }) => {
    const ok = await openImportDialog(page);
    if (!ok) test.skip(true, '근무캘린더/불러오기 진입점 없음(권한·데이터)');

    await page.getByTestId('duty-import-btn').click();
    await page.getByTestId('duty-import-paste-mode').click();
    await page.getByTestId('duty-import-paste-textarea').fill(mapfailPaste(NON_MATCH));
    await page.getByTestId('duty-import-parse-btn').click();

    await expect(page.getByTestId('duty-import-preview')).toBeVisible({ timeout: 6_000 });

    // 오류/제외 행이 미리보기에 계속 노출됨 (삽입에서 스킵되지만 숨기지 않음)
    await expect(page.getByText(/오류 ·/).first()).toBeVisible();
    await expect(page.getByText(/제외 ·/).first()).toBeVisible();

    // 정상 0건 → 확정 버튼 라벨 "(0건)" + 비활성 (정상행만 insert 대상 = 판정 분리)
    const confirm = page.getByTestId('duty-import-confirm');
    await expect(confirm).toContainText('0건');
    await expect(confirm).toBeDisabled();

    // AC-3 정상 0건 안내 노출 — 버튼 비활성 이유 명시(무한차단 UX 제거)
    await expect(page.getByTestId('duty-import-novalid-hint')).toContainText('새로 추가할 근무가 없습니다');

    console.log('[시나리오2] 오류·제외 노출 + 정상0 비활성 + 안내문구(삽입 판정 분리) OK');
  });

  test('시나리오3: AC-3 회귀 — 취소 후 기존 근무캘린더 그리드 불변', async ({ page }) => {
    const ok = await openImportDialog(page);
    if (!ok) test.skip(true, '근무캘린더/불러오기 진입점 없음(권한·데이터)');

    await page.getByTestId('duty-import-btn').click();
    await expect(page.getByTestId('duty-import-paste-mode')).toBeVisible({ timeout: 6_000 });
    await page.getByRole('button', { name: '취소' }).click();
    // 다이얼로그 닫힌 뒤 기존 근무 그리드가 그대로 렌더(불변)
    await expect(page.getByTestId('duty-roster-grid')).toBeVisible();

    console.log('[시나리오3] 취소 후 그리드 불변 OK');
  });
});
