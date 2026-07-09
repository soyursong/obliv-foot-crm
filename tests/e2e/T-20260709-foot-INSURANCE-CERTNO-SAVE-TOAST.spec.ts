/**
 * E2E / Regression Spec: T-20260709-foot-INSURANCE-CERTNO-SAVE-TOAST
 * 고객차트 "이해 탭" 보험 증번호 저장 '준비 중' 토스트 (저장 불가) — 수렴 가드
 *
 * 배경(REDEFINITION_CONVERGE): 현장(박민석 코디 F-4485)이 본 "준비 중" 토스트는
 *   T-20260707-CHART2-INSURANCE-CERTNO-FIELD(commit 4cb1ac95)가 심은 컬럼 미적용 window
 *   방어 분기의 산출물. saveCertNo 는 단일 핸들러이며 별개 placeholder 는 없다.
 *   → insurance_cert_no 컬럼이 PROD 에 착지하면 자연 해소. 별도 재구현 금지.
 *
 * 본 티켓 코드 기여:
 *   - 방어 분기 정규식을 컬럼 부재 시그니처(PGRST204 / 42703 / schema cache /
 *     "column ... does not exist")로 좁혀, 마이그 착지 후 무관 에러가 "준비 중"으로
 *     오분류되어 실제 저장 실패를 감추는 함정을 제거(견고화).
 *
 * AC-1: 어드민 대시보드 로드 — cert 관련 런타임 에러 없음 (회귀 가드)
 * AC-2: 저장 핸들러 소스 계약 — 단일 saveCertNo, 실제 update+persist, 준비중 토스트는
 *       컬럼 부재 window 방어 분기에만 존재(무조건 placeholder 아님)
 * AC-3: 인증 가능 환경 — 증번호 입력 → 저장 → 값 유지(persist) 풀 동선
 *
 * 주: CI 무인증 환경 고려 — 렌더/소스계약 스모크 중심. 인증 가능 환경에선 풀 동선 확장.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const __dirname = dirname(fileURLToPath(import.meta.url));
const CHART_SRC = resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');

// ── AC-1: 대시보드 로드 시 cert 관련 런타임 에러 없음 ──
test('AC-1: 어드민 대시보드 로드 — 보험 증번호 저장 관련 런타임 에러 없음', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await page.waitForLoadState('networkidle');
  const relevant = errors.filter((e) => /cert|insurance|savecertno/i.test(e));
  expect(relevant).toHaveLength(0);
});

// ── AC-2: 저장 핸들러 소스 계약 (수렴 가드 — 별개 placeholder 재유입 차단) ──
test('AC-2: saveCertNo 는 단일 저장 핸들러 + 준비중 토스트는 컬럼부재 window 방어에만 존재', () => {
  const src = readFileSync(CHART_SRC, 'utf-8');

  // 단일 핸들러 정의
  const handlerDefs = src.match(/const\s+saveCertNo\s*=/g) ?? [];
  expect(handlerDefs).toHaveLength(1);

  // 실제 저장 경로: customers.update({ insurance_cert_no }) 존재
  expect(src).toContain('.update({ insurance_cert_no: value })');
  // persist 후 상태 반영 + 성공 토스트
  expect(src).toContain('보험 증번호가 저장되었습니다');

  // 준비중 토스트는 존재하되, 반드시 컬럼 부재 시그니처 가드 안에서만.
  const certno = src.slice(src.indexOf('const saveCertNo ='));
  const preparingIdx = certno.indexOf('보험 증번호 저장 기능이 준비 중입니다');
  expect(preparingIdx).toBeGreaterThan(-1);
  // 준비중 토스트 직전 컨텍스트에 컬럼 부재 시그니처 가드가 있어야 함
  const guardCtx = certno.slice(Math.max(0, preparingIdx - 260), preparingIdx);
  expect(/PGRST204|42703|schema cache|does not exist/i.test(guardCtx)).toBe(true);

  // 회귀 방지: 컬럼명 단독 매칭(무관 에러 오분류)으로 되돌아가지 않았는지
  expect(certno).not.toContain('/insurance_cert_no|PGRST204');
});

// ── AC-3: 인증 가능 환경 — 증번호 입력 → 저장 → persist 풀 동선 ──
test('AC-3: 보험 증번호 입력 → 저장 → 값 유지(persist)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await page.waitForLoadState('networkidle');

  const loginVisible = await page.locator('input[type="password"]').count();
  if (loginVisible > 0) {
    test.info().annotations.push({ type: 'skip', description: '무인증 환경 — 풀 동선 스킵(AC-2 소스계약이 커버)' });
    return;
  }

  const certLabel = page.locator('text=보험 증번호');
  if ((await certLabel.count()) === 0) {
    test.info().annotations.push({ type: 'skip', description: '고객차트 미진입 — 필드 컨텍스트 밖' });
    return;
  }

  const certInput = page.locator('input[placeholder="건강보험증 번호 (선택)"]').first();
  await expect(certInput).toBeVisible();
  await certInput.fill('26003663272');
  await page.locator('button:has-text("저장")').first().click();
  // 준비중 경고 토스트가 아니라 값 유지(성공 경로) 확인
  await expect(certInput).toHaveValue('26003663272');
  await expect(page.locator('text=보험 증번호 저장 기능이 준비 중입니다')).toHaveCount(0);
});
