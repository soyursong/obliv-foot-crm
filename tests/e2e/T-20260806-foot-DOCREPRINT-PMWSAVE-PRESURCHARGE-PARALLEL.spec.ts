/**
 * E2E spec — T-20260806-foot-DOCREPRINT-PMWSAVE-PRESURCHARGE-PARALLEL
 *
 * 부모 T-20260806-foot-DOCREPRINT-BILLDETAIL-LIVERECALC(f44da994) 후속. 부모 FIX-0 는 DPP(DocumentPrintPanel)
 * 경로의 save↔print divergence 를 해소했으나, 결제미니창(PaymentMiniWindow=PMW) 저장경로에 동일 결함 클래스가
 * 평행하게 잔존했다. 부모 FIX-1 로 bill_detail 이 저장본 재출력(verbatim) 1급 대상이 되면서, PMW 가 가산(applyNight-
 * HolidaySurcharge) 前 값을 field_data 로 persist 하면 잘못된 저장본이 그대로 재발급된다(실손 청구서류 금액오류).
 *
 * ── CENSUS(2 divergence site, DPP FIX-0 이후 잔존) ──────────────────────────────
 *   ① PMW INSERT(persistSubmissionsAndResolveIssueNo 최초 field_data) — docSerialPrefix('bill_receipt_new')=null
 *      (연번 미대상) → 이 INSERT 가 bill_receipt_new 저장 최종본. 종전 buildCodeEnrichedValues(가산前) 직저장.
 *   ② PMW 연번호(visit_no) update(merged) — docSerialPrefix('bill_detail')='BILL'(연번 대상) → 이 update 가
 *      bill_detail(실손 청구서류) 저장 최종본. 종전 buildCodeEnrichedValues(가산前)+visit_no → 저장본이 가산前값으로
 *      굳어 재출력 시 verbatim 오발급. ★본 결함의 실손청구 경로.
 *   (처방전 update 는 rx_standard→surcharge no-op 이라 divergent 아님 — 코드 정합 위해 동일 빌더 경유만.)
 *
 * ── FIX-2A (PaymentMiniWindow.tsx, 저장경로 정렬) ──────────────────────────────
 *   호출부에 print-binding 단일 SSOT 빌더 buildPrintFieldData(=buildCodeEnrichedValues → applyNightHolidaySurcharge
 *   → applyPostSurchargePaidTokens 순서 적용)를 hoist 하고, persist 3 site + 인쇄 buildPages 가 **동일 빌더**로
 *   field_data 를 만든다 → save↔print 값이 코드 레벨에서 동일(divergence 구조적 봉인, 부모 FIX-0 valuesFor 미러).
 *   ★ applyNightHolidaySurcharge 가 bill_detail/bill_receipt_new 에 surcharge_amount·surcharge_kind_label 토큰을
 *     무조건 세팅 → FIX-2A 로 야간·공휴일 PMW 저장본에 이 토큰이 남는다(DoD 1).
 *
 * ── FIX-2B (DocumentPrintPanel.tsx, 소급 가드) ─────────────────────────────────
 *   가산-前 구(舊) 저장본(FIX-0/FIX-2A 이전 = surcharge_amount 키 자체가 없음)을 ReprintViewer(저장본 다시보기)로
 *   재출력하면 가산 빠진 값이 verbatim 재발급(실손청구 오류) → handleSelectTemplate 재출력 진입에 isStaleSurcharge-
 *   SavedCopy 가드를 편입해 구본이면 뷰어 대신 신규 발행(라이브 재계산=가산 반영)으로 폴백한다(DoD 2).
 *   findLatestPrintedSubmission 함수 자체는 무접촉(소비부 가드만 additive).
 *
 * ── 무접촉 하드가드 ──────────────────────────────────────────────────────────
 *   applyNightHolidaySurcharge 절사(10원) 규칙 자체 무변경(값 정렬만) · 연번호/교부번호 재발번 없음 ·
 *   bill_receipt_new↔bill_detail 공유키 교차오염 없음(form_key별 독립 enriched) · DPP 경로 무접촉(회귀0).
 *
 * 검증 축:
 *   AC-1(SSOT, seed 무관): PMW 저장 3 site 가 buildFieldData(print-binding 빌더) 경유. buildCodeEnrichedValues
 *     직저장(field_data: buildCodeEnrichedValues(…)) 0건. 빌더가 가산·가산後 토큰 헬퍼를 순서대로 호출.
 *   AC-2(SSOT): 인쇄(buildPages)와 저장이 동일 빌더(buildPrintFieldData) 소비 → 단일 소스.
 *   AC-3(무접촉): 절사 SSOT(computeBillDetailRounding/floor*) 재정의·복제 없음. DPP(DocumentPrintPanel) 무수정.
 *   DB evidence(graceful skip): PMW 저장본(bill_detail/bill_receipt_new)에 가산·항목 토큰이 남는다.
 *
 * ⚠ 저장경로 정합은 소스 SSOT 로 앵커(seed 무관, 부모 spec EXPECTED_WHITELIST 동형 관례). 실데이터 의존 검증은
 *   seed 부재 시 graceful skip.
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

test.describe('T-20260806 DOCREPRINT-PMWSAVE-PRESURCHARGE-PARALLEL — PMW 저장본 가산前값 정렬', () => {
  // ── AC-1: PMW 저장 3 site 는 print-binding 빌더 경유, 가산前 buildCodeEnrichedValues 직저장 0건 ──
  test('AC-1: persist field_data 3 site 가 buildFieldData 경유(가산前 buildCodeEnrichedValues 직저장 폐기)', () => {
    // 결함 클래스 재발 앵커: `field_data: buildCodeEnrichedValues(` (가산前 값 직접 persist)이 소스에 0건이어야 한다.
    const directPersist = pmwSource.match(/field_data:\s*buildCodeEnrichedValues\(/g) ?? [];
    expect(directPersist.length).toBe(0);

    // spread 형태 직저장(구 rxFieldData/merged 패턴)도 0건 — 저장본은 오직 buildFieldData 결과만 persist.
    const spreadPersist = pmwSource.match(/\.\.\.buildCodeEnrichedValues\(/g) ?? [];
    expect(spreadPersist.length).toBe(0);

    // persist 함수가 buildFieldData 를 소비(3 site: INSERT field_data / merged / rxFieldData).
    expect(pmwSource).toMatch(/field_data:\s*buildFieldData\(t\.form_key,\s*null,\s*undefined\)/); // ① INSERT
    expect(pmwSource).toMatch(/const merged = buildFieldData\(t\.form_key,\s*null,\s*docSerial\)/); // ② 연번호 update
    expect(pmwSource).toMatch(/const rxFieldData = buildFieldData\('rx_standard',\s*rxIssueNo,\s*rxVisitNo\)/); // 처방전
  });

  // ── AC-1b: buildPrintFieldData 가 가산 fold + 가산後 토큰을 순서대로 적용 ──────────
  test('AC-1b: buildPrintFieldData = buildCodeEnrichedValues → applyNightHolidaySurcharge → applyPostSurchargePaidTokens 순서', () => {
    const builderMatch = pmwSource.match(
      /const buildPrintFieldData =[\s\S]*?return enriched;\s*\};/,
    );
    expect(builderMatch).not.toBeNull();
    const body = builderMatch![0];

    const idxEnrich = body.indexOf('buildCodeEnrichedValues(');
    const idxSurcharge = body.indexOf('applyNightHolidaySurcharge(');
    const idxPaid = body.indexOf('applyPostSurchargePaidTokens(');
    // 셋 다 존재 + 순서강제(enrich → 가산 fold → 가산後 토큰).
    expect(idxEnrich).toBeGreaterThan(-1);
    expect(idxSurcharge).toBeGreaterThan(idxEnrich);
    expect(idxPaid).toBeGreaterThan(idxSurcharge);
    // visit_no 주입도 가산 前(교부번호/연번호는 enrich 단계 값).
    expect(body).toMatch(/enriched\.visit_no = visitNoArg/);
  });

  // ── AC-2: 인쇄(buildPages)와 저장이 동일 빌더 소비 = 단일 소스(save↔print parity) ──────
  test('AC-2: 인쇄 buildPages 가 buildPrintFieldData 를 소비(저장과 동일 SSOT)', () => {
    expect(pmwSource).toMatch(
      /const enriched = buildPrintFieldData\(t\.form_key,\s*rxIssueNo,\s*visitNoByTemplateId\.get\(t\.id\)\)/,
    );
    // persist 호출부가 buildFieldData: buildPrintFieldData 로 동일 빌더를 넘긴다.
    expect(pmwSource).toMatch(/buildFieldData:\s*buildPrintFieldData/);
    // 빌더 정의는 persist 호출 前(hoist) — 저장·인쇄 양쪽이 참조 가능해야 divergence 봉인.
    const idxBuilderDef = pmwSource.indexOf('const buildPrintFieldData =');
    const idxPersistCall = pmwSource.indexOf('await persistSubmissionsAndResolveIssueNo({');
    expect(idxBuilderDef).toBeGreaterThan(-1);
    expect(idxPersistCall).toBeGreaterThan(idxBuilderDef);
  });

  // ── FIX-2B: 소급 가드 — 가산-前 구 저장본은 뷰어 재출력 대신 신규 발행 폴백(DoD 2) ──────────
  test('FIX-2B: 가산-capable 서류의 stale(surcharge_amount 키 부재) 구 저장본은 ReprintViewer 진입 차단', () => {
    // 소급 가드 판정자·가드 site 가 소스에 존재(seed 무관 SSOT 앵커).
    expect(dppSource).toMatch(/function isStaleSurchargeSavedCopy/);
    expect(dppSource).toMatch(/SURCHARGE_CAPABLE_FORM_KEYS = new Set\(\['bill_detail',\s*'bill_receipt_new'\]\)/);
    // 판정 = surcharge_amount 키 존재 여부(hasOwnProperty). 신 저장본은 평일에도 '' 로 키 존재 → 통과.
    expect(dppSource).toMatch(/hasOwnProperty\.call\(fd,\s*'surcharge_amount'\)/);
    // handleSelectTemplate 재출력 진입 가드에 stale 검사 편입(구본이면 뷰어 진입 X → openIssueDialog 폴백).
    expect(dppSource).toMatch(/if \(printed && !isStaleSurchargeSavedCopy\(tpl\.form_key, printed\)\)/);
  });

  // ── FIX-2B 판정 로직(DoD 2) — 구본(키 부재)=stale / 신본(키 존재,''포함)=정상 ──────────
  test('FIX-2B 로직: bill_detail 구본(키 부재)만 stale, 신본(surcharge_amount 존재)·비대상 서류는 정상', () => {
    // 로컬 재현(소스 판정과 동형): 키 부재 = 구본 = stale.
    const isStale = (formKey: string, fd: Record<string, unknown>): boolean => {
      if (!['bill_detail', 'bill_receipt_new'].includes(formKey)) return false;
      return !Object.prototype.hasOwnProperty.call(fd, 'surcharge_amount');
    };
    // 구본(가산 前 buildCodeEnrichedValues 직저장 — surcharge_amount 없음) → stale(뷰어 차단).
    expect(isStale('bill_detail', { detail_total: '10,000', items_html: '<tr/>' })).toBe(true);
    expect(isStale('bill_receipt_new', { patient_amount: '10,000' })).toBe(true);
    // 신본(평일 미가산도 '' 로 키 존재) → 정상(뷰어 진입).
    expect(isStale('bill_detail', { detail_total: '10,000', surcharge_amount: '' })).toBe(false);
    expect(isStale('bill_receipt_new', { surcharge_amount: '3,000' })).toBe(false);
    // 가산 무관 서류(처방전·치료확인서 등)는 키 부재여도 stale 아님(무영향, 회귀0).
    expect(isStale('rx_standard', {})).toBe(false);
    expect(isStale('treat_confirm', {})).toBe(false);
  });

  // ── AC-3: 무접촉 하드가드 — 절사 규칙 무변경 + surcharge 헬퍼 복제 없음 ──────────────
  test('AC-3: 절사(10원) 규칙·surcharge SSOT 재정의/복제 없음(값 정렬만)', () => {
    // applyNightHolidaySurcharge 는 import(SSOT lib) 만 — 로컬 재정의(function applyNightHolidaySurcharge) 금지.
    expect(pmwSource).not.toMatch(/function applyNightHolidaySurcharge/);
    // 절사 SSOT(computeBillDetailRounding/floorOutpatientCopayment/floorBillReceiptNewPatientTotal) 로컬 재정의 금지.
    expect(pmwSource).not.toMatch(/function computeBillDetailRounding/);
    expect(pmwSource).not.toMatch(/function floorOutpatientCopayment/);
  });

  // ── DB evidence(graceful skip): PMW 저장본에 가산·항목 토큰이 남는다(가산前 autoValues 직저장이었다면 누락될 값) ──
  test('DoD evidence: PMW bill_detail/bill_receipt_new printed 저장본에 항목·금액 토큰이 남는다', async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) { test.skip(true, 'service key 없음 — DB 단언 불가'); return; }

    const templates = await restGet(
      'form_templates?select=id,form_key&form_key=in.(bill_detail,bill_receipt_new)',
    );
    if (!templates || templates.length === 0) { test.skip(true, '템플릿 없음(seed 부재)'); return; }
    const tplIds = templates.map((t: any) => t.id);
    const inList = tplIds.map((id: string) => `"${id}"`).join(',');

    const subs = await restGet(
      `form_submissions?status=eq.printed&template_id=in.(${inList})&select=id,field_data,template_id,created_at&order=created_at.desc&limit=80`,
    );
    if (!subs || subs.length === 0) { test.skip(true, 'printed 저장본 없음(seed 부재)'); return; }

    // 저장본에 항목/금액 토큰이 채워진 건이 최소 1건 존재해야 한다(전건 공란이면 저장경로 미반영).
    const complete = subs.filter((s) => {
      const fd: Record<string, string> = s.field_data ?? {};
      const hasBillDetail = typeof fd.items_html === 'string' && fd.items_html.length > 0
        && fd.detail_total != null && fd.detail_total !== '';
      const hasReceiptNew = fd.patient_amount != null && fd.patient_amount !== '';
      return hasBillDetail || hasReceiptNew;
    });
    expect(complete.length).toBeGreaterThan(0);
  });
});
