/**
 * T-20260810-foot-CONSENT-UNIQUEID-FORM2-FORMAT-ALIGN
 *   (자매/중복: T-20260810-foot-CONSENT-UNIQUEID-SECTION-FORMAT-ALIGN — commit dd8d2a14)
 *
 * 원 지시(김주연 총괄): 개인정보 동의서 §2 '고유식별정보' 만 표기·서식이 1·3·4번과 달라
 *   → ① 라벨 '별도 필수' → '(필수)' ② '동의함/동의하지 않음' dual 위젯 → 1·3·4번과 동일
 *      단일 체크박스 서식으로 정합. (표시-레이어 한정, db_change=false)
 *
 * 하드가드(AC-4): §24 별도 opt-in '실질'(고유식별정보를 다른 개인정보와 분리해 별도 동의받는
 *   독립 동의 라인)은 보존. '(필수)' 표기 통일 ≠ 별도 동의 삭제. 문안 변경 아님(서식 정합만).
 *
 * 성격: 코드 변경은 자매 SECTION 티켓 commit dd8d2a14 로 이미 배포(deployed, QA pass)됨.
 *   본 스펙 = §2 ↔ 1·3·4 서식 정합 불변식을 고정(regression-lock)하여 재-drift 방지.
 *
 * NOTE: htmlFormTemplates 는 supabase 의존성 없어 unit(auth·server 불요)로 직접 import.
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const FORM_KEY = 'privacy_consent_form';

test.describe('T-20260810 CONSENT-UNIQUEID-FORM2-FORMAT-ALIGN — §2 고유식별정보 서식 정합', () => {

  test('§2 = 1·3·4 와 동일 단일 체크박스 "(필수)" 서식 (dual 위젯·"별도 필수" 제거)', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-10', patient_name: '홍길동' }));

    // AC-2/AC-3 (정합 후 상태) — §2 동의 라인이 1·3·4번과 동일한 단일 체크박스 + '(필수)'
    await expect(page.getByText(/□ 고유식별정보 수집·이용에 동의합니다 \(필수\)/)).toBeVisible();

    // dual 위젯(동의함/동의하지 않음) 미노출
    await expect(page.getByText(/□ 동의함/)).toHaveCount(0);
    await expect(page.getByText(/□ 동의하지 않음/)).toHaveCount(0);

    // '별도 필수' 라벨 미노출 (표기 통일 완료)
    await expect(page.getByText(/별도 필수/)).toHaveCount(0);
  });

  test('1·2·3·4번 필수 동의 라인이 동일한 "□ …동의합니다 (필수)" 서식으로 정렬', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-10', patient_name: '홍길동' }));

    // 1·2·3·4 필수 4종이 모두 '□ …동의합니다 (필수)' 동일 서식
    await expect(page.getByText(/□ 개인정보 수집·이용에 동의합니다 \(필수\)/)).toBeVisible();
    await expect(page.getByText(/□ 고유식별정보 수집·이용에 동의합니다 \(필수\)/)).toBeVisible();
    await expect(page.getByText(/□ 민감정보\(건강·진료정보\) 수집·이용에 동의합니다 \(필수\)/)).toBeVisible();
    await expect(page.getByText(/□ 건강보험 자격조회에 동의합니다 \(필수\)/)).toBeVisible();

    // 필수 4종 동의 라인 '(필수)' 서식 = 정확히 4건 (선택 SMS 1종은 별도 서식이라 미포함)
    await expect(page.getByText(/동의합니다 \(필수\)/)).toHaveCount(4);
  });

  test('AC-4 — §24 별도 opt-in 실질 보존: 고유식별정보 본문 항목 verbatim 유지', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-10', patient_name: '홍길동' }));

    // 고유식별정보 = 독립 동의 블록(별도 동의 라인)으로 존재 + 수집항목/이용목적/보유기간 본문 불변
    await expect(page.getByText('주민등록번호, 외국인등록번호, 여권번호')).toBeVisible();
    await expect(page.getByText('의료법 및 국민건강보험법에 따른 본인확인, 진료기록 작성, 건강보험 자격확인')).toBeVisible();
    await expect(page.getByText('의료법에 따른 진료기록 보존기간 (10년)')).toBeVisible();
    // §2 는 '이용목적' 라벨(1·3·4의 '수집목적'과 구분) 유지
    await expect(page.getByText('이용목적', { exact: true })).toHaveCount(1);
  });
});
