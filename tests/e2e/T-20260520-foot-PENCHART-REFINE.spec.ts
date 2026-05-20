/**
 * E2E spec: T-20260520-foot-PENCHART-REFINE
 * 펜차트↔상담내역 연동 재정비 + 환불/비급여 동의서 [내용보기] 활성화
 *
 * AC-1: 펜차트 저장 후 상담내역 [내용보기] 활성화
 *   (template_key null fallback via field_data.form_key)
 * AC-2: [내용보기] → 읽기전용 PNG 뷰어
 * AC-3: 상담내역 Group1 [작성] 없음 / Group2 [펜차트에서 작성] 라우팅
 * AC-5~7: 환불/비급여동의서 PDF 배경 + 펜 기입 + 저장 (REFUND-FORM 재확인)
 * AC-9: 기존 양식 무영향
 */

import { test, expect } from '@playwright/test';

test.describe('PENCHART-REFINE: 상담내역↔펜차트 연동 재정비', () => {
  // AC-9: 빌드 + 앱 정상 로드
  test('AC-9: 앱 정상 로드', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // AC-5~7: 환불/비급여 동의서 에셋 서빙 확인
  test('AC-5: public/forms/refund_consent.png 에셋 정상 서빙', async ({ page }) => {
    const response = await page.goto('/forms/refund_consent.png');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('image/png');
  });
});

/**
 * 현장 클릭 시나리오 (수동 검증용):
 *
 * [시나리오1] AC-1: 펜차트 저장 → 상담내역 [내용보기] 활성화
 *   1. 고객차트 → 펜차트 탭 → [새 차트 작성] → [환불/비급여 동의서] 선택
 *   2. 태블릿펜 기입 → 서명 → [저장]
 *   3. 상담내역 탭 이동 → 그룹2 "합본 양식" 뱃지 ✓ + [내용보기] 버튼 활성화(파란글씨)
 *   4. [내용보기] 클릭 → PNG 이미지 뷰어 열림 (편집 UI 없음)
 *   Expected: template_key fallback(field_data.form_key)으로 refund_consent 인식
 *
 * [시나리오2] AC-3: 상담내역 [작성] 없음 확인
 *   1. 상담내역 탭 → 그룹1(개인정보/체크리스트): [내용보기] 버튼만 표시, [작성] 없음
 *   2. 그룹2(환불/비급여): [펜차트에서 작성] + [내용보기] 표시
 *   3. [펜차트에서 작성] 클릭 → 펜차트 탭으로 이동 (자체양식 안 열림)
 *   Expected: 상담내역 탭 자체에서 어떤 양식도 직접 열리지 않음
 *
 * [시나리오3] AC-2: 읽기전용 뷰어 확인
 *   1. 그룹2 [내용보기] 클릭
 *   2. "환불 / 비급여 동의서" 제목 다이얼로그 열림
 *   3. 저장된 PNG 이미지 표시 (날짜 + 라벨 포함)
 *   4. 편집 도구(펜/지우개/저장 버튼) 없음
 *   Expected: 이미지 뷰어 only
 *
 * [시나리오4] AC-9: 기존 양식 회귀 없음
 *   1. 펜차트 탭 → [새 차트 작성] → 펜차트 양식 / 발건강 질문지 각각 테스트
 *   2. 저장 후 list 복귀 정상
 *   Expected: 기존 양식 동작 영향 없음
 */
