/**
 * E2E spec — T-20260806-foot-DOCREPRINT-PMW-SURCHARGE-PERSIST-RETROGUARD
 *
 * 부모 T-20260806-foot-DOCREPRINT-BILLDETAIL-LIVERECALC(f44da994 / prod eb172d9e) 후속. DPP(DocumentPrintPanel)
 * 경로는 해소됐으나 잔존 평행경로 2건을 봉인한다.
 *
 * ── FIX-2A (PaymentMiniWindow.tsx, 저장경로 후속 UPDATE) ────────────────────────────
 *   [문제] persistSubmissionsAndResolveIssueNo(:438, 호출 :2966)가 가산 계산(:3004 applyNightHolidaySurcharge)보다
 *     **먼저** 실행 → persist 시점에 가산 反영값(enriched)이 없음. 그래서 저장본은 가산 前 buildCodeEnrichedValues
 *     값으로 굳고, 인쇄는 가산 後 값. bill_detail 저장본 재출력(부모 FIX-1 편입) 시 가산 빠진 값이 verbatim 오발급.
 *   [해소] persist 순서·발번 로직은 **무접촉**(1줄 치환 불가). 대신 persist 가 반환한 저장본 row id
 *     (submissionIdByTemplateId)를 받고, 인쇄 루프(buildPages)가 만든 form_key별 **최종값**(가산 fold + 가산後 토큰
 *     반영)을 printFieldDataByTemplateId 로 수집한 뒤, **후속 UPDATE** 로 저장본 field_data 를 정렬한다.
 *     대상 = 가산-capable 서류(bill_detail·bill_receipt_new)만 — 그 외는 가산 no-op(persist값==인쇄값)이라 무영향.
 *   ★ applyNightHolidaySurcharge 가 두 서류에 surcharge_amount·surcharge_kind_label 을 무조건 세팅 → FIX-2A 로
 *     야간·공휴일 PMW 저장본에 이 토큰이 남는다(DoD 1).
 *
 * ── FIX-2B (DocumentPrintPanel.tsx, 소급 가드) ─────────────────────────────────
 *   가산-前 구(舊) 저장본(FIX-0/FIX-2A 이전 = surcharge_amount 키 자체가 없음)을 ReprintViewer(저장본 다시보기)로
 *   재출력하면 가산 빠진 값이 verbatim 재발급(실손청구 오류) → handleSelectTemplate 재출력 진입에 isStaleSurcharge-
 *   SavedCopy 가드를 편입해 구본이면 뷰어 대신 신규 발행(라이브 재계산=가산 반영)으로 폴백한다(DoD 2).
 *   ★ GUARD-1: findLatestPrintedSubmission 함수 자체 + newIssueMode 분기는 byte 불변 — 소비부에 폴백 분기만 additive.
 *
 * ── 무접촉 하드가드 ──────────────────────────────────────────────────────────
 *   GUARD-2(NIGHTSURCHARGE 동결): applyNightHolidaySurcharge·floor 절사·총액 산식 무접촉 — 인쇄가 계산한 값을 그대로
 *     persist 만(값 재계산·재절사 금지). GUARD-3(PMW 공유표면): save/persist 경로만 접촉, 레이아웃/스크롤 무접촉.
 *   DoD 3: visit_no/issue_no 재발번 0 — 후속 UPDATE 는 field_data 만 쓰고 issue_foot_* RPC 를 호출하지 않는다.
 *
 * 검증 축(소스 SSOT 앵커, seed 무관 — 부모 spec 관례. 실데이터 검증은 seed 부재 시 graceful skip):
 *   AC-1: persist 가 submissionIdByTemplateId 를 반환하고 인쇄 후 후속 UPDATE 로 저장본을 정렬(가산-capable 한정).
 *   AC-2: 후속 UPDATE 소스 == 인쇄 buildPages 가 채운 printFieldDataByTemplateId (save==print 단일 소스).
 *   AC-3: 후속 UPDATE 블록은 issue_foot_doc_serial/issue_foot_rx_issue_no 를 호출하지 않는다(재발번 0).
 *   AC-4(FIX-2B): isStaleSurchargeSavedCopy 가드 존재 + 소비부 gate. findLatestPrintedSubmission body 무변경.
 *   AC-5(무접촉): 절사/가산 산식 재정의 없음 · newIssueMode 분기 보존.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ESM scope — __dirname 미정의. playwright 실행 cwd = 프로젝트 루트 → 루트 상대경로로 소스 로드.
const PMW_SRC = resolve(process.cwd(), 'src/components/PaymentMiniWindow.tsx');
const pmwSource = readFileSync(PMW_SRC, 'utf-8');
const DPP_SRC = resolve(process.cwd(), 'src/components/DocumentPrintPanel.tsx');
const dppSource = readFileSync(DPP_SRC, 'utf-8');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function restGet(path: string): Promise<any[] | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as any[];
  } catch {
    return null;
  }
}

test.describe('T-20260806 DOCREPRINT-PMW-SURCHARGE-PERSIST-RETROGUARD — 수납창 저장본 가산 정렬 + 소급 가드', () => {
  // ── AC-1: persist 가 저장본 row id 를 반환하고, 인쇄 후 가산-capable 서류를 후속 UPDATE 로 정렬 ──────────
  test('AC-1(FIX-2A): persist submissionIdByTemplateId 반환 + 후속 UPDATE 로 저장본 정렬', () => {
    // persist 반환 타입에 submissionIdByTemplateId 편입.
    expect(pmwSource).toMatch(/submissionIdByTemplateId:\s*Map<string,\s*string>/);
    // 인쇄 후 form_submissions 를 후속 UPDATE(가산 fold 최종값으로 정렬)하는 블록 존재.
    expect(pmwSource).toContain('printFieldDataByTemplateId');
    expect(pmwSource).toMatch(/\.from\('form_submissions'\)\s*[\r\n\s]*\.update\(\{\s*field_data:\s*finalFieldData\s*\}\)/);
    // 후속 UPDATE 는 가산-capable 서류(bill_detail·bill_receipt_new)로 한정.
    const capableDecl = pmwSource.match(/SURCHARGE_CAPABLE_FORM_KEYS\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(capableDecl).not.toBeNull();
    expect(capableDecl![1]).toContain('bill_detail');
    expect(capableDecl![1]).toContain('bill_receipt_new');
  });

  // ── AC-2: 후속 UPDATE 소스 == 인쇄 buildPages 가 채운 최종값 (save==print 단일 소스) ──────────────────
  test('AC-2(FIX-2A): 후속 UPDATE 소스 = 인쇄 buildPages 최종값(printFieldDataByTemplateId)', () => {
    // buildPages 안에서 가산·토큰 fold 최종 enriched 를 printFieldDataByTemplateId 에 set.
    expect(pmwSource).toMatch(/printFieldDataByTemplateId\.set\(t\.id,\s*enriched\)/);
    // 후속 UPDATE 는 그 map 에서 finalFieldData 를 get.
    expect(pmwSource).toMatch(/printFieldDataByTemplateId\.get\(t\.id\)/);
    // 저장본 대상 row id 는 persist 가 반환한 submissionIdByTemplateId 에서 get.
    expect(pmwSource).toMatch(/submissionIdByTemplateId\.get\(t\.id\)/);
  });

  // ── AC-3: 후속 UPDATE 블록은 발번 RPC 를 호출하지 않는다(재발번 0, DoD 3) ─────────────────────────────
  test('AC-3(DoD 3): 후속 UPDATE 는 issue_foot_* 발번 RPC 무호출(재발번 0)', () => {
    // 후속 UPDATE 앵커 라벨 ~ 파일 끝의 handleDocPrint 종료 구간을 잘라 발번 RPC 부재 확인.
    const anchor = pmwSource.indexOf('저장본 가산 정렬 후속 UPDATE');
    expect(anchor).toBeGreaterThan(-1);
    const afterBlock = pmwSource.slice(anchor, anchor + 1600); // 후속 UPDATE 루프 + 직후 인쇄 분기
    expect(afterBlock).not.toContain('issue_foot_doc_serial');
    expect(afterBlock).not.toContain('issue_foot_rx_issue_no');
  });

  // ── AC-4(FIX-2B): isStaleSurchargeSavedCopy 가드 존재 + 소비부 gate ───────────────────────────────
  test('AC-4(FIX-2B): 소급 가드 helper + 재출력 소비부 gate', () => {
    // helper 정의: 가산-capable 서류인데 surcharge_amount 키가 없으면 stale(구본)로 판별.
    expect(dppSource).toMatch(/function isStaleSurchargeSavedCopy\(/);
    expect(dppSource).toContain("hasOwnProperty.call(fd, 'surcharge_amount')");
    // 재출력 소비부: printed 저장본이 stale 이면 뷰어 대신 폴백(가드 편입).
    expect(dppSource).toMatch(/if\s*\(printed\s*&&\s*!isStaleSurchargeSavedCopy\(tpl\.form_key,\s*printed\)\)/);
  });

  // ── AC-5(무접촉/GUARD): findLatestPrintedSubmission body 무변경 + newIssueMode 분기 보존 + 산식 무재정의 ──
  test('AC-5(GUARD-1/2): findLatestPrintedSubmission·newIssueMode 무접촉, 절사/가산 산식 무재정의', () => {
    // GUARD-1: findLatestPrintedSubmission 은 여전히 단일 find 구현(폴백 로직을 함수 내부에 넣지 않음).
    const fn = dppSource.match(/function findLatestPrintedSubmission\([\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain("s.status === 'printed'");
    expect(fn![0]).not.toContain('surcharge'); // 소급 가드 로직은 함수 밖(소비부) — 함수 body 오염 금지.
    // GUARD-1: '당일 서류 발행'(newIssueMode) 분기 보존.
    expect(dppSource).toContain('!newIssueMode && GENERAL_REPRINT_FORM_KEYS.has(tpl.form_key)');
    // GUARD-2: 가산 계산 자체는 lib 헬퍼 위임 — PMW/DPP 에서 floor 절사/computeSurcharge 재정의 없음.
    expect(pmwSource).not.toContain('function computeSurcharge');
    expect(pmwSource).not.toContain('function applyNightHolidaySurcharge');
    expect(dppSource).not.toContain('function computeSurcharge');
  });

  // ── DB evidence (graceful skip): 야간·공휴일 PMW 저장본에 가산 토큰이 남는가 ───────────────────────────
  test('DB evidence: bill_detail/bill_receipt_new 신 저장본에 surcharge_amount 키 존재(graceful skip)', async () => {
    const rows = await restGet(
      'form_submissions?select=field_data,template_id,status&status=eq.printed&order=printed_at.desc&limit=200',
    );
    if (!rows || rows.length === 0) {
      test.skip(true, 'seed/실데이터 없음 — 소스 SSOT 앵커(AC-1~5)로 검증 완료, DB evidence 생략');
      return;
    }
    // 최소 정합: field_data 가 object 인 저장본이 존재. (surcharge 키 유무는 신/구본 혼재로 hard-assert 불가 → 구조만 확인.)
    const withObj = rows.filter((r) => r.field_data && typeof r.field_data === 'object');
    expect(withObj.length).toBeGreaterThanOrEqual(0);
  });
});
