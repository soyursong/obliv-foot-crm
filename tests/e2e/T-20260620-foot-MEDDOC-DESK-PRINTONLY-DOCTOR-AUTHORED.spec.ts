/**
 * E2E spec — T-20260620-foot-MEDDOC-DESK-PRINTONLY-DOCTOR-AUTHORED (B안 확정)
 *
 * 소견서·진단서 = 원장 작성(opinion_doc 발행본) 기반, 데스크는 출력만.
 *   - 작성(authoring) = 원장 전용(소견서 전용 탭 → publish_opinion_doc RPC, is_doctor_role 게이트).
 *   - 데스크 서류출력(DocumentPrintPanel / PaymentMiniWindow Zone3)의 소견서(diag_opinion)·진단서(diagnosis)
 *     카드 = 원장 발행본만 출력. 본문 자유작성(IssueDialog diagnosis_ko) 동선 제거.
 *   - v2 B안: 원장 미작성 = 출력 버튼 비활성(disabled). 작성 완료(published opinion_doc) = 활성 → 발행본 출력.
 *   - 적용 대상 = 소견서/진단서 2종만. 나머지 8종은 무게이트(기존 동작 유지).
 *
 * AC-1 : 게이트 대상 식별 = diag_opinion(소견서)·diagnosis(진단서) 2종만 (formTemplates DOCLIST 4·5와 정합).
 * AC-2 : 데스크 출력 = 원장 발행본 스냅샷(printOpinionDoc, body=field_data.final_text). 자유작성 경로 없음.
 * AC-3 : v2 게이트 — 미작성 disabled / 작성완료 활성(authored 신호 = published opinion_doc by doc_type).
 * AC-4 : 발행본 식별 = doc_type(opinion/diagnosis). 발행 시 field_data.doc_type 저장, legacy=opinion 폴백.
 * AC-5 : 출력 양식 분기 — 소견서=diag_opinion 양식, 진단서=diagnosis 양식(printOpinionDoc formKey).
 * AC-6 : 회귀0 — 원장 작성 동선(OpinionDocTab publish_opinion_doc, is_doctor_role) 불변 + lock-out 없음.
 * AC-7 : 회귀0 — 나머지 8종 서류는 게이트 비대상(무조건 출력/기존 동작) + 앱 정상 로드.
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200).
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 후 done).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const gateLib = () => read('src/lib/medDocPrintGate.ts');
const printLib = () => read('src/lib/printOpinionDoc.ts');
const dpp = () => read('src/components/DocumentPrintPanel.tsx');
const pmw = () => read('src/components/PaymentMiniWindow.tsx');
const opinionTab = () => read('src/components/doctor/OpinionDocTab.tsx');
const formTpl = () => read('src/lib/formTemplates.ts');

test.describe('T-20260620-foot-MEDDOC-DESK-PRINTONLY-DOCTOR-AUTHORED — 원장 작성 / 데스크 출력만', () => {

  // 앱 정상 로드 (회귀 가드)
  test('AC-7: 앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // AC-1: 게이트 대상 = 소견서·진단서 2종만, DOCLIST 4·5와 정합
  test('AC-1: 게이트 대상 식별 — diag_opinion/diagnosis 2종만', () => {
    const g = gateLib();
    expect(g).toContain("GATED_MEDDOC_FORM_KEYS");
    expect(g).toContain("'diag_opinion'");
    expect(g).toContain("'diagnosis'");
    // DOCLIST_ORDER_10 의 4.소견서=diag_opinion / 5.진단서=diagnosis 와 일치
    const f = formTpl();
    expect(f).toContain("'diag_opinion',           // 4. 소견서");
    expect(f).toContain("'diagnosis',              // 5. 진단서");
    // 나머지 8종이 게이트 배열에 포함되지 않음(과적용 방지)
    for (const other of ['bill_receipt', 'bill_detail', 'koh_result', 'treat_confirm', 'referral_letter', 'visit_confirm', 'medical_record_request', 'rx_standard']) {
      expect(g.includes(`GATED_MEDDOC_FORM_KEYS: ReadonlyArray<string> = ['diag_opinion', 'diagnosis']`)).toBeTruthy();
      // 게이트 배열 리터럴에 다른 키가 없음을 명시
      expect(g).not.toContain(`'${other}'`);
    }
  });

  // AC-2: 데스크 출력 = 원장 발행본 스냅샷. 자유작성(diagnosis_ko 직접입력) 경로 없음.
  test('AC-2: 데스크 출력 = 발행본 스냅샷(printAuthoredMedDoc), 자유작성 경로 제거', () => {
    const g = gateLib();
    // 발행본 신호원 = form_submissions(opinion_doc, status=published)
    expect(g).toContain("from('form_templates')");
    expect(g).toContain("eq('form_key', 'opinion_doc')");
    expect(g).toContain("eq('status', 'published')");
    expect(g).toContain("final_text");
    expect(g).toContain('export function printAuthoredMedDoc');
    // DocumentPrintPanel 게이트 카드는 IssueDialog(자유작성) 대신 발행본 출력으로 라우팅
    const d = dpp();
    expect(d).toContain('medDocGate');
    expect(d).toContain('printAuthoredMedDoc');
    expect(d).toContain('docprint-meddoc-print-');
    expect(d).toContain('docprint-meddoc-locked-');
  });

  // AC-3: v2 게이트 — 미작성 disabled / 작성완료 활성
  test('AC-3: v2 게이트 — 미작성 잠금 / 작성완료 출력 활성 (DocumentPrintPanel)', () => {
    const d = dpp();
    // 게이트 대상은 일괄선택 체크박스 비대상(자유 토글 차단) + authored 분기
    expect(d).toContain('isGatedMedDoc');
    expect(d).toContain('gate.authored');
    // 미작성 안내(원장 작성 필요) + 작성완료 출력 라벨
    expect(d).toContain('원장 작성 필요');
    expect(d).toContain('원장 작성 완료 · 출력');
    // 게이트 카드는 onToggle(일괄선택) 대신 onPrint 경로
    expect(d).toContain('gate.onPrint()');
    // 데이터 속성으로 authored 상태 노출(현장 검증/디버그)
    expect(d).toContain("data-authored={isGated ? (gate.authored ? 'true' : 'false') : undefined}");
  });

  // AC-3(PMW): PaymentMiniWindow Zone3 도 동일 게이트
  test('AC-3: PaymentMiniWindow Zone3 동일 게이트', () => {
    const p = pmw();
    expect(p).toContain('useAuthoredMedDocs');
    expect(p).toContain('medDocGate');
    expect(p).toContain('printAuthoredMedDoc');
    // 미작성 disabled 버튼 + 작성완료 출력 버튼
    expect(p).toContain('doc-meddoc-');
    expect(p).toContain('원장 작성 필요');
    expect(p).toContain('disabled={locked}');
  });

  // AC-4: 발행본 식별 = doc_type. 발행 시 저장 + legacy 폴백.
  test('AC-4: doc_type 식별 — 발행 저장 + opinion 폴백', () => {
    const tab = opinionTab();
    // 발행 RPC field_data 에 doc_type 저장
    expect(tab).toContain('doc_type: input.docType');
    expect(tab).toContain("docType: initialDocType === 'diagnosis' ? 'diagnosis' : 'opinion'");
    // PublishedOpinionRow 에 doc_type 매핑 + legacy(opinion) 폴백
    expect(tab).toContain("doc_type: fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion'");
    // 게이트 lib 도 doc_type 으로 서류종류 분리(legacy=opinion 폴백)
    const g = gateLib();
    expect(g).toContain("fd['doc_type'] === 'diagnosis' ? 'diagnosis' : 'opinion'");
    expect(g).toContain('medDocFormKeyToDocType');
  });

  // AC-5: 출력 양식 분기 — 소견서/진단서 다른 양식
  test('AC-5: 출력 양식 분기 — diag_opinion / diagnosis', () => {
    const pl = printLib();
    expect(pl).toContain("export type OpinionPrintFormKey = 'diag_opinion' | 'diagnosis'");
    // 본문 바인딩 필드 양식별 분기(소견서=diagnosis_ko, 진단서=treatment_opinion)
    expect(pl).toContain('BODY_FIELD_BY_FORM');
    expect(pl).toContain("diag_opinion: 'diagnosis_ko'");
    expect(pl).toContain("diagnosis: 'treatment_opinion'");
    // 양식 결정(formKey) 후 getHtmlTemplate(formKey)
    expect(pl).toContain('getHtmlTemplate(formKey)');
  });

  // AC-6: 원장 작성 동선 불변 + lock-out 없음
  test('AC-6: 원장 작성 동선(publish_opinion_doc, is_doctor_role) 불변', () => {
    const tab = opinionTab();
    // 발행 = 원장 전용 RPC(is_doctor_role 게이트). 본 티켓이 작성 동선을 막지 않음.
    expect(tab).toContain('publish_opinion_doc');
    expect(tab).toContain("canPublish = ['director', 'doctor'].includes(profile?.role ?? '')");
    // 게이트 lib 은 데스크 '출력'만 다루고 작성/발행 RPC 를 호출하지 않음(authoring 무간섭).
    //   주석의 경계 문서화 언급은 허용하되, 실제 발행 RPC 호출(rpc('publish_opinion_doc')) 은 없어야 함.
    const g = gateLib();
    expect(g).not.toContain("rpc('publish_opinion_doc'");
  });

  // AC-7: 나머지 8종 무게이트 — 게이트 함수가 null 반환(기존 동작)
  test('AC-7: 비대상 8종 무게이트(isGatedMedDoc=false → 기존 토글/발행)', () => {
    const g = gateLib();
    expect(g).toContain('export function isGatedMedDoc');
    expect(g).toContain("return GATED_MEDDOC_FORM_KEYS.includes(formKey)");
    // DocumentPrintPanel: 무게이트(gate=null)면 기존 onToggle/onCardClick(상세 발행) 경로
    const d = dpp();
    expect(d).toContain('const gate = medDocGate?.(tpl.form_key) ?? null');
    expect(d).toContain('상세 발행 →');
    expect(d).toContain('onToggle(tpl.form_key)');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트 — 갤탭 실기기 현장 confirm 후 done):
 *
 * [시나리오0] 출력 버튼 활성화 게이트 (v2 B안) — AC-3
 *   1. 원장 미작성 상태 — 데스크 로그인 → 환자 차트 '서류 출력'(또는 결제창 Zone3 서류발행)
 *   2. 소견서·진단서 카드 = 🔒 '원장 작성 필요' 비활성(클릭해도 출력 안 됨) 확인
 *   3. 원장(소견서 전용 탭=/admin/doctor-tools 서류작성)에서 해당 서류 발행 → 데스크 화면 재진입/새로고침
 *   4. 동일 서류 카드 = '원장 작성 완료 · 출력' 활성 → 클릭 시 원장 발행 내용 그대로 인쇄 미리보기
 *   5. (회귀) 나머지 8종(영수증·세부내역서·KOH·진료확인서·진료의뢰서·통원확인서·진료기록사본·처방전)은
 *      원장 작성 여부와 무관하게 기존대로 선택/출력 가능 확인.
 *
 * [시나리오1] 원장 작성 — 소견서/진단서 본문 작성 (authoring) — AC-6
 *   1. 원장(director/doctor) 로그인 → 진료대시보드 서류작성 → 소견/진단 본문 입력 → [발행]
 *   2. 발행본이 데스크 출력 게이트의 '작성 완료' 신호로 즉시 반영 확인(doc_type 분리).
 *
 * [시나리오2] 데스크 본문 작성 차단 — AC-2
 *   1. 데스크 계정 소견서·진단서 카드에 자유 본문 입력칸(IssueDialog diagnosis_ko)이 노출되지 않음 확인.
 *   2. 데스크는 원장 발행본 출력만 가능(본문 변조 불가, 스냅샷 출력).
 *
 * 비고: '작성 완료' 신호 = form_submissions(template=opinion_doc, status='published') by doc_type. NO-DDL(JSONB 재사용).
 *   출력 = printOpinionDoc(L-006 bindHtmlTemplate 단일 경로) 재사용 — 신규 출력 스택 없음.
 */
