/**
 * E2E Spec — T-20260601-foot-DOC-SEAL-2DOCS
 *
 * [P1] 도장 잔존 누락 2건 복구 (진료의뢰서 · 의무기록사본발급신청서)
 *
 * 배경: DOC-SEAL-NULL-FALLBACK(f4622c5)은 autoBindContext에서 doctor_seal_html "값"만
 *   복구 → {{doctor_seal_html}} placeholder를 쓰는 서류에만 효과. 그러나 아래 2개 템플릿은
 *   htmlFormTemplates.ts에서 placeholder 자체가 없고 하드코딩 텍스트((날인)/(인))만 있어
 *   도장이 영영 안 찍힘.
 *   → 두 템플릿 의사/주치의 행에 {{doctor_seal_html}} placeholder 추가 (autoBindContext 무변경).
 *
 * AC-1 (진료의뢰서 도장표시): REFERRAL_LETTER_HTML 의사 행에 {{doctor_seal_html}} 존재, (날인) 제거.
 * AC-2 (의무기록사본 도장표시 + 환자란 무침범): MEDICAL_RECORD_REQUEST_HTML 주치의 서명 행에
 *      {{doctor_seal_html}} 존재. 단 환자(대리인) 서명 행의 (인)은 환자 날인란 → 보존(침범 금지).
 * AC-3 (다른 서류 무파괴 가드): autoBindContext 미변경 + 기존 doctor_seal_html 사용 서류 회귀 없음.
 *
 * 실행: npx playwright test --project=unit T-20260601-foot-DOC-SEAL-2DOCS.spec.ts
 * NOTE: 템플릿은 placeholder 문자열을 가진 const 리터럴 → 소스 정적 검증으로 placeholder 주입 확인.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/lib/htmlFormTemplates.ts'),
  'utf-8',
);
const AUTOBIND_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/lib/autoBindContext.ts'),
  'utf-8',
);

/** `const NAME = \`...\`;` 형태의 템플릿 리터럴 본문을 추출 */
function extractTemplate(name: string): string {
  const start = TEMPLATES_SRC.indexOf(`const ${name} = \``);
  expect(start, `${name} 템플릿을 찾지 못함`).toBeGreaterThanOrEqual(0);
  const bodyStart = TEMPLATES_SRC.indexOf('`', start) + 1;
  const bodyEnd = TEMPLATES_SRC.indexOf('`;', bodyStart);
  expect(bodyEnd, `${name} 종료 백틱을 찾지 못함`).toBeGreaterThan(bodyStart);
  return TEMPLATES_SRC.slice(bodyStart, bodyEnd);
}

const REFERRAL = extractTemplate('REFERRAL_LETTER_HTML');
const MEDICAL_RECORD = extractTemplate('MEDICAL_RECORD_REQUEST_HTML');

// ── 시나리오 1: 진료의뢰서 도장 표시 ─────────────────────────────────────────

test.describe('시나리오1 AC-1: 진료의뢰서 도장 placeholder 주입', () => {
  test('REFERRAL_LETTER_HTML에 {{doctor_seal_html}} 존재', () => {
    expect(REFERRAL, '진료의뢰서에 도장 placeholder 누락 → 도장 안 찍힘').toContain(
      '{{doctor_seal_html}}',
    );
  });

  test('하드코딩 (날인) 텍스트 제거됨', () => {
    expect(REFERRAL, '(날인) 텍스트 잔존 → placeholder 미치환').not.toContain('(날인)');
  });

  test('의사 성명 행과 도장이 함께 존재 (의사 날인 위치 보존)', () => {
    // {{doctor_name}}(의사 행) 과 {{doctor_seal_html}} 둘 다 있어야 함
    expect(REFERRAL).toContain('{{doctor_name}}');
    expect(REFERRAL).toContain('{{doctor_seal_html}}');
  });
});

// ── 시나리오 2: 의무기록사본 도장 표시 + 환자란 무침범 ─────────────────────────

test.describe('시나리오2 AC-2: 의무기록사본 주치의 도장 + 환자란 보존', () => {
  test('MEDICAL_RECORD_REQUEST_HTML에 {{doctor_seal_html}} 존재', () => {
    expect(MEDICAL_RECORD, '의무기록사본에 도장 placeholder 누락').toContain(
      '{{doctor_seal_html}}',
    );
  });

  test('주치의 서명 행에 도장 placeholder가 결합됨', () => {
    // '주치의 서명' 라벨 이후 같은 행 내에 {{doctor_seal_html}} 가 와야 함
    const idx = MEDICAL_RECORD.indexOf('주치의&nbsp;서명');
    expect(idx, '주치의 서명 행을 찾지 못함').toBeGreaterThanOrEqual(0);
    const afterDoctorRow = MEDICAL_RECORD.slice(idx);
    expect(afterDoctorRow, '주치의 서명 행에 도장 placeholder 없음').toContain(
      '{{doctor_seal_html}}',
    );
  });

  test('환자(대리인) 서명 행의 (인) 보존 — 환자 날인란 침범 금지', () => {
    const patientIdx = MEDICAL_RECORD.indexOf('환자(대리인)&nbsp;서명');
    expect(patientIdx, '환자(대리인) 서명 행을 찾지 못함').toBeGreaterThanOrEqual(0);
    // 환자 행 ~ 다음 주민등록번호 행 사이에 (인)이 그대로 있어야 함
    const recordNoIdx = MEDICAL_RECORD.indexOf('주민등록번호', patientIdx);
    const patientRow = MEDICAL_RECORD.slice(patientIdx, recordNoIdx);
    expect(patientRow, '환자 날인란 (인) 침범됨 — 절대 금지').toContain('(인)');
  });

  test('남은 (인)은 환자 행 1개뿐 (주치의 행은 도장으로 치환)', () => {
    const count = (MEDICAL_RECORD.match(/\(인\)/g) ?? []).length;
    expect(count, '(인) 개수 이상 — 주치의 행 미치환 또는 환자란 손상').toBe(1);
  });
});

// ── 시나리오 3: 다른 서류 무파괴 가드 ─────────────────────────────────────────

test.describe('시나리오3 AC-3: 다른 서류 회귀 없음', () => {
  test('autoBindContext.ts 미변경 — getStampUrl fallback 구조 유지', () => {
    // f4622c5의 fallback 로직이 그대로 살아 있어야 함 (이번 작업은 템플릿만 수정)
    expect(AUTOBIND_SRC).toMatch(/seal_image_url\s*\|\|\s*getStampUrl\(\)/);
  });

  test('기존 doctor_seal_html 사용 서류 placeholder 보존 (다수 잔존)', () => {
    // 진료확인서/소견서/처방전 등 이미 placeholder를 쓰던 서류 + 신규 2건
    const count = (TEMPLATES_SRC.match(/\{\{doctor_seal_html\}\}/g) ?? []).length;
    // 기존 9건 + 신규 2건 = 11건 이상이어야 함 (회귀로 줄면 실패)
    expect(count, 'doctor_seal_html placeholder 감소 — 다른 서류 도장 파괴 회귀').toBeGreaterThanOrEqual(11);
  });

  test('도장 placeholder는 inline 텍스트셀에만 — 우하단 stampOverlay 마크업 없음', () => {
    const lower = TEMPLATES_SRC.toLowerCase();
    expect(lower).not.toContain('position:fixed');
    expect(lower).not.toContain('position:absolute');
  });
});
