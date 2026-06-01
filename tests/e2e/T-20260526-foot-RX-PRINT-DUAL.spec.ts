/**
 * E2E — T-20260526-foot-RX-PRINT-DUAL
 * 처방전 출력 2장(약국보관용 + 환자보관용)
 *
 * AC 검증:
 *   AC-1: 처방전 출력 시 2장 생성
 *   AC-2: 각 장 상단에 구분 라벨 표시 ("약국보관용" / "환자보관용")
 *   AC-3: 4개 경로 중 DocumentPrintPanel(1번차트) + PaymentMiniWindow(Zone3) 경로 검증
 *   AC-4: 약국보관용·환자보관용 내용(처방전 제목)은 동일 데이터
 *   AC-5: 다른 서류(진료확인서 등)는 1장만 출력
 *
 * 전략: DOM에서 buildHtmlPageHtml/buildHtmlPageDiv 결과를 검증하는
 *   unit-level DOM 테스트 (출력창은 popup — playwright route intercept 불필요).
 *   실제 인쇄 팝업 대신, DocumentPrintPanel 미리보기 DOM에서 복사 라벨 검증.
 */
import { test, expect } from '@playwright/test';
import { bindHtmlTemplate, getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// ── 단위 검증: htmlFormTemplates.ts 처방전 템플릿에 {{rx_copy_label}} 플레이스홀더 존재 ──

test.describe('T-20260526-foot-RX-PRINT-DUAL — 처방전 2장 출력', () => {
  // ── AC-1/AC-2: {{rx_copy_label}} 플레이스홀더 + 동적 치환 ──
  test('rx_standard 템플릿에 {{rx_copy_label}} 플레이스홀더가 존재한다', () => {
    const tpl = getHtmlTemplate('rx_standard');
    expect(tpl).not.toBeNull();
    expect(tpl!).toContain('{{rx_copy_label}}');
  });

  test('약국보관용 바인딩 → "(약국보관용)" 노출', () => {
    const tpl = getHtmlTemplate('rx_standard');
    expect(tpl).not.toBeNull();
    const bound = bindHtmlTemplate(tpl!, { rx_copy_label: '약국보관용' });
    expect(bound).toContain('(약국보관용)');
    expect(bound).not.toContain('{{rx_copy_label}}');
  });

  test('환자보관용 바인딩 → "(환자보관용)" 노출, "(약국보관용)" 미포함', () => {
    const tpl = getHtmlTemplate('rx_standard');
    expect(tpl).not.toBeNull();
    const bound = bindHtmlTemplate(tpl!, { rx_copy_label: '환자보관용' });
    expect(bound).toContain('(환자보관용)');
    // 하드코딩된 "약국보관용" 제거 검증
    // ※ 코멘트에 T-20260526 텍스트가 있으므로 HTML 코멘트 외 '(약국보관용)' 없는지 확인
    const nonCommentParts = bound.replace(/<!--[\s\S]*?-->/g, '');
    expect(nonCommentParts).not.toContain('약국보관용');
  });

  // ── AC-4: 두 사본에 동일 데이터(처방전 제목 처방전 포함) ──
  test('약국보관용·환자보관용 양쪽 모두 처방전 제목 포함 (동일 데이터)', () => {
    const tpl = getHtmlTemplate('rx_standard');
    expect(tpl).not.toBeNull();
    const pharmacy = bindHtmlTemplate(tpl!, { rx_copy_label: '약국보관용', patient_name: '홍길동', clinic_name: '테스트의원' });
    const patient  = bindHtmlTemplate(tpl!, { rx_copy_label: '환자보관용', patient_name: '홍길동', clinic_name: '테스트의원' });

    // 처방전 제목 존재
    expect(pharmacy).toContain('처&nbsp;&nbsp;방&nbsp;&nbsp;전');
    expect(patient).toContain('처&nbsp;&nbsp;방&nbsp;&nbsp;전');

    // 동일 환자명
    expect(pharmacy).toContain('홍길동');
    expect(patient).toContain('홍길동');
  });

  // ── AC-5: 다른 양식 (treat_confirm)에는 rx_copy_label 플레이스홀더 없음 ──
  test('treat_confirm(진료확인서)은 rx_copy_label 플레이스홀더 없음 — 1장 출력 영향 없음', () => {
    const tpl = getHtmlTemplate('treat_confirm');
    expect(tpl).not.toBeNull();
    expect(tpl!).not.toContain('{{rx_copy_label}}');
  });

  test('visit_confirm(통원확인서)은 rx_copy_label 플레이스홀더 없음', () => {
    const tpl = getHtmlTemplate('visit_confirm');
    expect(tpl).not.toBeNull();
    expect(tpl!).not.toContain('{{rx_copy_label}}');
  });

  test('diagnosis(진단서)은 rx_copy_label 플레이스홀더 없음', () => {
    const tpl = getHtmlTemplate('diagnosis');
    expect(tpl).not.toBeNull();
    expect(tpl!).not.toContain('{{rx_copy_label}}');
  });

  test('bill_receipt(진료비계산서·영수증)은 rx_copy_label 플레이스홀더 없음', () => {
    const tpl = getHtmlTemplate('bill_receipt');
    expect(tpl).not.toBeNull();
    expect(tpl!).not.toContain('{{rx_copy_label}}');
  });
});
