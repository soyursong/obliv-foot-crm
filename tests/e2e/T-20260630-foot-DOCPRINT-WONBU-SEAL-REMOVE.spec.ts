/**
 * E2E Spec — T-20260630-foot-DOCPRINT-WONBU-SEAL-REMOVE
 *
 * [P1] 진료확인서·통원확인서 2종 한정 우측 상단 '원부대조필인' 표기 삭제
 *      (현장 총괄 김주연 P0 push, 2026-06-30)
 *
 * 배경: 좌상단 doctor_seal_html(날인)과 별개로, 일부 서류 우측 상단에 하드코딩된
 *   <div class="stamp-box">원부대조필<br>인</div> 도장칸이 있었다. 현장 요청으로
 *   진료확인서(treat_confirm) · 통원확인서(visit_confirm) 2종에서만 이 표기를 제거.
 *   진단서·소견서 등 나머지 서류의 stamp-box는 그대로 유지(회귀 금지).
 *
 * 변경: 제거는 우상단 inner stamp-box div만 삭제하고 우측 flex:1 빈 컨테이너는 유지 →
 *   좌(flex:1 spacer)·우(flex:1) 균형 보존 = 제목 중앙정렬(CENTER-ALIGN) 불변.
 *
 * AC-1 (진료확인서 도장 삭제): TREAT_CONFIRM_HTML 에 원부대조필 stamp-box 없음.
 *      split 변형(code/nocode)도 동일(레거시 재사용) → 렌더 결과 무도장.
 * AC-2 (통원확인서 도장 삭제): VISIT_CONFIRM_HTML 에 원부대조필 stamp-box 없음.
 * AC-3 (회귀 가드): 진단서(DIAGNOSIS) · 소견서(DIAG_OPINION) stamp-box 원부대조필 유지.
 *      전체 소스 원부대조필 stamp-box 정확히 2건(진단서·소견서)만 잔존.
 *      좌상단 doctor_seal_html(날인) placeholder 개수 무변동(별개 표기 — 손대지 않음).
 * AC-4 (중앙정렬 불변): 진료확인서·통원확인서 제목 유지 + 8FIX 도장overlay(position) 미도입.
 *
 * 실행: npx playwright test --project=unit T-20260630-foot-DOCPRINT-WONBU-SEAL-REMOVE.spec.ts
 * NOTE: 템플릿 const 리터럴 정적검증 + getHtmlTemplate/bindHtmlTemplate 실제 렌더 검증 병행.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/lib/htmlFormTemplates.ts'),
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

/** 실제 stamp-box 도장 element(주석 텍스트 아님) 존재 여부 */
const SEAL_RE = /<div class="stamp-box">원부대조필/;

const TREAT_CONFIRM = extractTemplate('TREAT_CONFIRM_HTML');
const VISIT_CONFIRM = extractTemplate('VISIT_CONFIRM_HTML');
const DIAGNOSIS = extractTemplate('DIAGNOSIS_HTML');
const DIAG_OPINION = extractTemplate('DIAG_OPINION_HTML');

// ── 시나리오 1 AC-1: 진료확인서 원부대조필 삭제 ─────────────────────────────
test.describe('시나리오1 AC-1: 진료확인서 원부대조필 stamp-box 삭제', () => {
  test('TREAT_CONFIRM_HTML 에 원부대조필 stamp-box 없음', () => {
    expect(SEAL_RE.test(TREAT_CONFIRM), '진료확인서 우상단 원부대조필 잔존').toBe(false);
  });

  test('렌더 결과(treat_confirm)에 원부대조필 도장 미출력', () => {
    const html = bindHtmlTemplate(getHtmlTemplate('treat_confirm')!, {});
    expect(SEAL_RE.test(html)).toBe(false);
  });

  test('split 변형(code/nocode) 렌더에도 원부대조필 도장 없음 — 레거시 재사용 동기', () => {
    for (const key of ['treat_confirm_code', 'treat_confirm_nocode']) {
      const html = bindHtmlTemplate(getHtmlTemplate(key)!, {});
      expect(SEAL_RE.test(html), `${key} 도장 잔존`).toBe(false);
    }
  });
});

// ── 시나리오 2 AC-2: 통원확인서 원부대조필 삭제 ─────────────────────────────
test.describe('시나리오2 AC-2: 통원확인서 원부대조필 stamp-box 삭제', () => {
  test('VISIT_CONFIRM_HTML 에 원부대조필 stamp-box 없음', () => {
    expect(SEAL_RE.test(VISIT_CONFIRM), '통원확인서 우상단 원부대조필 잔존').toBe(false);
  });

  test('렌더 결과(visit_confirm)에 원부대조필 도장 미출력', () => {
    const html = bindHtmlTemplate(getHtmlTemplate('visit_confirm')!, {});
    expect(SEAL_RE.test(html)).toBe(false);
  });
});

// ── 시나리오 3 AC-3: 나머지 서류 회귀 없음 ─────────────────────────────────
test.describe('시나리오3 AC-3: 진단서·소견서 원부대조필 유지(회귀 0)', () => {
  test('진단서(DIAGNOSIS_HTML) 원부대조필 stamp-box 유지', () => {
    expect(SEAL_RE.test(DIAGNOSIS), '진단서 도장 회귀 삭제됨').toBe(true);
  });

  test('소견서(DIAG_OPINION_HTML) 원부대조필 stamp-box 유지', () => {
    expect(SEAL_RE.test(DIAG_OPINION), '소견서 도장 회귀 삭제됨').toBe(true);
  });

  test('전체 소스 원부대조필 stamp-box 정확히 2건(진단서·소견서)만 잔존', () => {
    const count = (TEMPLATES_SRC.match(/<div class="stamp-box">원부대조필/g) ?? []).length;
    expect(count, '원부대조필 stamp-box 개수 = 2(진단서·소견서)여야 함').toBe(2);
  });

  test('좌상단 doctor_seal_html(날인) placeholder 무변동 — 별개 표기 미접촉', () => {
    // 본 작업은 우상단 원부대조필만 제거. 좌상단 날인 placeholder는 손대지 않음.
    const count = (TEMPLATES_SRC.match(/\{\{doctor_seal_html\}\}/g) ?? []).length;
    expect(count, 'doctor_seal_html placeholder 감소 — 날인 회귀').toBeGreaterThanOrEqual(11);
  });
});

// ── 시나리오 4 AC-4: 중앙정렬 불변 + 도장overlay 미도입 ─────────────────────
test.describe('시나리오4 AC-4: 제목 중앙정렬·레이아웃 불변', () => {
  test('진료확인서·통원확인서 제목 유지', () => {
    expect(TREAT_CONFIRM).toContain('진 료 확 인 서');
    expect(VISIT_CONFIRM).toContain('통 원 확 인 서');
  });

  test('2종 모두 우측 빈 flex 컨테이너 보존 → 좌우 균형(중앙정렬) 유지', () => {
    // 좌 spacer(flex:1) + 제목 + 우 빈 컨테이너(flex:1) = 3컬럼 균형 구조 유지
    for (const [name, tpl] of [['진료확인서', TREAT_CONFIRM], ['통원확인서', VISIT_CONFIRM]] as const) {
      expect((tpl.match(/flex:1/g) ?? []).length, `${name} flex:1 좌우 spacer 손상`).toBeGreaterThanOrEqual(2);
    }
  });

  test('우하단 도장 overlay(position) 신규 도입 없음 — 8FIX 레이아웃 무변경', () => {
    const lower = TEMPLATES_SRC.toLowerCase();
    expect(lower).not.toContain('position:fixed');
    expect(lower).not.toContain('position:absolute');
  });
});
