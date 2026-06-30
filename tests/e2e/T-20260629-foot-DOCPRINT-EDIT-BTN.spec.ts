/**
 * E2E Spec — T-20260629-foot-DOCPRINT-EDIT-BTN
 *
 * 서류 [출력] 옆 [수정] 버튼 + 용도·세부내용 편집 (DOCFORM-POPUP-OVERHAUL §2#4 canonical 인스턴스)
 *
 * DECISION (A) GRANTED: 재사용 가능한 공통 컴포넌트(DocFormSettingsDialog)로 §2#4 최초 인스턴스 구축.
 * 편집필드 3종 한정 = 용도(purpose) / 발행일(issue_date) / 비고(remarks).
 *
 * ── AC 매핑 ──
 * AC1. [출력=인쇄] 버튼 우측에 [수정] 버튼 노출        → 시나리오1-3
 * AC2. [수정] → 공통 '서류 설정/편집 팝업' 오픈(재사용) → 시나리오1-4 (컴포넌트 단일 소스)
 * AC3. 편집 항목(용도+세부내용)이 출력 바인딩(field_data JSON)에 반영 → 시나리오1-5/6
 * AC4. published 불변(의료법§22) — 편집·재발행 = 신규 행 INSERT, 기존 published 불변 → 시나리오2
 * AC5. 기존 출력경로 회귀 0(L-006) — 미편집 필드 무파괴(빈값 미오버라이드) → 회귀
 *
 * 실행: npx playwright test T-20260629-foot-DOCPRINT-EDIT-BTN.spec.ts
 * NOTE: 정적 렌더/계약 검증 방식(프로젝트 컨벤션 — 실서버 불필요).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';
import { DOC_PURPOSE_OPTIONS } from '../../src/components/DocFormSettingsDialog';
import { isGatedMedDoc, GATED_MEDDOC_FORM_KEYS } from '../../src/lib/medDocPrintGate';

// allValues 최종 오버라이드 로직 재현 — 빈 키는 덮지 않음(미편집 필드 무파괴, AC5).
function applyEditOverrides(
  base: Record<string, string>,
  overrides: Record<string, string>,
): Record<string, string> {
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

// ─── 공통 베이스 바인딩 값 ───
const BASE_VALUES: Record<string, string> = {
  patient_name: '홍길동',
  visit_date: '2026-06-29',
  issue_date: '2026-06-29',
  doctor_name: '김의사',
  purpose: '',
  remarks: '',
  remark: '',
};

// ───────────────────────────────────────────────────────────────
test.describe('AC2 — 공통 컴포넌트(재사용 base) 단일 소스', () => {
  test('DocFormSettingsDialog가 단일 파일로 존재(중복 에디터 신설 금지)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/DocFormSettingsDialog.tsx'),
      'utf8',
    );
    // 재사용 가능한 공통 컴포넌트 export.
    expect(src).toContain('export function DocFormSettingsDialog');
    // 편집필드 3종 한정 — testid 존재.
    expect(src).toContain('docform-purpose-input');
    expect(src).toContain('docform-issue-date-input');
    expect(src).toContain('docform-remarks-input');
  });

  test('용도 후보값 3종 = 보험청구용/개인보관용/진료의뢰용', () => {
    expect(DOC_PURPOSE_OPTIONS).toEqual(['보험청구용', '개인보관용', '진료의뢰용']);
  });

  test('IssueDialog 푸터에 [수정] 진입점 + 팝업 배선', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/DocumentPrintPanel.tsx'),
      'utf8',
    );
    expect(src).toContain('docprint-edit-btn');           // AC1 진입점
    expect(src).toContain('<DocFormSettingsDialog');        // AC2 공통 팝업 재사용
    expect(src).toContain('editOverrides');                 // AC3 출력 바인딩 반영
  });
});

// ───────────────────────────────────────────────────────────────
test.describe('AC3 / 시나리오1 — 편집값이 출력에 반영', () => {
  test('용도(purpose) 편집 → 진료확인서 출력 렌더에 반영', () => {
    const overrides = { purpose: '보험청구용', issue_date: '', remarks: '' };
    const values = applyEditOverrides(BASE_VALUES, overrides);
    const tpl = getHtmlTemplate('treat_confirm');
    expect(tpl).not.toBeNull();
    const html = bindHtmlTemplate(tpl as string, values);
    expect(html).toContain('보험청구용');
  });

  test('발행일(issue_date) 편집 → 출력 렌더에 반영', () => {
    const overrides = { purpose: '', issue_date: '2026-07-01', remarks: '' };
    const values = applyEditOverrides(BASE_VALUES, overrides);
    const tpl = getHtmlTemplate('visit_confirm');
    expect(tpl).not.toBeNull();
    const html = bindHtmlTemplate(tpl as string, values);
    expect(html).toContain('2026-07-01');
  });

  test('비고(remarks) 편집 → 출력 렌더에 반영 (remarks/remark 동시 — onApplied 계약)', () => {
    const edited = { purpose: '', issue_date: '', remarks: '본인 직접 수령' };
    // onApplied: 일부 양식은 {{remark}}(단수) 사용 → remarks/remark 동시 오버라이드.
    const overrides = { ...edited, remark: edited.remarks };
    const values = applyEditOverrides(BASE_VALUES, overrides);
    // {{remark}} 플레이스홀더 실양식(KOH 검사결과지)에 바인딩 반영 확인.
    const tpl = getHtmlTemplate('koh_result');
    expect(tpl).not.toBeNull();
    const html = bindHtmlTemplate(tpl as string, values);
    expect(html).toContain('본인 직접 수령');
    // {{remarks}}(복수) 플레이스홀더 보유 양식도 동일 바인딩(소견서 v2).
    const tpl2 = getHtmlTemplate('diag_opinion_v2');
    const html2 = bindHtmlTemplate(tpl2 as string, values);
    expect(html2).toContain('본인 직접 수령');
  });
});

// ───────────────────────────────────────────────────────────────
test.describe('AC5 — 미편집 필드 무파괴(회귀 0)', () => {
  test('빈값 편집 시 기존 바인딩값 보존(오버라이드 미적용)', () => {
    const overrides = { purpose: '개인보관용', issue_date: '', remarks: '' };
    const values = applyEditOverrides(BASE_VALUES, overrides);
    // purpose 만 바뀌고 issue_date/doctor_name 등 기존값 보존.
    expect(values.purpose).toBe('개인보관용');
    expect(values.issue_date).toBe('2026-06-29'); // 빈값 오버라이드 미적용 → 기존 보존
    expect(values.doctor_name).toBe('김의사');
  });
});

// ───────────────────────────────────────────────────────────────
test.describe('AC4 / 시나리오2 — published 불변(의료법§22)', () => {
  test('저장 경로는 INSERT(status=draft) 전용 — published UPDATE 미사용', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/DocFormSettingsDialog.tsx'),
      'utf8',
    );
    // 신규 행 INSERT.
    expect(src).toContain(".from('form_submissions')");
    expect(src).toContain('.insert(');
    expect(src).toContain("status: 'draft'");
    // published 행 UPDATE/DELETE 금지(불변 트리거 보존).
    expect(src).not.toContain('.update(');
    expect(src).not.toContain('.delete(');
  });

  test('편집값은 form_submissions.field_data(JSON) — NO-DDL(신규 컬럼 0)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/DocFormSettingsDialog.tsx'),
      'utf8',
    );
    expect(src).toContain('field_data: fieldData');
  });
});

// ───────────────────────────────────────────────────────────────
test.describe('직원 scope — 소견서·진단서 EXCLUDE(원장 전용)', () => {
  test('게이트 서류는 편집 차단 가드 보유', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/DocFormSettingsDialog.tsx'),
      'utf8',
    );
    expect(src).toContain('isGatedMedDoc');
    // 소견서·진단서가 게이트 대상.
    expect(GATED_MEDDOC_FORM_KEYS).toEqual(['diag_opinion', 'diagnosis']);
    expect(isGatedMedDoc('diag_opinion')).toBe(true);
    expect(isGatedMedDoc('diagnosis')).toBe(true);
    expect(isGatedMedDoc('treat_confirm')).toBe(false);
  });
});
