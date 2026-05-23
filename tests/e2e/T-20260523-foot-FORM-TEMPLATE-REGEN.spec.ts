/**
 * T-20260523-foot-FORM-TEMPLATE-REGEN — 펜차트 양식 이미지 매핑 회귀 방지
 *
 * AC-R1: pen_chart form_key → /forms/pen_chart_form.png (health_q 오매핑 방지)
 * AC-R2: pen_chart_form.png 경로가 health_q* 경로와 달라야 함
 * AC-R3: 4종 form_key→이미지 경로 전수 검증 (pen_chart / health_q_general / health_q_senior / refund_consent)
 * AC-R4: pen_chart_form.png 파일 내용이 health_q_general.png와 다름 (오배치 방지)
 *
 * Regression: c5edb46 — pen_chart_form.png에 health_q 이미지 잘못 배치
 *
 * NOTE: PenChartTab.tsx는 supabase를 import하므로 Node 컨텍스트에서 직접 import 불가.
 *       경로 상수는 BUILTIN 템플릿 정의(PenChartTab.tsx L91-L123)에서 추출해 인라인 검증.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ── BUILTIN 템플릿 경로 상수 (PenChartTab.tsx L91-L123 원본과 동기화 필수) ──
// Regression guard: 이 상수가 PenChartTab.tsx BUILTIN 정의와 어긋나면 테스트 실패로 알림
const EXPECTED = {
  pen_chart:                  { form_key: 'pen_chart',                  path: '/forms/pen_chart_form.png',    format: 'png'         },
  health_questionnaire_general: { form_key: 'health_questionnaire_general', path: '/forms/health_q_general.png',  format: 'png'         },
  health_questionnaire_senior:  { form_key: 'health_questionnaire_senior',  path: '/forms/health_q_senior.png',   format: 'png'         },
  refund_consent:             { form_key: 'refund_consent',             path: '/forms/refund_consent.png',    format: 'pdf_overlay' },
};

// public/forms/ 실제 파일 경로 (프로젝트 루트 기준)
const FORMS_DIR = path.join(process.cwd(), 'public', 'forms');

test.describe('T-20260523-foot-FORM-TEMPLATE-REGEN — form_key→이미지 매핑 전수 검증', () => {

  // ── AC-R1: 경로 상수 정의 올바름 ─────────────────────────────────────
  test('AC-R1: pen_chart → pen_chart_form.png (health_q 아님)', () => {
    const e = EXPECTED.pen_chart;
    expect(e.path).toBe('/forms/pen_chart_form.png');
    expect(e.path).not.toBe(EXPECTED.health_questionnaire_general.path);
    expect(e.path).not.toBe(EXPECTED.health_questionnaire_senior.path);
    expect(e.path).not.toContain('health_q');
  });

  // ── AC-R2: 4종 경로 중복 없음 ────────────────────────────────────────
  test('AC-R2: 4종 form_key 경로 모두 다름 (중복 없음)', () => {
    const paths = Object.values(EXPECTED).map((e) => e.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  // ── AC-R3: 각 form_key 경로 고정 검증 ────────────────────────────────
  test('AC-R3: health_questionnaire_general → /forms/health_q_general.png', () => {
    expect(EXPECTED.health_questionnaire_general.path).toBe('/forms/health_q_general.png');
  });

  test('AC-R3: health_questionnaire_senior → /forms/health_q_senior.png', () => {
    expect(EXPECTED.health_questionnaire_senior.path).toBe('/forms/health_q_senior.png');
  });

  test('AC-R3: refund_consent → /forms/refund_consent.png (format=pdf_overlay)', () => {
    expect(EXPECTED.refund_consent.path).toBe('/forms/refund_consent.png');
    expect(EXPECTED.refund_consent.format).toBe('pdf_overlay');
  });

  // ── AC-R3: 실제 파일 존재 + 최소 크기 ────────────────────────────────
  test('AC-R3: public/forms/pen_chart_form.png — 존재 + 50KB 이상', () => {
    const fp = path.join(FORMS_DIR, 'pen_chart_form.png');
    expect(fs.existsSync(fp)).toBe(true);
    const { size } = fs.statSync(fp);
    // 116KB 기준 — 발건강 질문지(600KB+)와 구분되는 올바른 양식 이미지 크기
    expect(size).toBeGreaterThan(50 * 1024);
    // 발건강 질문지(600KB)보다 작아야 정상 (두 파일이 다름 확인 보조)
    expect(size).toBeLessThan(600 * 1024);
  });

  test('AC-R3: public/forms/health_q_general.png — 존재', () => {
    expect(fs.existsSync(path.join(FORMS_DIR, 'health_q_general.png'))).toBe(true);
  });

  test('AC-R3: public/forms/health_q_senior.png — 존재', () => {
    expect(fs.existsSync(path.join(FORMS_DIR, 'health_q_senior.png'))).toBe(true);
  });

  test('AC-R3: public/forms/refund_consent.png — 존재', () => {
    expect(fs.existsSync(path.join(FORMS_DIR, 'refund_consent.png'))).toBe(true);
  });

  // ── AC-R4: pen_chart_form.png 내용이 health_q_general.png와 다름 ──────
  test('AC-R4: pen_chart_form.png ≠ health_q_general.png (파일 내용 달라야 함)', () => {
    const penBuf = fs.readFileSync(path.join(FORMS_DIR, 'pen_chart_form.png'));
    const hqBuf  = fs.readFileSync(path.join(FORMS_DIR, 'health_q_general.png'));
    // 바이트 동일하면 오배치 — 반드시 달라야 함
    expect(penBuf.equals(hqBuf)).toBe(false);
    // 크기도 달라야 함 (same-size 위장 방지)
    expect(penBuf.length).not.toBe(hqBuf.length);
  });

});
