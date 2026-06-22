/**
 * E2E spec — T-20260603-foot-CHART2-QR-REOPEN  (RETIRED → 제거 회귀 가드)
 *
 * 원래 기능: 펜차트 발건강질문지 패널의 '셀프접수 QR 다시보기'(이미 발급된 QR 재표시).
 * 제거: T-20260622-foot-CHART2-UICLEAN-4FIX 요청5 — 상단 'QR 보기'와 중복이라 하단
 *       '셀프접수 QR 다시보기' 섹션 전체 제거(김주연 총괄). 진입점은 'QR 보기' 1개만 유지.
 *
 * 이 spec 은 과거 기능이 다시 살아나지 않도록(중복 재발 방지) 제거 상태를 고정한다.
 * 신규 동작 검증은 T-20260622-foot-CHART2-UICLEAN-4FIX.spec.ts 참조.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const healthQSrc = readFileSync(resolve(__dir, '../../src/components/HealthQResultsPanel.tsx'), 'utf-8');

test.describe('T-20260603-CHART2-QR-REOPEN — RETIRED (UICLEAN-4FIX 요청5 제거 가드)', () => {
  test('셀프접수 QR 다시보기 섹션/버튼이 재도입되지 않음', () => {
    expect(healthQSrc).not.toContain('셀프접수 QR 다시보기');
    expect(healthQSrc).not.toContain('healthq-reopen-section');
    expect(healthQSrc).not.toContain('healthq-reopen-qr-btn');
  });

  test('상단 "QR 보기" 진입점은 유지', () => {
    expect(healthQSrc).toContain('healthq-qr-view-btn');
    expect(healthQSrc).toContain('QR 보기');
  });
});
