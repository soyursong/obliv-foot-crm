/**
 * E2E spec — T-20260606-foot-DUTY-IMPORT-SHEET-FORMAT
 * 구글시트 근무 캘린더 파서 재작성 (주 단위 캘린더 블록)
 *
 * 부모: T-20260605-foot-GSHEET-SCHEDULE-IMPORT / T-20260606-foot-DUTY-ROSTER-ALLSTAFF
 * 진입점 = 직원 > 근무캘린더 탭 > "구글시트 불러오기"(import) > 붙여넣기 모드.
 *
 * 실측 시트 구조(planner attachments 확정): "행=직원/열=날짜" flat 매트릭스가 아니라
 *   주(week) 단위 캘린더 블록. 셀에 이름 있으면 출근 / 비면 휴무(O/X 마킹 없음).
 *
 * 시나리오(티켓 §리스크 — deploy-ready 필수 케이스):
 *  1) 주 블록 인식 + 출근자 수집(AC): 요일헤더+날짜행 아래 칼럼별 이름 = 출근자.
 *  2) 월 롤오버: 날짜행 29,30,1,2…에서 일자 감소 시 다음 달로 이월(6/30 → 7/1).
 *  3) 특수토큰: 휴진=skip(미리보기 제외) / 전직원=확장(시트 토큰 자체는 명단 비노출)
 *               / 총괄=김주연 치환(직원 셀에 토큰 원문 비노출).
 *
 * ※ AC-2 가드(삽입은 사람 게이트) 준수 — 본 spec은 DB 오염 방지로 "삽입 확정" 미트리거.
 *   파서 정확성은 미리보기(preview) 렌더 결과로 검증한다.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 주 단위 캘린더 블록 1개. 6월 헤더 + 날짜행 29,30,1,2,3,4,5(6월말→7월초 롤오버).
//  - 6/29 홍길동 출근 / 7/1 총괄(→김주연) / 7/5 휴진(skip) / 6/30 전직원(확장)
const SAMPLE_CALENDAR = [
  ',2026,6월,테스트상담팀,,,,',
  ',월,화,수,목,금,토,일',
  ',29,30,1,2,3,4,5',
  ',홍길동,,총괄,,,,휴진',
  ',,전직원,,,,,',
].join('\n');

test.describe('T-20260606-foot-DUTY-IMPORT-SHEET-FORMAT — 주 단위 캘린더 파서', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');

    await page.goto('/admin/staff');
    try {
      await page.getByText('근무 원장님').waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '근무캘린더 탭 진입 실패(권한/데이터)');
    }
  });

  async function openPasteAndParse(page: import('@playwright/test').Page) {
    const importBtn = page.getByTestId('duty-import-btn');
    if (!(await importBtn.isVisible().catch(() => false))) {
      test.skip(true, 'import 진입점 미노출(비편집 권한)');
    }
    await importBtn.click();
    await page.getByTestId('duty-import-paste-mode').click();
    await page.getByTestId('duty-import-paste-textarea').fill(SAMPLE_CALENDAR);
    await page.getByTestId('duty-import-parse-btn').click();
    // 미리보기(파서 성공) 렌더 대기
    await expect(page.getByTestId('duty-import-preview')).toBeVisible({ timeout: 8_000 });
  }

  /** 미리보기 1열(직원(시트)) 셀 텍스트 목록 */
  async function sheetNameCells(page: import('@playwright/test').Page) {
    const cells = page.getByTestId('duty-import-preview').locator('tbody tr td:first-child');
    return cells.allInnerTexts();
  }

  test('시나리오1: 주 블록 인식 + 칼럼별 출근자 수집', async ({ page }) => {
    await openPasteAndParse(page);
    // 요약 배지 노출 (정상/중복/오류 합계 ≥ 1)
    await expect(page.getByTestId('duty-import-summary')).toBeVisible();
    const names = await sheetNameCells(page);
    // 날짜행 아래 칼럼의 이름이 출근자로 수집됨
    expect(names).toContain('홍길동');
    console.log(`[시나리오1] 주 블록 출근자 ${names.length}건 수집 OK`);
  });

  test('시나리오2: 월 롤오버 — 6/30 → 7/1 다음 달 이월', async ({ page }) => {
    await openPasteAndParse(page);
    const preview = page.getByTestId('duty-import-preview');
    // 날짜행 29,30,1,2,3,4,5 → 6/29 + 7/1 둘 다 미리보기에 노출(이월 성공)
    await expect(preview.getByText('2026-06-29', { exact: false }).first()).toBeVisible();
    await expect(preview.getByText('2026-07-01', { exact: false }).first()).toBeVisible();
    console.log('[시나리오2] 월 롤오버(6/29 + 7/1) 렌더 OK');
  });

  test('시나리오3: 특수토큰 — 휴진 skip · 총괄→김주연 · 전직원 토큰 비노출', async ({ page }) => {
    await openPasteAndParse(page);
    const names = await sheetNameCells(page);
    const trimmed = names.map((n) => n.trim());

    // 휴진: 출근자 아님 → 미리보기 어디에도 등장 X (rawMark 포함 전무)
    await expect(page.getByTestId('duty-import-preview').getByText('휴진')).toHaveCount(0);
    // 총괄: 직원(시트) 열에 토큰 원문이 아니라 치환명 '김주연'으로 노출
    expect(trimmed).toContain('김주연');
    expect(trimmed).not.toContain('총괄');
    // 전직원: 토큰 자체는 직원명 셀에 노출되지 않음(확장 또는 staff無 시 0건)
    expect(trimmed).not.toContain('전직원');
    console.log('[시나리오3] 휴진 skip / 총괄→김주연 / 전직원 토큰 비노출 OK');
  });
});
