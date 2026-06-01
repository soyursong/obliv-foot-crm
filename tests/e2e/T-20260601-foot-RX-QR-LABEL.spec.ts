/**
 * E2E spec — T-20260601-foot-RX-QR-LABEL
 * 처방전 우측 상단 수정 — QR 옆(우측 상단) 보관용 오버레이 텍스트만 삭제 + QR 가림 해소.
 *
 * ─── 현장 확정 스코프 (MSG-20260601-180722-8kgj / 181005-tdlp, 김주연 총괄) ─────────────
 *  "처방전 중앙 상단에도 [약국보관용/환자보관용] 라벨이 이미 삽입되어 있어서, QR 쪽(우측 상단)에
 *   있는 문구만 제거하면 됨." → 중앙 상단 라벨은 2장 구분 표식으로 보존(절대 제거 금지),
 *   제거 대상은 우측 상단 QR 옆 absolute 오버레이 박스뿐.
 *
 * ─── 근본원인 (dev 규명, OPEN-Q#2) ──────────────────────────────────────────────
 *  RX-PRINT-DUAL(deployed ff5107c, 5/26)은 보관용 구분을 위해 두 군데에 라벨을 출력했다:
 *   (a) 중앙 헤더 템플릿 라벨  ({{rx_copy_label}})  — RX_STANDARD_HTML 헤더 flex 중앙 열  ← 보존
 *   (b) 우측 상단 absolute 오버레이 박스  (position:absolute;top:10px;right:10px; border:2px solid #222)
 *       — DocumentPrintPanel.buildHtmlPageHtml / PaymentMiniWindow.buildHtmlPageDiv 에서 주입  ← 제거
 *  이후 8FIX(field-soak 742dd7e, 6/01) AC-3④가 처방전 헤더 우측 상단(72px 셀)에 QR을 자동삽입.
 *  → RX-DUAL의 (b) absolute 오버레이(top-right)와 8FIX의 QR 셀(top-right)이 동일 영역에 겹쳐
 *    "약국보관용" 박스가 QR을 가림(첨부 red box). (b)만 제거하면 QR 가림 해소 + 구분 표식(a) 유지.
 *
 * 시나리오 S1: 처방전 발행 미리보기 — 우측 상단 QR 옆 오버레이 없음 + QR 단독 + 중앙 라벨 보존
 * 시나리오 S2: 2장 출력(RX-DUAL)·QR 자동삽입(8FIX) 유지 (무파괴) + 중앙 라벨 약국/환자 구분
 * 시나리오 S3: 출력경로 전수 — 차트 직접발행(PATH-1)·결제창 영수증 미니창(PATH-4) 동일
 *
 * NOTE: buildHtmlPageHtml/buildHtmlPageDiv 는 컴포넌트 로컬(미export) → 오버레이 제거는 소스 정적
 *       검증(grep)으로, 중앙 라벨 보존은 getHtmlTemplate+bindHtmlTemplate 렌더로 검증.
 *
 * 실행: playwright test --project=unit T-20260601-foot-RX-QR-LABEL
 */

// T-20260601-foot-RX-QR-LABEL

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const SRC_ROOT = path.join(__dirname, '../../src');
const FORM_TEMPLATES_SRC = path.join(SRC_ROOT, 'lib/htmlFormTemplates.ts');
const DOC_PANEL_SRC = path.join(SRC_ROOT, 'components/DocumentPrintPanel.tsx'); // PATH-1 (차트 직접발행)
const PAY_MINI_SRC = path.join(SRC_ROOT, 'components/PaymentMiniWindow.tsx');   // PATH-4 (결제창 영수증)

// 우측 상단 보관용 오버레이 박스의 식별 패턴 (RX-DUAL이 삽입했던 absolute 박스 — 제거 대상)
const COPY_LABEL_OVERLAY_RE = /position:absolute;top:10px;right:10px;background:rgba\(255,255,255,0\.93\);border:2px solid #222/;

// 8FIX QR 자동삽입에 필요한 바인딩. 중앙 라벨 검증을 위해 rx_copy_label 주입(buildHtmlPageHtml이 호출부에서 주입).
const RX_BIND_PHARMACY: Record<string, string> = {
  patient_name: '홍길동',
  record_no: 'F-0799',
  issue_date: '2026-06-01',
  issue_no: '1',
  clinic_code: '12345678',
  clinic_phone_only: '02-6956-3438',
  doctor_name: '문지은',
  doctor_seal_html: '(인)',
  usage_days: '3',
  rx_qr_html: '<img src="https://api.qrserver.com/v1/create-qr-code/?data=RX" alt="처방전 QR" />',
  rx_copy_label: '약국보관용',
};
const RX_BIND_PATIENT = { ...RX_BIND_PHARMACY, rx_copy_label: '환자보관용' };

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 S1: 처방전 미리보기 — 우측 상단 QR 옆 오버레이 제거 + QR 단독 + 중앙 라벨 보존
// ─────────────────────────────────────────────────────────────────────────────

test.describe('S1: 처방전 — 우측 상단 오버레이 제거 + QR 단독 + 중앙 라벨 보존 (AC-1·AC-2)', () => {

  test('AC-1: rx_standard 템플릿 — 중앙 보관용 라벨 {{rx_copy_label}} 보존(현장 "절대 제거 금지")', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html, '중앙 {{rx_copy_label}} placeholder 누락 = 구분 표식 소실').toContain('{{rx_copy_label}}');
    // 중앙 열(text-align:center)에 라벨이 위치 (제목 위)
    expect(html).toMatch(/text-align:center;[\s\S]{0,300}\(\{\{rx_copy_label\}\}\)/);
  });

  test('AC-1: rx_standard 렌더 — 중앙에 "약국보관용"/"환자보관용" 출력(구분 표식)', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(bindHtmlTemplate(html, RX_BIND_PHARMACY)).toContain('약국보관용');
    expect(bindHtmlTemplate(html, RX_BIND_PATIENT)).toContain('환자보관용');
  });

  test('AC-1: PATH-1(DocumentPrintPanel) — 우측 상단 보관용 오버레이 박스만 제거', () => {
    const src = fs.readFileSync(DOC_PANEL_SRC, 'utf-8');
    expect(src, 'copyLabelHtml 변수 잔존').not.toMatch(/const\s+copyLabelHtml\s*=/);
    expect(src, '${copyLabelHtml} 주입 잔존').not.toMatch(/\$\{copyLabelHtml\}/);
    expect(src, 'absolute top-right 라벨 박스 잔존').not.toMatch(COPY_LABEL_OVERLAY_RE);
    // 중앙 라벨 주입(rx_copy_label)은 보존되어야 함
    expect(src, '중앙 rx_copy_label 주입 누락').toMatch(/rx_copy_label:\s*copyLabel/);
  });

  test('AC-1: PATH-4(PaymentMiniWindow) — 우측 상단 보관용 오버레이 박스만 제거', () => {
    const src = fs.readFileSync(PAY_MINI_SRC, 'utf-8');
    expect(src, 'copyLabelHtml 변수 잔존').not.toMatch(/const\s+copyLabelHtml\s*=/);
    expect(src, '${copyLabelHtml} 주입 잔존').not.toMatch(/\$\{copyLabelHtml\}/);
    expect(src, 'absolute top-right 라벨 박스 잔존').not.toMatch(COPY_LABEL_OVERLAY_RE);
    expect(src, '중앙 rx_copy_label 주입 누락').toMatch(/rx_copy_label:\s*copyLabel/);
  });

  test('AC-2: rx_standard — QR가 헤더 우측 상단 단독 셀에 위치 ({{rx_qr_html}} 유지)', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html, 'QR placeholder 누락').toContain('{{rx_qr_html}}');
    // QR 셀(72px flex-shrink:0)이 헤더에 존재 → QR이 오버레이 박스 없이 단독 영역 확보
    expect(html).toMatch(/width:72px;\s*height:72px[\s\S]{0,200}\{\{rx_qr_html\}\}/);
  });

  test('AC-2: rx_standard 렌더 — QR img 삽입, placeholder 잔재 없음', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const rendered = bindHtmlTemplate(html, RX_BIND_PHARMACY);
    expect(rendered).toContain('<img');
    expect(rendered).not.toContain('{{rx_qr_html}}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 S2: 2장 출력(RX-DUAL)·QR 자동삽입(8FIX) 유지 (무파괴) — AC-3
// ─────────────────────────────────────────────────────────────────────────────

test.describe('S2: 2장 출력·QR 자동삽입 유지 (무파괴, AC-3)', () => {

  test('AC-3: PATH-1 — rx_standard 2장(약국+환자) 출력 호출부 유지', () => {
    const src = fs.readFileSync(DOC_PANEL_SRC, 'utf-8');
    const dualCallCount = (src.match(/buildHtmlPageHtml\([^)]*'약국보관용'\)/g) || []).length;
    const patientCallCount = (src.match(/buildHtmlPageHtml\([^)]*'환자보관용'\)/g) || []).length;
    expect(dualCallCount, '약국보관용 호출(인쇄+JPG 2경로)').toBeGreaterThanOrEqual(2);
    expect(patientCallCount, '환자보관용 호출(인쇄+JPG 2경로)').toBeGreaterThanOrEqual(2);
  });

  test('AC-3: PATH-4 — rx_standard 2장(약국+환자) 출력 호출부 유지', () => {
    const src = fs.readFileSync(PAY_MINI_SRC, 'utf-8');
    expect((src.match(/buildHtmlPageDiv\([^)]*'약국보관용'\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((src.match(/buildHtmlPageDiv\([^)]*'환자보관용'\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('AC-3: 8FIX QR 자동삽입 회귀 보호 — {{rx_qr_html}} + api.qrserver 유지', () => {
    const tplSrc = fs.readFileSync(FORM_TEMPLATES_SRC, 'utf-8');
    const abSrc = fs.readFileSync(path.join(SRC_ROOT, 'lib/autoBindContext.ts'), 'utf-8');
    expect(tplSrc).toContain('{{rx_qr_html}}');
    expect(abSrc).toContain('rx_qr_html');
    expect(abSrc).toContain('api.qrserver.com');
  });

  test('AC-3 무파괴 — 보관용 라벨 미주입(기본값) 상태에서도 처방전 렌더 에러 없음', () => {
    const html = getHtmlTemplate('rx_standard')!;
    // copyLabel 미지정 시 buildHtmlPageHtml이 기본값 '약국보관용' 주입 → 여기선 직접 주입으로 모사
    expect(() => bindHtmlTemplate(html, RX_BIND_PHARMACY)).not.toThrow();
    const rendered = bindHtmlTemplate(html, RX_BIND_PHARMACY);
    expect(rendered).not.toContain('{{');   // 미바인딩 placeholder 잔류 없음
    expect(rendered).toContain('처');       // 처방전 제목 유지
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 S3: 출력경로 전수 — 두 파일 모두 우측 상단 오버레이 박스 코드 소거
// ─────────────────────────────────────────────────────────────────────────────

test.describe('S3: 출력경로 전수 sweep — 우측 상단 오버레이 박스 전 경로 소거', () => {

  test('AC-1: 양 파일 — top:10px;right:10px 보관용 라벨 박스(코드) 전수 소거', () => {
    for (const [label, file] of [['DocumentPrintPanel', DOC_PANEL_SRC], ['PaymentMiniWindow', PAY_MINI_SRC]] as const) {
      const src = fs.readFileSync(file, 'utf-8');
      expect(src, `${label} copyLabelHtml 변수 잔존`).not.toMatch(/const\s+copyLabelHtml\s*=/);
      expect(src, `${label} 보관용 오버레이 박스 잔존`).not.toMatch(COPY_LABEL_OVERLAY_RE);
    }
  });

  test('근본원인/근거 주석 마커 존재 (RX-QR-LABEL)', () => {
    for (const file of [FORM_TEMPLATES_SRC, DOC_PANEL_SRC, PAY_MINI_SRC]) {
      const src = fs.readFileSync(file, 'utf-8');
      expect(src).toContain('T-20260601-foot-RX-QR-LABEL');
    }
  });
});
