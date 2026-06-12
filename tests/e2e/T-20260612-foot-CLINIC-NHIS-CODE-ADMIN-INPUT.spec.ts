/**
 * E2E spec — T-20260612-foot-CLINIC-NHIS-CODE-ADMIN-INPUT
 * 요양기관기호 어드민 입력 필드 추가 (parent: RX-TOPBAR followup)
 *
 * 배경: 처방전·진료의뢰서 우상단 요양기관기호 바인딩({{clinic_code}}→clinics.nhis_code)·
 *       컬럼은 기존 존재. 그러나 현장이 값을 자가 입력할 어드민 UI가 부재(write 경로 0건).
 *       → 기관설정(섹션 A 병원 기본정보)에 "요양기관기호" 입력 필드 추가.
 *
 * AC-2: 기관 설정 화면에 "요양기관기호" 입력 필드 추가 → clinics.nhis_code write 연결.
 * AC-3: 입력/저장은 어드민·매니저 권한 한정(canEdit 가드, disabled/저장버튼 미노출).
 * AC-5: 기존 기관 설정 항목(병원명·주소·전화·사업자등록번호 등) 회귀 없음.
 *
 * 시나리오 1: 기관설정 진입 → 요양기관기호 필드 렌더 + 기존 항목 회귀 없음
 * 시나리오 2: 권한 가드 — 저장 버튼/필드 disabled 상태가 canEdit과 일치
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260612-CLINIC-NHIS-CODE-ADMIN-INPUT — 요양기관기호 어드민 입력 필드', () => {

  // ── 시나리오 1: 요양기관기호 필드 렌더 + 기존 항목 회귀 없음 ──────────────
  test('AC-2/AC-5 S1: 기관설정에 요양기관기호 입력 필드 추가 + 기존 항목 유지', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — storageState 필요');
      return;
    }

    await page.goto('/admin/clinic-settings');
    await expect(page.getByText('병원·원장 정보 설정')).toBeVisible({ timeout: 10_000 });

    // AC-2: 요양기관기호 라벨 + 입력 필드(placeholder) 존재
    await expect(page.getByText('요양기관기호')).toBeVisible();
    await expect(page.getByPlaceholder(/처방전.*진료의뢰서.*우상단/)).toBeVisible();

    // AC-5: 기존 기관 기본정보 항목 회귀 없이 유지
    await expect(page.getByText('병원 기본정보')).toBeVisible();
    await expect(page.getByPlaceholder('오블리브 종로점')).toBeVisible();   // 병원명
    await expect(page.getByPlaceholder(/종로구/i)).toBeVisible();           // 주소
    await expect(page.getByPlaceholder('02-1234-5678')).toBeVisible();      // 전화
    await expect(page.getByPlaceholder('123-45-67890')).toBeVisible();      // 사업자등록번호
  });

  // ── 시나리오 2: 권한 가드 (어드민·매니저 한정 write) ──────────────────────
  test('AC-3 S2: 요양기관기호 필드 권한 가드 — canEdit과 disabled 일치', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패');
      return;
    }

    await page.goto('/admin/clinic-settings');
    await page.getByText('병원·원장 정보 설정').waitFor({ timeout: 10_000 });

    // 요양기관기호 입력 필드 locator (placeholder 기준)
    const nhisInput = page.getByPlaceholder(/처방전.*진료의뢰서.*우상단/);
    await expect(nhisInput).toBeVisible();

    // 저장 버튼 존재 여부 = canEdit 여부와 동일 신호.
    // - canEdit(admin/manager): 병원정보 저장 버튼 노출 + nhis 필드 편집 가능
    // - view-only(일반): 저장 버튼 미노출 + 모든 기본정보 필드 disabled
    const saveBtn = page.getByRole('button', { name: /병원정보 저장/ });
    const canEdit = (await saveBtn.count()) > 0;

    if (canEdit) {
      // 어드민·매니저: nhis 필드 편집 가능 + 다른 기본정보 필드와 동일하게 enabled
      await expect(nhisInput).toBeEnabled();
      await expect(saveBtn).toBeEnabled();
    } else {
      // view-only: nhis 필드도 다른 기본정보 필드와 동일하게 disabled (write 차단)
      await expect(nhisInput).toBeDisabled();
    }
  });
});
