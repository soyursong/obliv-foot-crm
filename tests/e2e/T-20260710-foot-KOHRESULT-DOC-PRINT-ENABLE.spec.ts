/**
 * E2E spec — T-20260710-foot-KOHRESULT-DOC-PRINT-ENABLE
 * 풋 2번차트 '검사결과' 탭 서류 출력 활성화 + KOH 균검사 서류를 '서류출력 명단'에 추가
 *   (KOHEXAM-FULLFLOW-EXT ⑤ 카브아웃 / 김주연 총괄)
 *
 * ─── 착수 시 규명(dev-foot) ────────────────────────────────────────────────────
 *  본 요청의 상당 부분은 선행 티켓으로 이미 구현되어 있었다(재구현 금지·회귀보호로 전환):
 *   - AC-1(검사결과 탭 출력): KohPublishedResults(발행분 자동표시) → [보기/인쇄] → KohResultDialog
 *     의 [출력] 버튼(printKohResult, 라이브 HTML) 이 旣 존재(KOHTEST-LIFECYCLE-PUBLISH·KOHGEN-HTMLPORT).
 *   - AC-2(서류출력 명단): koh_result 가 旣 DOCLIST_ORDER_10(3번)·DOC_CATEGORY_JEUNGMYEONG_KEYS 에 존재
 *     (DOCLIST-ORDER-10). 단 FALLBACK_TEMPLATES 누락 → SSOT 목록과 폴백 불일치를 본 티켓에서 해소(additive).
 *   - AC-3(라이브 HTML): isHtmlTemplate('koh_result')=true → KOH_RESULT_HTML(HTML) 렌더. 데드 이미지경로 아님.
 *
 *  본 티켓의 실제 코드 변경(잔여 갭):
 *   (1) FALLBACK_TEMPLATES 에 koh_result(html) 추가 → 명단 항목 폴백/프리뷰 정합.
 *   (2) 서류출력 명단(DocumentPrintPanel)에서 koh_result 출력 시, 검사결과 탭과 동일한 발행 field_data
 *       (발톱부위 specimen_type·의뢰번호 request_no·채취일 등)를 바인딩 → 공란(표기 오류) 방지(AC-3).
 *       기존 referral_letter 자동병합 패턴 1:1 재사용(단일 병합 지점, 타 서류 무영향).
 *
 * ─── 검증 방식 ─────────────────────────────────────────────────────────────────
 *  DB(발행 form_submissions)·auth 의존 라이브 동선은 supervisor 갤탭 field-soak 로 확정한다.
 *  본 spec 은 8FIX/DOCCONFIRM 선례와 동형의 순수 검증(소스 정적 가드 + 템플릿 실렌더 바인딩)으로
 *  AC 코드 계약을 결정론적으로 보호한다(auth·server·browser 불요 → unit 프로젝트).
 *
 * 시나리오 1(AC-1): 검사결과 탭 KohPublishedResults → KohResultDialog [출력] 동선 존재.
 * 시나리오 2(AC-2): koh_result 가 명단 3대 SSOT(DOCLIST/CATEGORY/FALLBACK)에 존재 + 명단 발행 field_data 병합.
 * 시나리오 3(AC-3): getHtmlTemplate('koh_result') 라이브 HTML 렌더 + 발행 field_data 바인딩 정확(플레이스홀더 잔존 0).
 * 시나리오 4(AC-4): 기존 8종 + referral_letter 병합 + KOH 발행 쿼리(status=published) 무회귀.
 *
 * 실행: playwright test --project=unit T-20260710-foot-KOHRESULT-DOC-PRINT-ENABLE
 */

// T-20260710-foot-KOHRESULT-DOC-PRINT-ENABLE

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

import { getHtmlTemplate, bindHtmlTemplate, isHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import {
  DOCLIST_ORDER_10,
  DOC_CATEGORY_JEUNGMYEONG_KEYS,
  FALLBACK_TEMPLATES,
  orderDocList,
} from '../../src/lib/formTemplates';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_ROOT = path.join(__dirname, '../../src');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, rel), 'utf-8');
}

const KOH_PUBLISHED_SRC = read('components/KohPublishedResults.tsx');
const KOH_DIALOG_SRC = read('components/KohResultDialog.tsx');
const PRINT_KOH_SRC = read('lib/printKohResult.ts');
const DOC_PANEL_SRC = read('components/DocumentPrintPanel.tsx');
const CHART_PAGE_SRC = read('pages/CustomerChartPage.tsx');

// ─── 시나리오 1 (AC-1): 검사결과 탭에서 출력 ────────────────────────────────────
test.describe('AC-1 검사결과 탭 출력 동선', () => {
  test('검사결과 탭이 KohPublishedResults(발행분 자동표시)를 렌더한다', () => {
    expect(CHART_PAGE_SRC).toMatch(/chartTab === 'test_result'/);
    expect(CHART_PAGE_SRC).toMatch(/<KohPublishedResults/);
    // 업로드 서류(피검사 동형) 보기 동선도 함께 유지.
    expect(CHART_PAGE_SRC).toMatch(/<PatientResultFiles[\s\S]*?kind="koh_result"/);
  });

  test('KohPublishedResults 각 행에 [보기/인쇄] → KohResultDialog 진입점이 있다', () => {
    expect(KOH_PUBLISHED_SRC).toMatch(/data-testid="koh-published-print"/);
    expect(KOH_PUBLISHED_SRC).toMatch(/보기\/인쇄/);
    expect(KOH_PUBLISHED_SRC).toMatch(/<KohResultDialog/);
  });

  test('KohResultDialog [출력] 버튼이 printKohResult(라이브 HTML 인쇄)를 호출한다', () => {
    expect(KOH_DIALOG_SRC).toMatch(/data-testid="koh-dialog-print"/);
    expect(KOH_DIALOG_SRC).toMatch(/printKohResult\(/);
    // 출력 대상 HTML = bindKohResultHtml(발행 field_data) 단일 바인딩 경로.
    expect(KOH_DIALOG_SRC).toMatch(/bindKohResultHtml/);
  });
});

// ─── 시나리오 2 (AC-2): 서류출력 명단에 KOH 추가 ────────────────────────────────
test.describe('AC-2 서류출력 명단 KOH 항목', () => {
  test('koh_result 가 명단 3대 SSOT(DOCLIST/CATEGORY/FALLBACK)에 모두 존재한다', () => {
    expect(DOCLIST_ORDER_10).toContain('koh_result');
    expect(DOC_CATEGORY_JEUNGMYEONG_KEYS).toContain('koh_result');
    const fb = FALLBACK_TEMPLATES.find((t) => t.form_key === 'koh_result');
    expect(fb, 'FALLBACK_TEMPLATES 에 koh_result 존재(폴백/프리뷰 정합)').toBeTruthy();
    // 라이브 HTML 경로 — 데드 이미지 경로(jpg/png) 아님(AC-3).
    expect(fb?.template_format).toBe('html');
    expect(fb?.template_path).toBe('');
    expect(fb?.active).toBe(true);
    expect(fb?.name_ko).toBe('KOH균검사결과지');
  });

  test('명단 정렬(orderDocList)에 koh_result 가 포함·라벨 override 적용된다', () => {
    // FALLBACK 세트를 명단 정렬에 넣으면 koh_result 가 필터를 통과하고 표시라벨이 override 된다.
    const ordered = orderDocList([...FALLBACK_TEMPLATES]);
    const koh = ordered.find((t) => t.form_key === 'koh_result');
    expect(koh, 'orderDocList 결과에 koh_result 존재').toBeTruthy();
    expect((koh as { name_ko?: string }).name_ko).toBe('KOH균검사결과지');
    // 진열 순서: bill_detail(2) 다음, diag_opinion(4) 앞 (DOCLIST index 3).
    const keys = ordered.map((t) => t.form_key);
    expect(keys.indexOf('koh_result')).toBeGreaterThan(keys.indexOf('bill_detail'));
    expect(keys.indexOf('koh_result')).toBeLessThan(keys.indexOf('diag_opinion'));
  });

  test('명단(DocumentPrintPanel) 출력 시 발행 KOH field_data 를 병합한다', () => {
    // referral_letter 병합 패턴과 동형의 단일 병합 지점.
    expect(DOC_PANEL_SRC).toMatch(/loadPublishedKohFieldData/);
    expect(DOC_PANEL_SRC).toMatch(/template\.form_key === 'koh_result'/);
    // 병합은 autobind(vals) 위에 발행 field_data 를 덮어 specimen 등 공란을 채운다.
    expect(DOC_PANEL_SRC).toMatch(/\{ \.\.\.vals, \.\.\.kohStr \}/);
  });
});

// ─── 시나리오 3 (AC-3): 라이브 HTML 렌더 + 정확 바인딩 ─────────────────────────
test.describe('AC-3 라이브 HTML 렌더·정확 바인딩', () => {
  test('isHtmlTemplate(koh_result)=true, getHtmlTemplate 가 비어있지 않은 HTML 을 반환', () => {
    expect(isHtmlTemplate('koh_result')).toBe(true);
    const tpl = getHtmlTemplate('koh_result');
    expect(tpl && tpl.length).toBeTruthy();
    expect(tpl).toMatch(/koh-report-sheet/); // 스코프 루트 존재(라이브 렌더 타겟)
    expect(tpl).toMatch(/검사결과 보고서/);
  });

  test('발행 field_data 바인딩 시 발톱부위·의뢰번호가 정확 렌더되고 플레이스홀더 잔존이 없다', () => {
    const tpl = getHtmlTemplate('koh_result')!;
    const bound = bindHtmlTemplate(tpl, {
      patient_name: '홍길동',
      chart_number: 'A-1024',
      birth_date: '1990년 01월 02일',
      specimen_type: 'Rt 무지(1지)',
      collected_date: '2026.07.10',
      requested_date: '2026.07.10',
      request_no: 'KOH-20260710-001',
      specimen_no: '001',
      remark: '',
    });
    expect(bound).toContain('홍길동');
    expect(bound).toContain('Rt 무지(1지)');
    expect(bound).toContain('KOH-20260710-001');
    // 알려진 KOH 플레이스홀더가 렌더 후 남아있지 않음(표기 오류 방지).
    for (const key of ['patient_name', 'specimen_type', 'request_no', 'collected_date', 'chart_number']) {
      expect(bound).not.toContain(`{{${key}}}`);
    }
  });

  test('loadPublishedKohFieldData 는 KohPublishedResults 와 동일 쿼리 계약(published)을 쓴다', () => {
    expect(PRINT_KOH_SRC).toMatch(/loadPublishedKohFieldData/);
    expect(PRINT_KOH_SRC).toMatch(/form_key', 'koh_result'/);
    expect(PRINT_KOH_SRC).toMatch(/status', 'published'/);
    // 이 방문(check_in) 발행분 우선 → 없으면 고객 최신분.
    expect(PRINT_KOH_SRC).toMatch(/check_in_id === checkInId/);
    // 미적용(템플릿 부재)/미발행 → null 폴백(무파손).
    expect(PRINT_KOH_SRC).toMatch(/if \(!tpl\?\.id\) return null/);
  });
});

// ─── 시나리오 4 (AC-4): 무회귀 ─────────────────────────────────────────────────
test.describe('AC-4 무회귀', () => {
  test('기존 서류출력 명단 SSOT(핵심 8+종)가 보존된다', () => {
    for (const key of [
      'bill_receipt',
      'bill_detail',
      'diag_opinion',
      'diagnosis',
      'treat_confirm_code',
      'treat_confirm_nocode',
      'referral_letter',
      'visit_confirm',
      'medical_record_request',
      'rx_standard',
      // T-20260719-foot-LEGACYRENDER-FIXTURE-DBISO: bill_receipt_new(진료비 계산서·영수증 신양식) 가산 핀 고정
      //   — 후속 blessed 티켓(T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN, e0a5218c+105b1be2)이 additive 등록.
      'bill_receipt_new',
    ]) {
      expect(DOCLIST_ORDER_10, `${key} 보존`).toContain(key);
    }
    // KOH·신양식 추가가 진열 순서 SSOT 를 어긋내지 않음(총 12 키 = 10 핵심 + koh_result + bill_receipt_new).
    //   T-20260719-foot-LEGACYRENDER-FIXTURE-DBISO: 구 기대 11 → 12(bill_receipt_new 가산, DOCFEE-BODYCENTER blessed).
    //   ★spec 만 — DOCLIST_ORDER_10 SSOT(formTemplates) 무접촉(AC4). 핵심 10종 전건 보존 확인됨(위 loop).
    expect(DOCLIST_ORDER_10.length).toBe(12);
  });

  test('referral_letter 자동병합 분기가 그대로 유지된다(병합 지점 재사용, 훼손 아님)', () => {
    expect(DOC_PANEL_SRC).toMatch(/template\.form_key === 'referral_letter'/);
    expect(DOC_PANEL_SRC).toMatch(/loadReferralAutoFields/);
    // else-if 로 koh 병합을 추가 → referral 분기가 koh 보다 먼저 평가(상호 배타).
    const refIdx = DOC_PANEL_SRC.indexOf("template.form_key === 'referral_letter'");
    const kohIdx = DOC_PANEL_SRC.indexOf("template.form_key === 'koh_result' && checkIn.customer_id");
    expect(refIdx).toBeGreaterThan(-1);
    expect(kohIdx).toBeGreaterThan(refIdx);
  });

  test('KOH 발행 인쇄 경로(printKohResult)와 결과지 sheet id 가 보존된다', () => {
    expect(PRINT_KOH_SRC).toMatch(/export function printKohResult/);
    expect(PRINT_KOH_SRC).toMatch(/export const KOH_SHEET_ID = 'koh-report-sheet'/);
    expect(PRINT_KOH_SRC).toMatch(/export function bindKohResultHtml/);
  });
});
