/**
 * E2E Spec — T-20260721-foot-DOCREPRINT-OPINION-EDIT-NOSYNC
 *
 * 서류 재출력 UX — A안 확정 구현 (김주연 총괄 2026-07-21, confirm ts 1784624370.308559).
 *
 * ── 현장 확정 (A안) ──
 *   재출력 = 발행 고정본 그대로(의료법§22 append-only 정합). 이미 한번 발행/출력된 서류를 서류 출력
 *   화면에서 재클릭하면 '수정 팝업'(IssueDialog 편집 폼)을 열지 않고 재출력(발행 고정본 스냅샷)만 직행.
 *   현재 버그: 이미 출력된 서류 클릭(상세 발행) 시 편집 팝업이 떠 현장 혼란(미발행 편집 유발).
 *
 * ── 구현 판정 (dev-foot) ──
 *   • 버그 팝업 = DocumentPrintPanel 의 IssueDialog("… 발행" 편집 폼). "상세 발행 →"로 진입하는 무게이트
 *     서류(처방전·영수증 등) 경로 — 데스크(실장) surface. 소견서·진단서(게이트)는 gate.onPrint 직행이라
 *     팝업 자체가 없음(무영향).
 *   • §11 medical_confirm_gate: 수정 지점이 DocumentPrintPanel(데스크·비의료 surface)이며 OpinionDocTab
 *     (진료관리 의사영역) 미접촉 → 게이트 비대상.
 *   • 기법: 저장된 최신 발행본 field_data 스냅샷을 그대로 렌더(printFormFromSnapshot). 신규 INSERT·재산정
 *     없음 = "찍은 그대로" 재출력. 현장의 '이미지 저장' 제안은 기존 snapshot-persist 아키텍처로 충족되어
 *     이미지 저장 신설 불요(append-only/DOCREPRINT-DOCTOR-CONTENT-PERSIST 정합).
 *
 * ── AC 매핑 ──
 *   AC-1: 이미 발행/출력된 서류 재클릭 → 수정 팝업 없이 재출력 직행    → 시나리오 A
 *   AC-2: 재출력물 = 발행 고정본(최신 published/printed 스냅샷)        → 시나리오 B
 *   AC-3: 회귀0 — 미발행 서류 신규 발행(상세 발행) 동선 유지 + 게이트   → 시나리오 C
 *   AC-4: 의료화면 미접촉(§11 게이트 비대상)                          → 시나리오 D
 *
 * 실행: npx playwright test T-20260721-foot-DOCREPRINT-OPINION-EDIT-NOSYNC.spec.ts
 * NOTE: 정적 렌더/계약 검증 방식(프로젝트 컨벤션 — 실서버 불필요).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const PANEL_SRC = readFileSync(
  join(process.cwd(), 'src/components/DocumentPrintPanel.tsx'),
  'utf8',
);
const OPINIONTAB_SRC = readFileSync(
  join(process.cwd(), 'src/components/doctor/OpinionDocTab.tsx'),
  'utf8',
);

// ───────────────────────────────────────────────────────────────
test.describe('AC-1 — 이미 발행/출력된 서류 재클릭 시 편집 팝업 없이 재출력 직행', () => {
  test('무게이트 서류가 이미 발행됨(submissionCount>0) → 우측 액션이 [재출력]로 전환', () => {
    // hasIssued = submissionCount > 0 && onReprint 존재 → 재출력 분기.
    expect(PANEL_SRC).toContain('const hasIssued = submissionCount > 0 && !!onReprint;');
    // 재출력 버튼(편집 팝업 미진입) — data-testid + 라벨.
    expect(PANEL_SRC).toContain('docprint-reprint-${tpl.form_key}');
    expect(PANEL_SRC).toContain('재출력 →');
    // 재출력 버튼 클릭 = onReprint (IssueDialog=onCardClick 아님).
    const reprintBtn = PANEL_SRC.slice(
      PANEL_SRC.indexOf('hasIssued ? ('),
      PANEL_SRC.indexOf('상세 발행 버튼 (행 우측)'),
    );
    expect(reprintBtn).toContain('onReprint?.(tpl)');
    expect(reprintBtn).not.toContain('onCardClick(tpl)');
  });

  test('handleReprintSnapshot = 최신 발행본 스냅샷 직행(IssueDialog 미오픈)', () => {
    const fn = PANEL_SRC.slice(
      PANEL_SRC.indexOf('const handleReprintSnapshot'),
      PANEL_SRC.indexOf('[submissions, checkIn.customer_name],'),
    );
    // 편집 팝업(setIssueDialogOpen) 대신 스냅샷 렌더.
    expect(fn).toContain('printFormFromSnapshot(');
    expect(fn).not.toContain('setIssueDialogOpen(true)');
    // 최신 non-voided 발행 이력 선택.
    expect(fn).toContain("s.status !== 'voided'");
    // onReprint 프롭이 TemplateSection 에 배선됨.
    expect(PANEL_SRC).toContain('onReprint={handleReprintSnapshot}');
  });
});

// ───────────────────────────────────────────────────────────────
test.describe('AC-2 — 재출력물 = 발행 고정본(저장 스냅샷 그대로, 재산정·신규 INSERT 없음)', () => {
  test('printFormFromSnapshot: 저장된 field_data 를 그대로 렌더(신규 발번/INSERT 없음)', () => {
    const fn = PANEL_SRC.slice(
      PANEL_SRC.indexOf('function printFormFromSnapshot'),
      PANEL_SRC.indexOf('// ─── 메인 컴포넌트 ───'),
    );
    // 순수 렌더 — DB write/RPC 없음(발행 고정본 불변).
    expect(fn).not.toContain('supabase');
    expect(fn).not.toContain('.insert(');
    expect(fn).not.toContain('.rpc(');
    // 단건 발행 경로와 동일 렌더 SSOT(buildHtmlPageHtml/buildPageHtml) 재사용.
    expect(fn).toContain('buildHtmlPageHtml(');
    expect(fn).toContain('buildPageHtml(');
    // rx 2장(약국/환자 보관용) 규칙 보존.
    expect(fn).toContain("template.form_key === 'rx_standard'");
    expect(fn).toContain('약국보관용');
    expect(fn).toContain('환자보관용');
  });

  test('handleReprintSnapshot 은 발행 이력의 field_data 스냅샷을 렌더 인자로 사용', () => {
    const fn = PANEL_SRC.slice(
      PANEL_SRC.indexOf('const handleReprintSnapshot'),
      PANEL_SRC.indexOf('[submissions, checkIn.customer_name],'),
    );
    expect(fn).toContain('latest.field_data');
  });

  test('저장 스냅샷 field_data 가 발행본과 동일 토큰으로 렌더됨(bindHtmlTemplate 정합)', () => {
    // 발행 시점 저장된 스냅샷(field_data)을 그대로 다시 바인딩하면 동일 출력이 나온다.
    const tpl = getHtmlTemplate('rx_standard');
    expect(tpl).toBeTruthy();
    const snapshot: Record<string, string> = {
      patient_name: '총괄테스트3',
      issue_no: '20260718 제 000025 호',
      doctor_name: '문지은',
    };
    const first = bindHtmlTemplate(tpl!, snapshot);
    const reprint = bindHtmlTemplate(tpl!, snapshot); // 동일 스냅샷 → 동일 결과(고정본).
    expect(reprint).toBe(first);
    expect(reprint).toContain('총괄테스트3');
  });
});

// ───────────────────────────────────────────────────────────────
test.describe('AC-3 — 회귀0: 미발행 신규 발행 동선 + 게이트(소견서·진단서) 보존', () => {
  test('미발행(submissionCount=0) 서류는 [상세 발행](IssueDialog=신규 발행) 유지', () => {
    expect(PANEL_SRC).toContain('docprint-detail-issue-${tpl.form_key}');
    expect(PANEL_SRC).toContain('상세 발행 →');
    // 미발행 분기는 onCardClick(=편집/발행 팝업) 진입.
    const detailBtn = PANEL_SRC.slice(
      PANEL_SRC.indexOf('상세 발행 버튼 (행 우측)'),
      PANEL_SRC.indexOf('docprint-detail-issue-${tpl.form_key}') + 60,
    );
    expect(detailBtn).toContain('onCardClick(tpl)');
  });

  test('게이트 서류(소견서·진단서)는 gate.onPrint 직행 — 재출력 분기 미접촉', () => {
    // 재출력 분기는 무게이트(else) 안에서만 존재. 게이트 행은 gate.onPrint 그대로.
    expect(PANEL_SRC).toContain('if (gate.authored) gate.onPrint();');
    // hasIssued 분기는 isGated=false(무게이트) 컨텍스트에서만 평가됨(구조 보존).
    const gatedElse = PANEL_SRC.indexOf(') : hasIssued ? (');
    const gateBranch = PANEL_SRC.indexOf('원장 작성 완료 · 출력');
    expect(gatedElse).toBeGreaterThan(gateBranch); // 재출력 분기는 게이트 분기 뒤(무게이트 else).
  });

  test('printJpg(단건 발행 인쇄)도 동일 렌더 SSOT(printFormFromSnapshot) 공유 — divergence 방지', () => {
    const fn = PANEL_SRC.slice(
      PANEL_SRC.indexOf('const printJpg = useCallback'),
      PANEL_SRC.indexOf('const printPdf = useCallback'),
    );
    expect(fn).toContain('printFormFromSnapshot(template, values, checkIn.customer_name');
  });
});

// ───────────────────────────────────────────────────────────────
test.describe('AC-4 — §11 medical_confirm_gate 비대상(의료화면 미접촉)', () => {
  test('OpinionDocTab(진료관리 의사영역) 미변경 — 발행/불변/출력 로직 무접촉', () => {
    // 본 티켓 변경은 DocumentPrintPanel(데스크) 한정. OpinionDocTab 에 본 티켓 마커가 없어야 함.
    expect(OPINIONTAB_SRC).not.toContain('DOCREPRINT-OPINION-EDIT-NOSYNC');
    // 발행 append-only(신규 발행=정정) 동선 보존 확인.
    expect(OPINIONTAB_SRC).toContain('publish_opinion_doc');
  });

  test('pdf 양식/스냅샷 부재 시 기존 발행 다이얼로그로 폴백(무회귀)', () => {
    const fn = PANEL_SRC.slice(
      PANEL_SRC.indexOf('const handleReprintSnapshot'),
      PANEL_SRC.indexOf('[submissions, checkIn.customer_name],'),
    );
    expect(fn).toContain("tpl.template_format === 'pdf'");
    expect(fn).toContain('handleSelectTemplate(tpl)'); // 폴백 = 기존 팝업.
  });
});
