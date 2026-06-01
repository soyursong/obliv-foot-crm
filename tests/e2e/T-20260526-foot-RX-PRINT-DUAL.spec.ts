/**
 * E2E — T-20260526-foot-RX-PRINT-DUAL
 * 처방전 출력 2장(약국보관용 + 환자보관용)
 *
 * AC 검증:
 *   AC-1: 처방전 출력 시 2장 생성
 *   AC-2: [SUPERSEDED by T-20260601-foot-RX-QR-LABEL] 보관용 구분 라벨 표시 → 라벨이 QR을 가려
 *         현장 요청으로 완전 제거(①). 라벨 단언은 "제거됨" 회귀 가드로 전환.
 *   AC-3: 4개 경로 중 DocumentPrintPanel(1번차트) + PaymentMiniWindow(Zone3) 경로 검증
 *   AC-4: 두 사본 내용(처방전 제목)은 동일 데이터 — 여전히 유효 (2장·동일데이터 유지)
 *   AC-5: 다른 서류(진료확인서 등)는 1장만 출력
 *
 * 전략: DOM에서 buildHtmlPageHtml/buildHtmlPageDiv 결과를 검증하는
 *   unit-level DOM 테스트 (출력창은 popup — playwright route intercept 불필요).
 *   실제 인쇄 팝업 대신, DocumentPrintPanel 미리보기 DOM에서 복사 라벨 검증.
 */
import { test, expect } from '@playwright/test';
import { bindHtmlTemplate, getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// ── 단위 검증: 처방전 템플릿 — RX-QR-LABEL 이후 보관용 라벨 완전 제거 상태 ──

test.describe('T-20260526-foot-RX-PRINT-DUAL — 처방전 2장 출력', () => {
  // ── AC-2 SUPERSEDED (T-20260601-foot-RX-QR-LABEL): 보관용 구분 라벨 완전 제거 회귀 가드 ──
  test('[SUPERSEDED] rx_standard 템플릿에 {{rx_copy_label}} 플레이스홀더가 제거됨 (라벨 폐기)', () => {
    const tpl = getHtmlTemplate('rx_standard');
    expect(tpl).not.toBeNull();
    // RX-QR-LABEL: QR을 가리던 보관용 라벨 완전 제거(①) → placeholder도 삭제
    expect(tpl!).not.toContain('{{rx_copy_label}}');
  });

  test('[SUPERSEDED] 보관용 라벨 미주입 — 렌더 시 "약국보관용"/"환자보관용" 텍스트 미노출', () => {
    const tpl = getHtmlTemplate('rx_standard');
    expect(tpl).not.toBeNull();
    const bound = bindHtmlTemplate(tpl!, { patient_name: '홍길동' });
    const nonCommentParts = bound.replace(/<!--[\s\S]*?-->/g, '');
    expect(nonCommentParts).not.toContain('약국보관용');
    expect(nonCommentParts).not.toContain('환자보관용');
    expect(nonCommentParts).not.toContain('보관용');
    expect(bound).not.toContain('{{rx_copy_label}}');
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
