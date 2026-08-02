/**
 * E2E spec — T-20260802-foot-ATTENDANCE-QR-PORT
 * 롱레 QR 출퇴근 스택 → foot 이식. 키오스크(회전QR) + punch 2경로(기기바인딩/폰OTP).
 *
 * 현장 클릭 시나리오(티켓 §현장 클릭 시나리오) → E2E 변환:
 *   AC-1: 키오스크 라우트(/attendance/kiosk/:slug?k=…) 비로그인 렌더 + QR 영역/회전 힌트 표시.
 *   AC-2: punch 라우트(/attendance/punch) 접근정보 없으면 "QR 다시 스캔" 안내(missing-params).
 *   AC-3: punch 라우트 c+t 파라미터 有 → 선택 화면(기기등록 / 문자출근 2경로 버튼) 렌더.
 *   AC-4: 폰+OTP 경로 진입 → 전화번호 입력 + "인증번호 받기" 버튼(비로그인 셀프 punch UX).
 *   AC-5: 기기 등록 경로 진입 → 본인 이름 입력 화면.
 *
 * ⚠ 키오스크 QR 실발급/OTP 실발송/punch 실기록은 EF(attendance-otp) + Vault 키 prod 배포 후 성립.
 *   본 spec 은 비로그인 공개 라우트의 FE 렌더·동선 분기(고객 셀프체크인과 별개)를 검증한다.
 *   실 punch/리컨사일 판정은 supervisor QA + 갤탭 실기기 현장 confirm 게이트에서 확인.
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260802-ATTENDANCE-QR-PORT — 직원 QR 출퇴근 (public 라우트)', () => {

  test('AC-1: 키오스크 라우트 비로그인 렌더 + 회전 QR 영역/힌트', async ({ page }) => {
    // ?k= 전용 링크 모드 → 로그인 우회(Gate 분기). 토큰 무효여도 페이지는 뜸(QR 미발급 안전).
    await page.goto('/attendance/kiosk/jongno-foot?k=e2e-probe-token');
    const kiosk = page.getByTestId('attendance-kiosk');
    await expect(kiosk).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('직원 출퇴근')).toBeVisible();
    // QR 매트릭스(svg) 또는 준비중/오류 폴백 중 하나 — 회전 힌트는 항상 렌더
    await expect(page.getByTestId('kiosk-rotate-hint')).toBeVisible();
  });

  test('AC-2: punch 접근정보 없으면 재스캔 안내', async ({ page }) => {
    await page.goto('/attendance/punch');
    await expect(page.getByTestId('attendance-punch')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('punch-missing-params')).toBeVisible();
  });

  test('AC-3: punch c+t 파라미터 有 → 2경로 선택 화면', async ({ page }) => {
    await page.goto('/attendance/punch?c=jongno-foot&t=999999999.deadbeefdeadbeefdeadbeefdeadbeef');
    await expect(page.getByTestId('attendance-punch')).toBeVisible({ timeout: 15_000 });
    // 기기바인딩 기본 노출 → 선택 화면(등록 / 문자 2경로)
    await expect(page.getByTestId('punch-choice')).toBeVisible();
    await expect(page.getByTestId('punch-device-enroll-btn')).toBeVisible();
    await expect(page.getByTestId('punch-sms-btn')).toBeVisible();
  });

  test('AC-4: 폰+OTP 경로 진입 → 번호 입력 + 인증번호 받기', async ({ page }) => {
    await page.goto('/attendance/punch?c=jongno-foot&t=999999999.deadbeefdeadbeefdeadbeefdeadbeef');
    await expect(page.getByTestId('punch-choice')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('punch-sms-btn').click();
    await expect(page.getByTestId('punch-step-phone')).toBeVisible();
    await expect(page.getByTestId('punch-phone-input')).toBeVisible();
    await expect(page.getByTestId('punch-send-btn')).toBeVisible();
  });

  test('AC-5: 기기 등록 경로 진입 → 본인 이름 입력', async ({ page }) => {
    await page.goto('/attendance/punch?c=jongno-foot&t=999999999.deadbeefdeadbeefdeadbeefdeadbeef');
    await expect(page.getByTestId('punch-choice')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('punch-device-enroll-btn').click();
    await expect(page.getByTestId('punch-enroll-name')).toBeVisible();
    await expect(page.getByTestId('punch-enroll-name-input')).toBeVisible();
    await expect(page.getByTestId('punch-enroll-submit-btn')).toBeVisible();
  });
});
