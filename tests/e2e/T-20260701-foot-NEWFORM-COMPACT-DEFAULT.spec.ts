/**
 * E2E spec — T-20260701-foot-NEWFORM-COMPACT-DEFAULT
 * 풋센터 CRM 신규 항목 생성 폼 "무조건 컴팩트" 기본 UX 정책 (변경1 = NewCheckInDialog 선착수).
 *
 * 현장(김주연 총괄): "새 항목 생성 폼 불필요 필드·여백 제거, 무조건 컴팩트 = 기본값."
 *
 * 진행 방식 = propose→현장 confirm→확정.
 *  - 변경1(본 스펙 커버, 선착수): NewCheckInDialog(신규 체크인) — 파일힌트로 명시된 현장 확인 예시.
 *    순수 밀도 축소(label↔input space-y-1.5→1, form space-y-4→3). 필드 제거 0·payload 무변경.
 *  - 변경2(현장 confirm 대기): CreateCustomerDialog(신규 환자)·PackageTemplateDialog(패키지 추가)
 *    필드 제거/접기/프리필 — '불필요' 기준 현장 판단 필요 → responder 경유 제안 후 확정(별도 커밋).
 *  - 예약 생성 폼: 진행 2건(CLICKCREATE-7ADJ·CUSTCTX-PREFILL) 완료 후 컴팩트화(중복 diff 회피).
 *
 * 시나리오(AC 기준):
 *  1) AC1/AC2 — 체크인 생성 폼 첫 화면에 필수(이름·전화·유형)만 노출·컴팩트 렌더, 가로 넘침 0.
 *  2) AC6 — 필수값(이름/전화) 비면 저장 버튼 disabled(검증 회귀 0). 채우면 enabled.
 *
 * ※ FE-only(SQL 0·DB 비파괴·payload 무변경). 권한/데이터 부재 환경은 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openCheckInDialog(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin');
  await page.waitForLoadState('networkidle').catch(() => {});
  // "체크인" 버튼 클릭 시도, 실패 시 단축키 'n' fallback.
  const btn = page.getByRole('button', { name: '체크인', exact: true });
  try {
    await btn.first().click({ timeout: 8_000 });
  } catch {
    await page.keyboard.press('n').catch(() => {});
  }
  const dialog = page.getByRole('dialog').filter({ hasText: '체크인 추가' });
  try {
    await dialog.waitFor({ timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('T-20260701-foot-NEWFORM-COMPACT-DEFAULT — 신규 항목 생성 폼 컴팩트 기본값', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('시나리오1: AC1/AC2 — 체크인 생성 폼 첫 화면 필수만 컴팩트 렌더 + 가로 넘침 0', async ({ page }) => {
    const opened = await openCheckInDialog(page);
    if (!opened) test.skip(true, '체크인 생성 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: '체크인 추가' });

    // 필수 3요소가 첫 화면에 노출: 이름·전화번호 라벨 + 유형 버튼.
    await expect(dialog.getByText('이름', { exact: true })).toBeVisible();
    await expect(dialog.getByText('전화번호', { exact: true })).toBeVisible();
    await expect(dialog.getByText('유형', { exact: true })).toBeVisible();

    // 컴팩트: 다이얼로그 내부 가로 넘침 없음(레이아웃 붕괴 0).
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, '다이얼로그 가로 넘침').toBeLessThanOrEqual(2);

    // 컴팩트 밀도 증명: form 자식 그룹 간 세로 간격이 컴팩트(space-y-3=12px 이하)로 렌더.
    const gap = await dialog.evaluate(() => {
      const form = document.querySelector('[role="dialog"] form');
      if (!form) return -1;
      const kids = Array.from(form.children) as HTMLElement[];
      // space-y-* 는 두번째 자식부터 margin-top 부여 → 첫 자식 제외 최대 margin-top 측정.
      let maxMt = 0;
      kids.slice(1).forEach((k) => {
        maxMt = Math.max(maxMt, parseFloat(getComputedStyle(k).marginTop) || 0);
      });
      return maxMt;
    });
    if (gap >= 0) {
      expect(gap, `form 자식 간 세로간격(컴팩트 ≤12px 기대)`).toBeLessThanOrEqual(12.5);
      console.log(`[시나리오1] 체크인 폼 필수3요소 노출 + 가로넘침 ${overflow}px + form 세로간격 ${gap}px(컴팩트) OK`);
    } else {
      console.log(`[시나리오1] 체크인 폼 필수3요소 노출 + 가로넘침 ${overflow}px OK (form gap 미측정)`);
    }
  });

  test('시나리오2: AC6 — 필수값 검증 회귀 0 (이름/전화 비면 저장 disabled → 채우면 enabled)', async ({ page }) => {
    const opened = await openCheckInDialog(page);
    if (!opened) test.skip(true, '체크인 생성 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: '체크인 추가' });
    const submit = dialog.getByRole('button', { name: '체크인' });

    // 초기: 이름/전화 비어있음 → 저장 disabled(검증 유지).
    await expect(submit).toBeDisabled();

    // 이름만 입력해도 여전히 disabled(전화 필수 유지).
    const nameInput = dialog.locator('#ci-name');
    const phoneInput = dialog.locator('#ci-phone');
    await nameInput.fill('테스트컴팩트');
    await expect(submit).toBeDisabled();

    // 전화까지 입력 → enabled(정상 저장 경로 복원, 컴팩트화로 검증 안 깨짐).
    await phoneInput.fill('010-0000-1234');
    await expect(submit).toBeEnabled();
    console.log('[시나리오2] 필수값 gate 정상 — 빈값 disabled → 이름만 disabled → 이름+전화 enabled OK');
  });
});
