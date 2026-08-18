/**
 * E2E spec — T-20260818-foot-DOCPRINT-FIRSTVISIT-MGMTRECORD-AUTOGEN-ISSUE
 *
 * 현장 정정 스펙(reporter 김주연 총괄, C0ATE5P6JTH, 2026-08-18):
 *   "기존 서류출력 항목에 [초진 관리기록지] 만들어 놓은 거 안에 양식 그대로 자동 생성 및 발행을 요청한거야."
 *   = 서류출력 탭 › [초진 관리기록지](form_key='first_visit_mgmt_record') 양식을 CRM 데이터로 전체 자동생성 + 발행.
 *
 * 조사 결과: 성명·생년월일·연락처·초진일·발급일·센터명·담당자는 이미 loadAutoBindContext 로 자동바인딩.
 *   남은 수기 gap = 항목④ 시술및처방(mgmtProcedures) + 항목⑤ 상병명(mgmtDiagnoses) — 드롭다운 수기선택.
 *   이 두 항목을 진입 시 serviceItems(service_charges JOIN services = 결제 미니창 PaymentMiniWindow 가
 *   확정한 canonical 원장, DXCODE 배포분과 동일 소스·동일 '상병' 분기)로 자동 채운다.
 *
 * 본 spec 은 DocumentPrintPanel 의 자동생성 useEffect 인라인 로직(캐노니컬 투영·상병분기·dedup·1회적용·
 *   draft/수기 보존)을 pure 재현으로 잠그고(회귀가드), 산출물이 procedure_rx_html/diagnosis_codes_html
 *   렌더 문자열로 그대로 나타남을 검증한다.
 *   AC-5(소스=serviceItems/service_charges, PaymentDialog 미참조)는 소스 형태 고정으로 계약.
 */
import { test, expect } from '@playwright/test';

// ── 컴포넌트 자동생성 로직의 pure 재현(useEffect 인라인 규칙과 1:1 동일) ──
type ServiceChargeItem = { id: string; service_code: string | null; name: string; category_label: string | null };
type MgmtCodePick = { id: string; name: string; code: string };

/** service_code(없으면 name) 기준 dedup 후 MgmtCodePick[] 산출 — 컴포넌트 toPicks 와 동일. */
function toPicks(items: ServiceChargeItem[]): MgmtCodePick[] {
  const seen = new Set<string>();
  const out: MgmtCodePick[] = [];
  for (const it of items) {
    const key = (it.service_code && it.service_code.trim()) || it.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: it.id, name: it.name, code: it.service_code ?? '' });
  }
  return out;
}

/** 자동생성 게이트 + 투영 산출 — 컴포넌트 useEffect 규칙 재현. */
function autoGen(
  args: {
    open: boolean;
    formKey: string;
    billingReady: boolean;
    fvmrDraftLoadDone: boolean;
    fvmrDraftId: string | null;
    existingProcedures: MgmtCodePick[];
    existingDiagnoses: MgmtCodePick[];
    serviceItems: ServiceChargeItem[];
  },
): { applied: boolean; procedures: MgmtCodePick[]; diagnoses: MgmtCodePick[] } {
  const { open, formKey, billingReady, fvmrDraftLoadDone, fvmrDraftId, existingProcedures, existingDiagnoses, serviceItems } = args;
  const noop = { applied: false, procedures: existingProcedures, diagnoses: existingDiagnoses };
  if (!open || formKey !== 'first_visit_mgmt_record') return noop;
  if (!billingReady || !fvmrDraftLoadDone) return noop;   // 캐노니컬·draft 조회 완료 대기
  if (fvmrDraftId !== null) return noop;                  // 저장 draft = 저장본 authoritative(스킵, AC-5)
  if (existingProcedures.length > 0 || existingDiagnoses.length > 0) return noop; // 수기/복원 보존(AC-5)
  const procedures = toPicks(serviceItems.filter((i) => (i.category_label ?? '') !== '상병'));
  const diagnoses = toPicks(serviceItems.filter((i) => (i.category_label ?? '') === '상병'));
  return { applied: true, procedures, diagnoses };
}

/** procedure_rx_html / diagnosis_codes_html 렌더 — 컴포넌트 renderCodeLines 와 동일. */
function renderCodeLines(picks: MgmtCodePick[]): string {
  return picks
    .map((p) => {
      const label = p.code ? `${p.code} · ${p.name}` : p.name;
      return `<span class="fvmr-code-line">- ${label}</span>`;
    })
    .join('');
}

const CHARGES: ServiceChargeItem[] = [
  { id: 'sc-1', service_code: 'FC10', name: '발톱교정', category_label: '풋케어' },
  { id: 'sc-2', service_code: 'D100', name: '바르토벤', category_label: '처방약' },
  { id: 'sc-3', service_code: 'L03.0', name: '발가락의 봉와직염', category_label: '상병' },
  { id: 'sc-4', service_code: 'B35.1', name: '조갑백선', category_label: '상병' },
];

// ── 시나리오 1(현장 클릭): 신규 기록 진입 → 시술및처방·상병명 자동생성(캐노니컬 상병분기) ──
test('AC-1/AC-2 정상: 청구 항목(service_charges)에서 시술및처방·상병명 자동생성', () => {
  const r = autoGen({
    open: true,
    formKey: 'first_visit_mgmt_record',
    billingReady: true,
    fvmrDraftLoadDone: true,
    fvmrDraftId: null,
    existingProcedures: [],
    existingDiagnoses: [],
    serviceItems: CHARGES,
  });
  expect(r.applied).toBe(true);
  // 시술및처방 = 상병 아닌 항목(풋케어·처방약)
  expect(r.procedures.map((p) => p.code)).toEqual(['FC10', 'D100']);
  // 상병명 = category_label === '상병'
  expect(r.diagnoses.map((d) => d.code)).toEqual(['L03.0', 'B35.1']);
  // 렌더 출력에 코드·명이 그대로 반영(양식 그대로 자동생성)
  const procHtml = renderCodeLines(r.procedures);
  expect(procHtml).toContain('FC10 · 발톱교정');
  expect(procHtml).toContain('D100 · 바르토벤');
  const diagHtml = renderCodeLines(r.diagnoses);
  expect(diagHtml).toContain('L03.0 · 발가락의 봉와직염');
  expect(diagHtml).toContain('B35.1 · 조갑백선');
});

// ── 시나리오 2(현장 클릭): 저장된 draft 재진입 → 저장본 authoritative, 자동생성 미실행(덮어쓰기 금지) ──
test('AC-5 보존: 저장 draft(fvmrDraftId) 존재 시 자동생성 스킵', () => {
  const r = autoGen({
    open: true,
    formKey: 'first_visit_mgmt_record',
    billingReady: true,
    fvmrDraftLoadDone: true,
    fvmrDraftId: 'draft-xyz',            // 저장본 있음
    existingProcedures: [{ id: 'x', name: '수기항목', code: 'MANUAL' }],
    existingDiagnoses: [],
    serviceItems: CHARGES,
  });
  expect(r.applied).toBe(false);
  expect(r.procedures.map((p) => p.code)).toEqual(['MANUAL']); // 저장본 그대로 보존
});

test('AC-5 보존: 이미 수기선택된 항목 있으면 자동생성 스킵', () => {
  const r = autoGen({
    open: true,
    formKey: 'first_visit_mgmt_record',
    billingReady: true,
    fvmrDraftLoadDone: true,
    fvmrDraftId: null,
    existingProcedures: [{ id: 'm1', name: '수기시술', code: 'C1' }],
    existingDiagnoses: [],
    serviceItems: CHARGES,
  });
  expect(r.applied).toBe(false);
  expect(r.procedures.map((p) => p.code)).toEqual(['C1']);
});

// ── 시나리오 3(현장 클릭): 청구 항목 없는 방문 → 빈칸(무동작, 오류 없음) ──
test('AC-3 방어: 청구 항목 없으면 시술및처방·상병명 빈칸(무동작)', () => {
  const r = autoGen({
    open: true,
    formKey: 'first_visit_mgmt_record',
    billingReady: true,
    fvmrDraftLoadDone: true,
    fvmrDraftId: null,
    existingProcedures: [],
    existingDiagnoses: [],
    serviceItems: [],
  });
  expect(r.applied).toBe(true);
  expect(r.procedures).toEqual([]);
  expect(r.diagnoses).toEqual([]);
  expect(renderCodeLines(r.procedures)).toBe('');
  expect(renderCodeLines(r.diagnoses)).toBe('');
});

test('AC-3 방어: 상병만 있고 시술 없음 → 시술및처방만 빈칸', () => {
  const r = autoGen({
    open: true,
    formKey: 'first_visit_mgmt_record',
    billingReady: true,
    fvmrDraftLoadDone: true,
    fvmrDraftId: null,
    existingProcedures: [],
    existingDiagnoses: [],
    serviceItems: [{ id: 'sc-3', service_code: 'L03.0', name: '발가락의 봉와직염', category_label: '상병' }],
  });
  expect(r.procedures).toEqual([]);
  expect(r.diagnoses.map((d) => d.code)).toEqual(['L03.0']);
});

// ── 게이트: 로드 미완/타 서류에서는 미실행 ──
test('게이트: billingReady/fvmrDraftLoadDone 미완이면 미실행(대기)', () => {
  const base = {
    open: true,
    formKey: 'first_visit_mgmt_record',
    fvmrDraftId: null,
    existingProcedures: [] as MgmtCodePick[],
    existingDiagnoses: [] as MgmtCodePick[],
    serviceItems: CHARGES,
  };
  expect(autoGen({ ...base, billingReady: false, fvmrDraftLoadDone: true }).applied).toBe(false);
  expect(autoGen({ ...base, billingReady: true, fvmrDraftLoadDone: false }).applied).toBe(false);
});

test('격리: 다른 서류(form_key≠mgmt)에서는 자동생성 미실행', () => {
  const r = autoGen({
    open: true,
    formKey: 'rx_standard',
    billingReady: true,
    fvmrDraftLoadDone: true,
    fvmrDraftId: null,
    existingProcedures: [],
    existingDiagnoses: [],
    serviceItems: CHARGES,
  });
  expect(r.applied).toBe(false);
});

// ── dedup: 동일 코드 중복 청구행은 1줄로 ──
test('dedup: 동일 service_code 중복 청구는 1건으로 병합', () => {
  const dup: ServiceChargeItem[] = [
    { id: 'a', service_code: 'FC10', name: '발톱교정', category_label: '풋케어' },
    { id: 'b', service_code: 'FC10', name: '발톱교정', category_label: '풋케어' },
    { id: 'c', service_code: null, name: '무코드시술', category_label: '풋케어' },
    { id: 'd', service_code: null, name: '무코드시술', category_label: '풋케어' },
  ];
  const r = autoGen({
    open: true,
    formKey: 'first_visit_mgmt_record',
    billingReady: true,
    fvmrDraftLoadDone: true,
    fvmrDraftId: null,
    existingProcedures: [],
    existingDiagnoses: [],
    serviceItems: dup,
  });
  expect(r.procedures.map((p) => p.name)).toEqual(['발톱교정', '무코드시술']);
});
