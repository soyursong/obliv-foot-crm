/**
 * E2E Spec — T-20260723-foot-DOCCONFIRM-SERIAL-ENDDATE-PURPOSE
 *
 * [P1] 진료확인서(treat_confirm_code/nocode)·통원확인서(visit_confirm) 4결함 수정.
 *      현장 보고: 이은상 팀장(풋센터), 2026-07-23.
 *
 * 착수 그룹 A (L-006 무관, 본 커밋 대상):
 *   ① 치료기간 '까지' 공란 — htmlFormTemplates.ts 진료확인서 고아토큰 {{discharge_date}}(미바인딩)
 *      → {{visit_date}} 교체(단일방문 부터=까지). ★진단서 '퇴원일' {{discharge_date}}(별도 블록)은 무접촉.
 *   ② 용도 선택 발급동선 승격 — 기존 [수정] 팝업(DocFormSettingsDialog)에만 있던 용도 칩(3종)+자유입력을
 *      주 발급 폼(DocumentPrintPanel IssueDialog)에 노출 → 바로 출력해도 {{purpose}} 공란 방지.
 *   ④ 레이아웃 — 외래전용 확인서의 상시 빈 '입원' 행 제거(rowspan 해제) + '실통원일수 일괄입력' 라벨↔값
 *      정합('통원일자'로 정정).
 *
 * 착수 그룹 B (L-006 게이트 pending → 본 커밋 제외):
 *   ③ 연번호 공란(PaymentMiniWindow 발번 미배선) — 김주연 총괄 현장승인 + DOC-PRINT-UNIFY 56종 regression
 *      + codex 게이트 후 별도 PMW pass. 본 스펙 미포함(무접촉 가드만).
 *
 * 실행: npx playwright test --project=unit T-20260723-foot-DOCCONFIRM-SERIAL-ENDDATE-PURPOSE.spec.ts
 * NOTE: 템플릿 리터럴 정적검증 + getHtmlTemplate/bindHtmlTemplate 실제 렌더 검증 병행.
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
const PANEL_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/components/DocumentPrintPanel.tsx'),
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

const TREAT_CONFIRM = extractTemplate('TREAT_CONFIRM_HTML');
const VISIT_CONFIRM = extractTemplate('VISIT_CONFIRM_HTML');

const CONFIRM_DOCS = [
  ['진료확인서', TREAT_CONFIRM] as const,
  ['통원확인서', VISIT_CONFIRM] as const,
];

// ── 결함① 치료기간 '까지' ────────────────────────────────────────────────
test.describe('결함①: 치료기간 부터=까지 (고아토큰 제거)', () => {
  test('진료확인서 치료기간 행에 discharge_date 고아토큰 미존재 (부터=까지 모두 visit_date)', () => {
    // 치료기간 블록만 국소 검사(향후 치료기간 블록 등과 혼동 방지)
    const start = TREAT_CONFIRM.indexOf('치료<br>기간');
    expect(start, '진료확인서 치료기간 블록 미발견').toBeGreaterThanOrEqual(0);
    const block = TREAT_CONFIRM.slice(start, start + 700);
    expect(block, '치료기간 까지에 고아토큰 discharge_date 잔존').not.toContain('{{discharge_date}}');
    // 부터·까지 두 칸 모두 {{visit_date}} (단일방문 관례)
    const visitDateCount = (block.match(/\{\{visit_date\}\}/g) ?? []).length;
    expect(visitDateCount, '치료기간 부터/까지 visit_date 2칸 미충족').toBeGreaterThanOrEqual(2);
  });

  test('통원확인서 치료기간 회귀 0 (기존 부터=까지 visit_date 유지)', () => {
    const start = VISIT_CONFIRM.indexOf('치료<br>기간');
    const block = VISIT_CONFIRM.slice(start, start + 700);
    expect(block).not.toContain('{{discharge_date}}');
    const visitDateCount = (block.match(/\{\{visit_date\}\}/g) ?? []).length;
    expect(visitDateCount).toBeGreaterThanOrEqual(2);
  });

  test('★진단서 계열 퇴원일 {{discharge_date}}는 보존 (오직 384만 교체, replace_all 금지 가드)', () => {
    // htmlFormTemplates 전체에 discharge_date 는 진단서 '퇴원일' 블록에서 최소 1회 유지되어야 함
    expect(TEMPLATES_SRC, '진단서 퇴원일 discharge_date 오삭제').toContain('{{discharge_date}}');
    // 단, 입원일과 짝을 이루는 진단서 블록 컨텍스트에서 존재
    expect(TEMPLATES_SRC).toContain('{{admission_date}}');
  });
});

// ── 결함④ 레이아웃 ────────────────────────────────────────────────────────
// ★SUPERSEDED (2026-07-31) → 현행 정본으로 재정합 [T-20260802-foot-UNIT-PREEXIST-RED5-TRIAGE]
//   본 describe 의 원 결함④ 기대값(빈 입원행 제거 · 치료기간 rowspan 해제 · 실통원일수→통원일자)은
//   후행 법무팀/총괄 확정 결정으로 명시적으로 번복됨. stale-spec 판정 → 임의완화가 아니라
//   현행 정본(법무팀 2026-07-31 확정) 회귀 가드로 정정. 근거(git 검증):
//     • 입원 행 + 치료기간 rowspan="2" 복원 ← T-20260731-foot-DOCFORM-URGENT-6FIX
//       (커밋 3949940f, 법무팀·이은상 팀장 확정 "입원 행 복원, 값 영구공란").
//       bd4b0088(본 결함④ 최초구현) 제거분을 원본 8셀로 되돌림.
//     • 통원확인서 라벨 통원일자→실통원일수 복원 ← T-20260731-foot-DOCFORM-SEALFALLBACK-VISITDAYS-ALIGN-2ND
//       (커밋 fa527027, A5⑦ deploy-ready·supervisor QA GO 2026-08-02, 실 내원건수 산출).
//   ①discharge_date→visit_date 교체(결함①)는 URGENT-6FIX A2 로 유지됨 → 결함① 테스트 불변.
test.describe('결함④(SUPERSEDED→현행정본): 레이아웃 (입원행·rowspan·라벨 = 법무팀 2026-07-31 확정)', () => {
  for (const [name, tpl] of CONFIRM_DOCS) {
    test(`${name} 치료기간 표 입원 행 + rowspan="2" 존재 (URGENT-6FIX 복원)`, () => {
      const start = tpl.indexOf('치료<br>기간');
      expect(start, `${name} 치료기간 블록 미발견`).toBeGreaterThanOrEqual(0);
      const block = tpl.slice(start, start + 800);
      // 법무팀 확정: 외래+입원 2행 유지(입원 값 영구공란) — '빈 입원행 제거' 결정은 번복됨
      expect(block, `${name} 입원 행 누락(URGENT-6FIX 복원 후 상시 존재)`).toContain('>입원</td>');
      // 치료기간 셀 rowspan="2"(외래·입원 2행 세로중앙) 복원 — rowspan 속성은 셀 여는 태그(텍스트 이전)에 위치
      expect(
        /rowspan="2"[^>]*>치료<br>기간/.test(tpl),
        `${name} 치료기간 셀 rowspan="2" 누락(URGENT-6FIX 복원)`,
      ).toBe(true);
    });
  }

  test('진료확인서 통원일자 라벨 유지 (TREAT_CONFIRM 은 실통원일수 미도입)', () => {
    expect(TREAT_CONFIRM, '진료확인서 통원일자 라벨 누락').toContain('>통원일자</td>');
  });

  test('통원확인서 실통원일수 라벨 (SEALFALLBACK A5⑦ 복원 — 통원일자 라벨 번복)', () => {
    expect(VISIT_CONFIRM, '통원확인서 실통원일수 라벨 누락').toContain('>실통원일수</td>');
  });
});

// ── 결함② 용도 선택 발급동선 승격 ─────────────────────────────────────────
test.describe('결함②: 용도 선택 주 발급 동선 노출', () => {
  test('DocumentPrintPanel 이 DOC_PURPOSE_OPTIONS 를 import + 발급폼 용도 picker 노출', () => {
    expect(PANEL_SRC, 'DOC_PURPOSE_OPTIONS import 누락').toContain('DOC_PURPOSE_OPTIONS');
    // 확인서 form_key 조건부 용도 블록
    expect(PANEL_SRC).toContain("'treat_confirm_code', 'treat_confirm_nocode', 'treat_confirm', 'visit_confirm'");
    expect(PANEL_SRC).toContain("data-testid={`docprint-purpose-${opt}`}");
    expect(PANEL_SRC).toContain("updateField('purpose', opt)");
    expect(PANEL_SRC).toContain('docprint-purpose-input');
  });

  test('★향후치료의견(treatment_opinion) 재노출 금지 (총괄 VISITCERT-DISEASE-FUTURETX-HIDE 존중)', () => {
    // 발급폼 용도 블록은 purpose 만 다룸 — treatment_opinion 필드를 편집동선에 신규 노출하지 않음
    for (const [name, tpl] of CONFIRM_DOCS) {
      expect(tpl, `${name} 향후치료의견 재노출`).not.toContain('{{treatment_opinion}}');
    }
  });
});

// ── 결함③ 연번호: 템플릿 토큰 보존 가드 (PMW 발번 배선은 NIGHTHOLIDAY-PMW-UNWIRED spec 소유) ──
// NOTE: 결함③(PMW 발번)은 후속 단일 PMW pass(T-20260723-foot-NIGHTHOLIDAY-PMW-UNWIRED, L-006 CLOSED)에서 구현됨.
//   본 describe 는 그 배선이 의존하는 템플릿 토큰({{visit_no}}/{{purpose}})의 무손상만 회귀-가드한다.
test.describe('결함③ 가드: 연번호/용도 템플릿 토큰 보존 (PMW 배선의 렌더 계약)', () => {
  test('purpose 토큰은 살아있고 연번호(visit_no) 토큰도 템플릿에 보존', () => {
    // 결함②로 purpose 렌더 경로는 유지, 연번호 토큰은 무손상(PMW 발번이 이 토큰에 merge)
    for (const [name, tpl] of CONFIRM_DOCS) {
      expect(tpl, `${name} purpose 토큰 소실`).toContain('{{purpose}}');
    }
    expect(TEMPLATES_SRC, 'visit_no 토큰 오삭제').toContain('{{visit_no}}');
  });
});

// ── 회귀 가드: 실제 렌더 4키 ──────────────────────────────────────────────
test.describe('회귀: 실제 렌더 4키(treat_confirm·code·nocode·visit_confirm)', () => {
  // ★SUPERSEDED (2026-07-31) → 현행 정본 반영 [T-20260802-foot-UNIT-PREEXIST-RED5-TRIAGE]
  //   원 회귀 기대값(빈입원행 미노출·실통원일수 미반영)은 결함④와 동일하게 URGENT-6FIX/SEALFALLBACK 로 번복됨.
  //   현행 정본 = 확인서 입원 행 상시 존재 + 통원확인서 실통원일수 라벨. 결함②(purpose 소진)는 불변 유지.
  test('4키 렌더 정상 + purpose 소진 + 현행 정본 레이아웃(입원행·실통원일수 복원 반영)', () => {
    for (const key of ['treat_confirm', 'treat_confirm_code', 'treat_confirm_nocode', 'visit_confirm']) {
      const html = bindHtmlTemplate(getHtmlTemplate(key)!, {});
      expect(html, `${key} 렌더 실패`).toContain('치료');
      // 결함② 유지: purpose 미지정 시 placeholder 소진(공란 렌더, 고아 아님)
      expect(html, `${key} purpose placeholder 잔존`).not.toContain('{{purpose}}');
      // URGENT-6FIX 복원: 확인서 입원 행 상시 존재(값 공란)
      expect(html, `${key} 입원 행 누락(법무팀 복원 후 상시 존재)`).toContain('>입원</td>');
    }
    // SEALFALLBACK A5⑦ 복원: 통원확인서 실통원일수 라벨(진료확인서는 통원일자 유지)
    const visitHtml = bindHtmlTemplate(getHtmlTemplate('visit_confirm')!, {});
    expect(visitHtml, '통원확인서 실통원일수 라벨 누락').toContain('실통원일수');
    const treatHtml = bindHtmlTemplate(getHtmlTemplate('treat_confirm')!, {});
    expect(treatHtml, '진료확인서 통원일자 라벨 누락').toContain('통원일자');
  });

  test('진료확인서 code/nocode 상병 분기 회귀 0 (4결함과 직교)', () => {
    const codeHtml = bindHtmlTemplate(getHtmlTemplate('treat_confirm_code')!, {});
    expect(codeHtml).toContain('상 병 코 드');
    const nocodeHtml = bindHtmlTemplate(getHtmlTemplate('treat_confirm_nocode')!, {});
    expect(nocodeHtml).not.toContain('상 병 코 드');
  });
});
