/**
 * E2E spec — T-20260611-foot-REFERRAL-PRINT-CLIP-CENTER
 * 진료의뢰서 출력 시 (1) 우측/하단 짤림 제거, (2) 본문 중앙 배치, (3) 여백/폰트 조정.
 *
 * 원인: 진료의뢰서 form-wrap 이 width:195mm + 좌측 정렬(margin 없음)이라
 *       A4(210mm) 페이지에서 좌측 flush → 프린터 unprintable edge 에 본문이 물려 우측/하단 짤림 +
 *       페이지 중앙 미정렬.
 * 수정: form-wrap 인라인 width:188mm + max-width:188mm + margin:0 auto →
 *       좌우 11mm 여백 확보(짤림 제거) + 페이지 중앙 배치.
 *
 * AC-1: 양식 전체 내용이 페이지 안에 잘림 없이 표시 (우측/하단 clipping 제거 — width≤190mm)
 * AC-2: 본문이 인쇄 페이지 기준 중앙 배치 (margin:0 auto)
 * AC-3: 여백/폰트 조정하되 가독성 유지 (form-wrap 폭만 축소, 내부 폰트 9.5pt 유지)
 * AC-4: 기존 바인딩 필드(환자명·발행정보 등) 회귀 없음
 *
 * NOTE: bindHtmlTemplate/getHtmlTemplate 는 supabase 의존성 없어 unit 프로젝트에서 직접 import.
 * 실행: playwright test --project=unit T-20260611-foot-REFERRAL-PRINT-CLIP-CENTER
 */

// T-20260611-foot-REFERRAL-PRINT-CLIP-CENTER

import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const REFERRAL = getHtmlTemplate('referral_letter') ?? '';

// 진료의뢰서 본문 div (form-wrap) 의 인라인 style 추출 헬퍼
function referralWrapStyle(html: string): string {
  // <div class="form-wrap" ... style="...">  (주석/멀티라인 허용)
  const m = html.match(/<div class="form-wrap"[^>]*style="([^"]*)"/);
  return m ? m[1] : '';
}

test.describe('T-20260611-foot-REFERRAL-PRINT-CLIP-CENTER — 진료의뢰서 짤림/중앙배치', () => {
  test('템플릿 존재 + 제목 렌더', () => {
    expect(REFERRAL.length).toBeGreaterThan(0);
    expect(REFERRAL).toContain('진 료 의 뢰 서');
  });

  test('AC-1: 본문 폭이 A4 인쇄 가능 영역 내(≤190mm) — 우측 짤림 제거', () => {
    const style = referralWrapStyle(REFERRAL);
    const widthMatch = style.match(/(?:^|;)\s*width:\s*(\d+(?:\.\d+)?)mm/);
    expect(widthMatch, `form-wrap 에 명시 width(mm) 필요. style="${style}"`).not.toBeNull();
    const widthMm = parseFloat(widthMatch![1]);
    // 210mm A4 - 프린터 unprintable edge 고려, 좌우 최소 ~10mm 여백 확보
    expect(widthMm).toBeLessThanOrEqual(190);
    expect(widthMm).toBeGreaterThanOrEqual(180); // 가독성 — 너무 좁지 않게
    console.log(`[AC-1] form-wrap width=${widthMm}mm (≤190mm) PASS`);
  });

  test('AC-2: 본문 중앙 배치 — margin:0 auto', () => {
    const style = referralWrapStyle(REFERRAL);
    expect(style.replace(/\s/g, '')).toContain('margin:0auto');
    console.log('[AC-2] form-wrap margin:0 auto 중앙 배치 PASS');
  });

  test('AC-3: 가독성 — 본문 폰트 9.5pt 유지(축소 없음)', () => {
    // 폭만 줄였고 내부 본문 폰트(9.5pt)는 그대로여야 함
    expect(REFERRAL).toContain('font-size:9.5pt');
    console.log('[AC-3] 본문 9.5pt 폰트 유지 PASS');
  });

  test('AC-4: 기존 바인딩 필드 회귀 없음 — 환자명·발행정보 정상 치환', () => {
    const values: Record<string, string> = {
      patient_name: '홍길동',
      referral_year: '2026',
      referral_month: '06',
      referral_day: '11',
      dept_name: '족부정형',
      referring_doctor: '김의사',
      rrn_front: '900101',
      rrn_back: '1234567',
      patient_gender: '남',
      patient_age: '36',
      patient_phone: '010-1234-5678',
      patient_email: 'test@example.com',
      diagnosis: '족저근막염',
      medical_history: '6개월 전 발병',
      referral_content: '정밀 검사 요망',
      referral_to_hospital: '서울병원',
      clinic_phone: '02-000-0000',
      doctor_name: '박원장',
      clinic_name: '오블리브 풋센터',
    };
    const bound = bindHtmlTemplate(REFERRAL, values);

    // 핵심 바인딩 필드가 그대로 출력되는지 (회귀 가드)
    for (const v of ['홍길동', '족부정형', '김의사', '족저근막염', '서울병원', '박원장', '오블리브 풋센터']) {
      expect(bound, `바인딩 값 "${v}" 누락`).toContain(v);
    }
    // 미치환 플레이스홀더 잔존 없음
    expect(bound).not.toMatch(/\{\{patient_name\}\}|\{\{clinic_name\}\}|\{\{diagnosis\}\}/);
    console.log('[AC-4] 바인딩 필드 회귀 없음 PASS');
  });
});
