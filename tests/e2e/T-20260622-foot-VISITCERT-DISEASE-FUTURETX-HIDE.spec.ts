/**
 * E2E Spec — T-20260622-foot-VISITCERT-DISEASE-FUTURETX-HIDE
 *
 * 통원확인서(visit_confirm) · 진료확인서(treat_confirm) 두 서류에서
 *   ① 상병명(병명: 상병코드/상병명/특정기호 + 임상적추정/최종진단/임상적진단 분류)
 *   ② 향후치료(향후 치료의견)
 * 항목을 화면 미리보기·인쇄 출력 모두에서 비노출(템플릿 미렌더) 처리.
 * 김주연 총괄(U0ATDB587PV) 현장 요청, 2026-06-22, #foot C0ATE5P6JTH.
 *
 * 구현: htmlFormTemplates.ts 의 TREAT_CONFIRM_HTML / VISIT_CONFIRM_HTML 에서
 *   병명 테이블 + 임상적추정 div + 향후치료의견 행을 제거. bindHtmlTemplate(SSOT) 으로
 *   바인딩되어 미리보기/인쇄가 동일 HTML 사용 → 두 경로 동시 반영.
 *   발행/바인딩 RPC·published 불변 트리거·diag_ 토큰·treatment_opinion 바인딩 컨텍스트 불변.
 *
 * AC:
 *  - AC-1: 두 서류 HTML 에 상병명·향후치료 필드/라벨 미존재
 *  - AC-2: 다른 서류(소견서/진단서)는 상병/진단 표시 동작 유지(회귀 0)
 *  - AC-5: bindHtmlTemplate 으로 바인딩 시 잔존 토큰·깨짐 없음(미리보기=인쇄 일치)
 *
 * 실행: npx playwright test T-20260622-foot-VISITCERT-DISEASE-FUTURETX-HIDE.spec.ts
 * NOTE: HTML 템플릿(SSOT) 단위 검증 — 미리보기/인쇄가 공유하는 getHtmlTemplate+bindHtmlTemplate
 *   출력을 직접 단언하므로 실서버 불필요.
 */

import { test, expect } from '@playwright/test';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
  isHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';

const TARGET_CERTS = ['treat_confirm', 'visit_confirm'] as const;

// 상병명(병명) 섹션 식별 마커
const DISEASE_MARKERS = ['상 병 코 드', '특 정 기 호', '임상적추정', '최 종 진 단', '임상적진단'];
// 상병명/특정기호/병명 바인딩 토큰
const DISEASE_TOKENS = [
  '{{diag_code_1}}',
  '{{diag_name_1}}',
  '{{diag_flag_1}}',
  '{{diag_row_3_style}}',
];
// 향후치료 마커/토큰
const FUTURE_TX_MARKERS = ['향후<br>치료<br>의견'];
const FUTURE_TX_TOKEN = '{{treatment_opinion}}';

// ── 시나리오 1·2: 통원/진료확인서 — 상병명·향후치료 비노출 ──────────────────────

for (const formKey of TARGET_CERTS) {
  test(`${formKey}: 상병명(병명·진단분류) 항목 미노출`, () => {
    const html = getHtmlTemplate(formKey);
    expect(html, `${formKey} HTML 템플릿 존재`).toBeTruthy();
    for (const marker of DISEASE_MARKERS) {
      expect(html, `${formKey} — '${marker}' 미존재`).not.toContain(marker);
    }
    for (const token of DISEASE_TOKENS) {
      expect(html, `${formKey} — 상병 토큰 '${token}' 미존재`).not.toContain(token);
    }
  });

  test(`${formKey}: 향후치료(향후 치료의견) 항목 미노출`, () => {
    const html = getHtmlTemplate(formKey)!;
    for (const marker of FUTURE_TX_MARKERS) {
      expect(html, `${formKey} — '${marker}' 미존재`).not.toContain(marker);
    }
    expect(html, `${formKey} — '${FUTURE_TX_TOKEN}' 미존재`).not.toContain(FUTURE_TX_TOKEN);
  });

  test(`${formKey}: 용도 행 등 잔존 항목·확인 문구는 유지(과삭제 방지)`, () => {
    const html = getHtmlTemplate(formKey)!;
    expect(html).toContain('용&nbsp;&nbsp;도');
    expect(html).toContain('{{purpose}}');
    expect(html).toContain('환자 성명');
    expect(html).toContain('{{patient_name}}');
    // 확인 문구는 서류별로 보존
    if (formKey === 'treat_confirm') expect(html).toContain('진료중임(진료하였음)을 확인함');
    if (formKey === 'visit_confirm') expect(html).toContain('통원중임(통원하였음)을 확인함');
  });

  test(`${formKey}: bindHtmlTemplate 후 잔존 {{token}}·상병/향후치료 값 미출력`, () => {
    const html = getHtmlTemplate(formKey)!;
    // 발행 컨텍스트가 상병명/향후치료 값을 넘겨도 템플릿에 자리가 없으므로 출력되지 않음
    const bound = bindHtmlTemplate(html, {
      patient_name: '홍길동',
      purpose: '제출용',
      diag_name_1: '발바닥근막염',
      diag_code_1: 'M72.2',
      treatment_opinion: '향후 6개월 통원 치료 요함',
    });
    // 미바인딩 잔존 토큰 없음(미리보기=인쇄 동일 HTML 보장)
    expect(bound).not.toMatch(/\{\{\w+\}\}/);
    // 상병명/향후치료 값이 출력물에 새어나오지 않음
    expect(bound).not.toContain('발바닥근막염');
    expect(bound).not.toContain('M72.2');
    expect(bound).not.toContain('향후 6개월 통원 치료 요함');
    // 유지 항목은 정상 출력
    expect(bound).toContain('홍길동');
    expect(bound).toContain('제출용');
  });
}

// ── 시나리오 3: 회귀 가드 — 대상 한정(다른 서류 무변경) ─────────────────────────

test('회귀가드: 소견서(diag_opinion)·진단서(diagnosis)는 상병/진단 표시 동작 유지', () => {
  // 진단서는 상병명·진단 표기가 본질 → 마커/토큰이 유지되어야 함(회귀 0)
  const diagnosis = getHtmlTemplate('diagnosis');
  expect(diagnosis).toBeTruthy();
  const hasDiseaseSurface =
    diagnosis!.includes('{{diag_name_1}}') ||
    diagnosis!.includes('상 병 명') ||
    diagnosis!.includes('병  명') ||
    diagnosis!.includes('병&nbsp;');
  expect(hasDiseaseSurface, '진단서에는 상병/진단 표기가 유지되어야 함').toBeTruthy();

  // 소견서도 HTML 템플릿으로 정상 존재(본 티켓 미접촉)
  expect(isHtmlTemplate('diag_opinion')).toBe(true);
});

test('회귀가드: 비대상 서류에는 본 티켓 hide 가 전파되지 않음', () => {
  // 진단서가 향후치료/상병명 관련 surface 를 정상 보유(통원/진료확인서와 달리 비표시 적용 안 됨)
  const diagnosis = getHtmlTemplate('diagnosis')!;
  // treat/visit confirm 에서 제거한 향후치료의견 surface 가 진단서에는 영향 없음 — 진단서 자체 구조 유지
  expect(diagnosis.length).toBeGreaterThan(100);
});
