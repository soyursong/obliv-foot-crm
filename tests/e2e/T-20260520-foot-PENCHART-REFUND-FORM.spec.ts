/**
 * E2E spec: T-20260520-foot-PENCHART-REFUND-FORM
 * 펜차트 양식 추가 — [환불/비급여동의서] PDF 원본 + 오버레이 입력
 *
 * AC-1: 양식 선택 패널에 [환불/비급여 동의서] 카드 표시
 * AC-2: 선택 시 PDF 원본 배경 + 오버레이 draw 모드
 * AC-3: 서명 캡처 패드 표시 (isPdfOverlayFormKey 확장)
 * AC-4: 저장 시 storage rc_ prefix + form_submissions refund_consent 행
 * AC-5: list 뱃지 배열에 [환불/비급여 동의서] 뱃지 추가
 * AC-6: 상담내역 그룹2 [내용보기] — refund_consent 항목 있으면 활성화
 * AC-7: 빌드 성공 + 기존 양식 회귀 없음
 */

import { test, expect } from '@playwright/test';

test.describe('PENCHART-REFUND-FORM: 환불/비급여 동의서 양식', () => {
  // AC-7: 빌드 통과 + 앱 정상 접근
  test('AC-7: 앱 정상 로드 (빌드 성공 검증)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // AC-1/AC-5: 환불/비급여 동의서 에셋 존재 확인
  test('AC-1/5: public/forms/refund_consent.png 에셋 서빙 확인', async ({ page }) => {
    const response = await page.goto('/forms/refund_consent.png');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('image/png');
  });
});

/**
 * 현장 클릭 시나리오 (수동 검증용 체크리스트):
 *
 * [시나리오1] 환불/비급여 동의서 작성 전체 플로우
 *   1. 고객차트 열기 → 우측 패널 'clinical' → '펜차트' 탭
 *   2. [새 차트 작성] 클릭 → 양식 선택 fullscreen 오픈
 *   3. [환불/비급여 동의서] 카드 표시 확인 (rose 계열 색상, "3페이지" 뱃지)
 *   4. 카드 클릭 → PDF 원본 3페이지 배경 캔버스 오픈 확인
 *   5. 서명 패드 표시 확인
 *   6. 태블릿펜 기입 → 서명 → [저장]
 *   7. list 복귀 + "환불/비급여 동의서 저장 완료" 토스트 확인
 *   8. 저장된 차트 목록에 rc_ 접두사 파일 표시 확인
 *   Expected: rc_{ts}_{rand}.png 파일명
 *
 * [시나리오2] 상담내역 뷰어 연동
 *   1. 위 시나리오1 완료 후 상담내역 탭으로 이동
 *   2. 그룹2 [내용보기] 활성화 확인 (refund_consent 항목 존재)
 *   3. [내용보기] 클릭 → "환불/비급여 동의서" 라벨 + PNG 이미지 표시
 *   Expected: PNG 이미지 뷰어 (편집 UI 없음)
 *
 * [시나리오3] 기존 양식 회귀 없음
 *   1. 펜차트 탭 → [새 차트 작성]
 *   2. 기존 양식 (펜차트/발건강질문지/개인정보체크리스트 2종) 모두 정상 표시 확인
 *   3. 각 양식 저장 후 list 복귀 정상 동작 확인
 *   Expected: 기존 5종 양식 + 환불/비급여 동의서 1종 = 총 6종 (펜차트 필기 + 발건강2 + 체크리스트2 + 환불1)
 */
