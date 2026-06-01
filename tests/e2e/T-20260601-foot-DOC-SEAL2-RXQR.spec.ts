/**
 * E2E Spec — T-20260601-foot-DOC-SEAL2-RXQR
 *
 * [P2] 8FIX·SEAL-FALLBACK field-soak 잔여: 의무기록사본발급신청서·진료의뢰서 도장 누락 (AC-1·AC-2)
 *
 * 배경 (dev 추적 결과):
 *   - DOC-SEAL-2DOCS(ad1dd0d)가 두 템플릿의 하드코딩 (날인)/(인) → {{doctor_seal_html}} placeholder 로 교체 완료.
 *   - 그러나 단일/미리보기 출력 경로(DocumentPrintPanel.allValues)가 override 유무와 무관하게 항상
 *     doctor_seal_html 을 doctor_seal_image(DB seal_image_url)로 덮어써, DB null(현재 상태)이면 '(인)'
 *     텍스트로 만들어 autoBindContext 의 SEAL-NULL-FALLBACK(seal_image_url || getStampUrl() || '(인)',
 *     autoBindContext.ts L308-313)을 파괴 → 배치 경로(autoValues)는 도장이미지가 나오는데 단일/미리보기
 *     경로만 텍스트라 두 경로 불일치. 진료의뢰서·의무기록사본(ad1dd0d placeholder 추가분)이 단일 발행 시 누락.
 *   - FIX: 실제 override 도장이미지(base.doctor_seal_image)가 있을 때만 그 이미지로 갱신하고, 없으면
 *     autoValues.doctor_seal_html(이미 3단 fallback 적용됨)을 보존한다. DocumentPrintPanel에서 getStampUrl을
 *     직접 호출하지 않음(8FIX REOPEN2 가드: 우하단 오버레이 부활 방지 위해 getStampUrl 비참조 유지).
 *
 * AC-3(처방전 우상단 QR 텍스트 제거)는 T-20260601-foot-RX-QR-LABEL 로 이관·중복제거(티켓 18:06) → 본 spec 범위 밖.
 *
 * 시나리오 매핑:
 *   시나리오1 → AC-1 의무기록사본발급신청서 도장 (placeholder 존재 + 단일경로 fallback)
 *   시나리오2 → AC-2 진료의뢰서 도장 (placeholder 존재 + 의뢰병원 회귀 가드)
 *   시나리오4 → AC-4 무파괴: 단일경로 3단 fallback이 autoBindContext와 동일, stampOverlay 부활 없음
 *
 * 실행: npx playwright test --project=unit T-20260601-foot-DOC-SEAL2-RXQR.spec.ts
 * NOTE: 단일 출력 경로 로직은 React useMemo(allValues) 내부 → 소스 정적 검증으로 fallback 정렬 확인.
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
const PRINT_PANEL_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/components/DocumentPrintPanel.tsx'),
  'utf-8',
);

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

/** allValues 의 doctor_seal_html 재동기화 블록 본문 추출 */
function extractSealResyncBlock(): string {
  const anchor = PRINT_PANEL_SRC.indexOf('의사 변경(override) 후 doctor_seal_html 재동기화');
  expect(anchor, '도장 재동기화 블록 주석을 찾지 못함').toBeGreaterThanOrEqual(0);
  // 주석 이후 ~ computedTotal(base.total_amount) 갱신 직전까지의 블록
  const totalIdx = PRINT_PANEL_SRC.indexOf('computedTotal !== null', anchor);
  expect(totalIdx).toBeGreaterThan(anchor);
  return PRINT_PANEL_SRC.slice(anchor, totalIdx);
}

const SEAL_BLOCK = extractSealResyncBlock();

// ── 시나리오 1 · AC-1: 의무기록사본발급신청서 도장 ───────────────────────────────

test.describe('시나리오1 AC-1: 의무기록사본발급신청서 도장', () => {
  test('MEDICAL_RECORD_REQUEST_HTML에 {{doctor_seal_html}} placeholder 존재', () => {
    expect(MEDICAL_RECORD, '의무기록사본 도장 placeholder 누락').toContain('{{doctor_seal_html}}');
  });

  test('주치의 서명 행에 도장 placeholder 결합 + 환자 (인)란 무침범', () => {
    const idx = MEDICAL_RECORD.indexOf('주치의&nbsp;서명');
    expect(idx, '주치의 서명 행을 찾지 못함').toBeGreaterThanOrEqual(0);
    expect(MEDICAL_RECORD.slice(idx)).toContain('{{doctor_seal_html}}');
    // 환자(대리인) 서명란 (인) 은 그대로 — 1개만 잔존
    const count = (MEDICAL_RECORD.match(/\(인\)/g) ?? []).length;
    expect(count, '환자 날인란 (인) 침범 또는 주치의행 미치환').toBe(1);
  });
});

// ── 시나리오 2 · AC-2: 진료의뢰서 도장 + 의뢰병원 회귀 가드 ─────────────────────

test.describe('시나리오2 AC-2: 진료의뢰서 도장', () => {
  test('REFERRAL_LETTER_HTML에 {{doctor_seal_html}} placeholder 존재 (날인 텍스트 제거)', () => {
    expect(REFERRAL, '진료의뢰서 도장 placeholder 누락').toContain('{{doctor_seal_html}}');
    expect(REFERRAL, '(날인) 잔존 → placeholder 미치환').not.toContain('(날인)');
  });

  test('8FIX AC-7 의뢰병원 자동기입 회귀 없음', () => {
    expect(REFERRAL, '의뢰병원 placeholder 회귀').toContain('{{referral_to_hospital}}');
  });
});

// ── 시나리오 4 · AC-1·AC-2 핵심: 단일/미리보기 경로 도장 누락 회귀 수정 ─────────────

test.describe('AC-1·AC-2 핵심: 단일 출력 경로 도장 누락 수정', () => {
  test('override 도장이미지(doctor_seal_image)가 있을 때만 doctor_seal_html 갱신', () => {
    // 기존 버그: 무조건 const sealImg = base.doctor_seal_image ?? ''; → base.doctor_seal_html = sealImg ? img : '(인)'
    //   (DB null이면 override 아니어도 autoValues fallback을 텍스트 '(인)'로 파괴)
    // 수정 후: if (base.doctor_seal_image) { ... } — 조건부 갱신
    expect(
      SEAL_BLOCK,
      '도장 재동기화가 조건부(override 존재 시)가 아님 → autoValues fallback 파괴',
    ).toMatch(/if\s*\(\s*base\.doctor_seal_image\s*\)/);
  });

  test('무조건 fallback (인) 텍스트 강제 대입 제거됨 (autoValues 값 보존)', () => {
    // 기존 버그 시그니처: doctor_seal_image ?? '' 후 삼항으로 '(인)' 강제 — 제거되어야 함
    expect(
      SEAL_BLOCK,
      "단일 경로가 여전히 '(인)' 텍스트를 강제 대입 → DB null 시 도장 누락 회귀",
    ).not.toContain("'(인)'");
  });

  test('DocumentPrintPanel은 getStampUrl 비참조 (8FIX REOPEN2 가드 준수)', () => {
    // autoValues.doctor_seal_html(autoBindContext에서 getStampUrl fallback 적용분)을 그대로 보존하므로
    // 이 파일에서 getStampUrl을 직접 호출할 필요가 없다 — 우하단 오버레이 부활 방지 가드 유지.
    expect(PRINT_PANEL_SRC, 'getStampUrl 재참조 — 8FIX REOPEN2 가드 위반').not.toContain('getStampUrl');
  });
});

// ── AC-4: 무파괴 가드 ─────────────────────────────────────────────────────────

test.describe('AC-4: 무파괴 / 위치 회귀 금지', () => {
  test('autoBindContext SEAL-NULL-FALLBACK 구조 보존 (배치 경로 무변경)', () => {
    expect(AUTOBIND_SRC).toMatch(/seal_image_url\s*\|\|\s*getStampUrl\(\)/);
  });

  test('doctor_seal_html placeholder 총량 회귀 없음 (11건 이상)', () => {
    const count = (TEMPLATES_SRC.match(/\{\{doctor_seal_html\}\}/g) ?? []).length;
    expect(count, 'doctor_seal_html placeholder 감소 — 다른 서류 도장 회귀').toBeGreaterThanOrEqual(11);
  });

  test('우하단 stampOverlay 부활 없음 (override 갱신은 인라인 셀 렌더)', () => {
    // 도장 재동기화 블록은 inline <img ...display:inline-block> 만 — position 고정 오버레이 금지
    expect(SEAL_BLOCK.toLowerCase()).not.toContain('position:absolute');
    expect(SEAL_BLOCK.toLowerCase()).not.toContain('position:fixed');
    expect(SEAL_BLOCK).toContain('display:inline-block');
  });
});
