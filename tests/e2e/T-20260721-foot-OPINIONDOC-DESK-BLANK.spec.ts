/**
 * E2E Spec — T-20260721-foot-OPINIONDOC-DESK-BLANK
 *
 * [P0] 소견서/진단서 데스크(수납) 출력 시 환자정보(주민번호·생년월일·연령·성별·주소·연락처)·
 *      상병코드 전부 공란, 이름만 표시.
 *
 * Root Cause (커버리지 누락):
 *   T-20260720 4FIX 는 원장탭(OpinionDocTab) 출력에만 autoValues(공용 바인더)를 배선하고,
 *   데스크 경로 2곳(DocumentPrintPanel·PaymentMiniWindow)이 공용 함수 printAuthoredMedDoc 를
 *   autoValues 없이 호출 → 환자정보·상병 토큰이 바인딩맵 부재로 공란(patient_name 만 명시전달돼 이름만).
 *
 * Fix (평행경로 필수 — 한 곳만 고치면 재오픈):
 *   medDocPrintGate.printAuthoredMedDoc 시그니처에 checkIn 인자 추가 → 내부에서
 *   loadAutoBindContext(checkIn) 로 autoValues 로드 → printOpinionDoc 에 주입.
 *   호출부 2곳(DocumentPrintPanel:서류탭 / PaymentMiniWindow:수납 미니창) 모두 checkIn 전달.
 *   발행본 스냅샷(발행자·면허·차트·발행일·본문)은 printOpinionDoc 내부 override 로 보존(법정 불변).
 *
 * AC (canon 티켓):
 *   AC-1  F-4808 서류탭 소견서 출력 → 환자정보 7필드 채워짐 (DocumentPrintPanel checkIn 전달)
 *   AC-2  F-4808 수납 미니창 소견서 출력 → 환자정보 7필드 채워짐 (PaymentMiniWindow 평행경로)
 *   AC-3  원장탭 소견서 출력 회귀 0 (autoValues 배선 불변)
 *   AC-4  E2E spec 통과
 *   AC-5  빌드/lint OK
 *
 * 실행: npx playwright test --project=unit T-20260721-foot-OPINIONDOC-DESK-BLANK.spec.ts
 * NOTE: printAuthoredMedDoc→loadAutoBindContext(supabase)→printOpinionDoc(window.open) 은 브라우저·DB
 *       의존 → 배선 계약은 정적 소스 가드로, 바인딩 결과는 bindHtmlTemplate 실렌더로 검증(4FIX spec 관행 계승).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATE_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/lib/medDocPrintGate.ts'),
  'utf-8',
);
const DOCPANEL_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/components/DocumentPrintPanel.tsx'),
  'utf-8',
);
const PMW_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/components/PaymentMiniWindow.tsx'),
  'utf-8',
);
const TAB_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/components/doctor/OpinionDocTab.tsx'),
  'utf-8',
);

// ── RC 배선: printAuthoredMedDoc autoValues 로드 경로 ──────────────────────────
test.describe('RC 배선: medDocPrintGate.printAuthoredMedDoc → loadAutoBindContext', () => {
  test('printAuthoredMedDoc 는 async 이고 Promise<boolean> 반환', () => {
    expect(GATE_SRC, 'printAuthoredMedDoc async 아님').toMatch(
      /export\s+async\s+function\s+printAuthoredMedDoc/,
    );
    expect(GATE_SRC, '반환 타입 Promise<boolean> 아님').toMatch(/\):\s*Promise<boolean>\s*\{/);
  });

  test('loadAutoBindContext import + ctx.checkIn 으로 autoValues 로드', () => {
    // T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK: applyDiagCodesFromVisit co-import 로 import 확장 → tolerant 매칭.
    expect(GATE_SRC).toMatch(/import\s*\{[^}]*\bloadAutoBindContext\b[^}]*\}\s*from\s*'@\/lib\/autoBindContext'/);
    expect(GATE_SRC, 'ctx.checkIn 가드 누락').toMatch(/if\s*\(\s*ctx\.checkIn\?\.customer_id\s*\)/);
    // T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH: loadAutoBindContext 가 발행자(issued_by) 인자를 받도록
    //   확장됨(도장 발행자-앵커 결선) → 단일인자 정확문자열 대신 ctx.checkIn 로 시작하는 호출 tolerant 매칭.
    expect(GATE_SRC, 'loadAutoBindContext(ctx.checkIn) 호출 누락').toMatch(
      /await loadAutoBindContext\(\s*ctx\.checkIn/,
    );
  });

  test('로드한 autoValues 를 printOpinionDoc 에 주입', () => {
    // return printOpinionDoc({ ... autoValues, ... }) — autoValues 프로퍼티 전달.
    // T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK 이후 autoValues 뒤에 diagCodes 가 붙어 `autoValues,` 다음이
    //   곧바로 `});` 가 아님 → autoValues 가 printOpinionDoc 인자로 전달됨만 tolerant 확인.
    const printIdx = GATE_SRC.indexOf('return printOpinionDoc({');
    expect(printIdx, 'printOpinionDoc 호출 누락').toBeGreaterThanOrEqual(0);
    expect(GATE_SRC.slice(printIdx), 'printOpinionDoc 에 autoValues 미주입').toMatch(
      /autoValues,/,
    );
  });

  test('조회 실패 시 try/catch 폴백(인쇄 계속) — 종전 9필드 동작', () => {
    expect(GATE_SRC).toMatch(/try\s*\{[\s\S]*loadAutoBindContext[\s\S]*\}\s*catch/);
    expect(GATE_SRC).toContain('[OPINIONDOC-DESK-BLANK]');
  });

  test('MedDocPrintContext 에 checkIn 옵셔널 필드 존재', () => {
    expect(GATE_SRC).toMatch(/checkIn\?:\s*CheckIn\s*\|\s*null/);
  });
});

// ── AC-1: 데스크(서류탭) DocumentPrintPanel 평행경로 ──────────────────────────
test.describe('AC-1: DocumentPrintPanel(서류탭) checkIn 전달', () => {
  test('printAuthoredMedDoc onPrint 가 async + await + checkIn 전달', () => {
    // onPrint: async () => { ... await printAuthoredMedDoc(formKey, doc, { ..., checkIn }) }
    const callIdx = DOCPANEL_SRC.indexOf('printAuthoredMedDoc(formKey, doc, {');
    expect(callIdx, 'printAuthoredMedDoc 호출 누락').toBeGreaterThanOrEqual(0);
    const call = DOCPANEL_SRC.slice(callIdx - 60, callIdx + 260);
    expect(call, 'await 누락').toContain('await printAuthoredMedDoc');
    expect(call, 'checkIn 전달 누락(평행경로 미충족)').toMatch(/checkIn,\s*\n/);
  });
});

// ── AC-2: 수납 미니창 PaymentMiniWindow 평행경로 ──────────────────────────────
test.describe('AC-2: PaymentMiniWindow(수납 미니창) checkIn 전달', () => {
  test('printAuthoredMedDoc onPrint 가 async + await + checkIn 전달', () => {
    const callIdx = PMW_SRC.indexOf('printAuthoredMedDoc(formKey, doc, {');
    expect(callIdx, 'printAuthoredMedDoc 호출 누락').toBeGreaterThanOrEqual(0);
    const call = PMW_SRC.slice(callIdx - 60, callIdx + 260);
    expect(call, 'await 누락').toContain('await printAuthoredMedDoc');
    // checkIn 이 null 가능 → checkIn ?? undefined 로 전달
    expect(call, 'checkIn 전달 누락(평행경로 미충족)').toMatch(/checkIn:\s*checkIn\s*\?\?\s*undefined/);
  });
});

// ── AC-3: 원장탭(OpinionDocTab) 회귀 0 ────────────────────────────────────────
test.describe('AC-3: 원장탭 회귀 0 (4FIX 배선 불변)', () => {
  test('OpinionDocTab 는 여전히 loadAutoBindContext 직접 배선(변경 없음)', () => {
    // T-20260721-foot-OPINIONDOC-DIAGCODE-BLANK: applyDiagCodesFromVisit co-import 로 import 확장 → tolerant 매칭.
    expect(TAB_SRC).toMatch(/import\s*\{[^}]*\bloadAutoBindContext\b[^}]*\}\s*from\s*'@\/lib\/autoBindContext'/);
    // T-20260721-foot-OPINIONDOC-SEAL-DOCTOR-MATCH: loadAutoBindContext 가 발행자(issued_by) 인자를 받도록
    //   확장됨(도장 발행자-앵커 결선) → 단일인자 정확문자열 대신 checkIn 로 시작하는 호출 tolerant 매칭.
    expect(TAB_SRC).toMatch(/await loadAutoBindContext\(\s*checkIn/);
    expect(TAB_SRC).toMatch(/handlePrint\s*=\s*async/);
  });
});

// ── 실렌더 계약: autoValues 주입 시 환자정보 7필드 채워짐 / 미주입 시 회귀 0 ──────
test.describe('실렌더: printAuthoredMedDoc 병합 결과(autoValues base + 스냅샷 override)', () => {
  const tpl = () => {
    const t = getHtmlTemplate('diag_opinion');
    expect(t, 'diag_opinion 템플릿 로드 실패').toBeTruthy();
    return t as string;
  };

  // printOpinionDoc 병합 로직 재현: autoValues base + 스냅샷 truthy override
  function renderMerge(autoValues: Record<string, string>, snapshot: Record<string, string>) {
    const merged: Record<string, string> = { ...autoValues };
    for (const [k, v] of Object.entries(snapshot)) {
      if (v) merged[k] = v; // truthy override(법정 의무기록 불변)
    }
    return bindHtmlTemplate(tpl(), merged);
  }

  // ⚠ PHI 금지(phi_redaction_standard §4): 실제 RRN 패턴(NNNNNN-NNNNNNN) 금지 → 합성 센티넬.
  const AUTO = {
    patient_rrn: 'RRN_BIND_SENTINEL',
    patient_gender: '남',
    patient_birthdate: '1990년 05월 15일',
    patient_age: '35',
    patient_address: '서울시 종로구 1',
    patient_phone: '010-1234-5678',
    diag_code_1: 'M20.1',
    diag_name_1: '무지외반증',
    diag_flag_1: 'V',
    doctor_seal_html: '<img src="seal.png" />',
  };
  const SNAP = {
    record_no: 'C-4808',
    patient_name: '김문재',
    diagnosis_ko: '발행 소견 본문',
    issue_date: '2026-07-21',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '문지은',
    doctor_license_no: '12345',
  };

  test('AC-1/2: 데스크 경로(checkIn 전달) — 환자정보 7필드 + 상병코드 채워짐(이름만 아님)', () => {
    const html = renderMerge(AUTO, SNAP);
    // 환자정보 7필드
    expect(html, '주민번호 공란').toContain('RRN_BIND_SENTINEL');
    expect(html, '성별 공란').toContain('남');
    expect(html, '생년월일 공란').toContain('1990년 05월 15일');
    expect(html, '연령 공란').toMatch(/만.*35.*세/s);
    expect(html, '주소 공란').toContain('서울시 종로구 1');
    expect(html, '연락처 공란').toContain('010-1234-5678');
    expect(html, '환자명 누락').toContain('김문재');
    // 상병코드
    expect(html, '상병코드 공란').toContain('M20.1');
    expect(html, '상병명 공란').toContain('무지외반증');
    // 미치환 토큰 없음
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  });

  test('AC-3: 발행본 스냅샷(본문·발행자·발행일) 보존(autoValues 라이브값이 덮지 않음)', () => {
    const autoValues = { ...AUTO, patient_name: 'AUTO명', doctor_name: 'AUTO의사' };
    const html = renderMerge(autoValues, SNAP); // SNAP: 김문재 / 문지은
    expect(html).toContain('발행 소견 본문');
    expect(html).toContain('김문재');
    expect(html).toContain('문지은');
    expect(html).toContain('2026-07-21');
    expect(html, 'autoValues 라이브값이 스냅샷을 덮음(불변성 위반)').not.toContain('AUTO명');
    expect(html).not.toContain('AUTO의사');
  });

  test('회귀: checkIn 미전달(autoValues 부재) — 렌더 깨짐/미치환 없음(종전 9필드)', () => {
    // ctx.checkIn 없으면 autoValues=undefined → 스냅샷 9필드만 바인딩
    const html = bindHtmlTemplate(tpl(), SNAP);
    expect(html).toContain('발행 소견 본문');
    expect(html).toContain('김문재');
    expect(html, '미치환 {{token}} 잔존(회귀)').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
  });

  test('AC-10 유형: 상병코드 미등록(빈 문자열) — 빈 행 깨짐 없음', () => {
    const emptyDiag = { ...AUTO, diag_code_1: '', diag_name_1: '', diag_flag_1: '' };
    const html = renderMerge(emptyDiag, SNAP);
    expect(html, '미치환 {{token}} 잔존').not.toMatch(/\{\{[a-z_0-9]+\}\}/);
    expect(html).toContain('소 견 서');
    expect(html).toContain('발행 소견 본문');
  });
});
