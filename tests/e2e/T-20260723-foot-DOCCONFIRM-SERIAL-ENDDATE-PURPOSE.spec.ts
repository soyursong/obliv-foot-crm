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
test.describe('결함④: 레이아웃 (빈 입원행 제거 · 라벨 정합)', () => {
  for (const [name, tpl] of CONFIRM_DOCS) {
    test(`${name} 치료기간 표에 빈 '입원' 행 미노출 + rowspan 해제`, () => {
      const start = tpl.indexOf('치료<br>기간');
      const block = tpl.slice(start, start + 800);
      // 외래만 남고 입원 행 제거
      expect(block, `${name} 빈 입원 행 잔존`).not.toContain('>입원</td>');
      // 치료기간 셀 rowspan 해제(단일행)
      expect(block, `${name} 치료기간 rowspan 미해제`).not.toContain('rowspan="2"');
    });

    test(`${name} '실통원일수 일괄입력' 라벨 → '통원일자'로 정합`, () => {
      expect(tpl, `${name} 구 라벨(실통원일수 일괄입력) 잔존`).not.toContain('실통원일수');
      expect(tpl, `${name} 통원일자 라벨 누락`).toContain('>통원일자</td>');
    });
  }
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

// ── 결함③ 연번호: 본 커밋 미포함 무접촉 가드 (L-006 pending) ──────────────
test.describe('결함③ 가드: 연번호(PMW) 본 커밋 미변경 (L-006 게이트 pending)', () => {
  test('purpose 토큰은 살아있고 연번호(visit_no) 토큰도 템플릿에 보존', () => {
    // 결함②로 purpose 렌더 경로는 유지, 연번호 토큰은 무손상(PMW 발번은 별도 pass)
    for (const [name, tpl] of CONFIRM_DOCS) {
      expect(tpl, `${name} purpose 토큰 소실`).toContain('{{purpose}}');
    }
    expect(TEMPLATES_SRC, 'visit_no 토큰 오삭제').toContain('{{visit_no}}');
  });
});

// ── 회귀 가드: 실제 렌더 4키 ──────────────────────────────────────────────
test.describe('회귀: 실제 렌더 4키(treat_confirm·code·nocode·visit_confirm)', () => {
  test('4키 렌더 정상 + 고아토큰·빈입원행·구라벨 미반영', () => {
    for (const key of ['treat_confirm', 'treat_confirm_code', 'treat_confirm_nocode', 'visit_confirm']) {
      const html = bindHtmlTemplate(getHtmlTemplate(key)!, {});
      // bind 후 placeholder 소진 → discharge_date 잔여 없음(진단서 아님)
      expect(html, `${key} 렌더 실패`).toContain('치료');
      expect(html, `${key} 구 라벨 잔존`).not.toContain('실통원일수');
      expect(html, `${key} 빈 입원 행 잔존`).not.toContain('>입원</td>');
      // purpose 미지정 시 공란 렌더(고아 아님) — placeholder 소진 확인
      expect(html, `${key} purpose placeholder 잔존`).not.toContain('{{purpose}}');
    }
  });

  test('진료확인서 code/nocode 상병 분기 회귀 0 (4결함과 직교)', () => {
    const codeHtml = bindHtmlTemplate(getHtmlTemplate('treat_confirm_code')!, {});
    expect(codeHtml).toContain('상 병 코 드');
    const nocodeHtml = bindHtmlTemplate(getHtmlTemplate('treat_confirm_nocode')!, {});
    expect(nocodeHtml).not.toContain('상 병 코 드');
  });
});
