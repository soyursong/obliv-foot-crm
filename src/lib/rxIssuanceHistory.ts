// ─────────────────────────────────────────────────────────────────────────────
// T-20260806-foot-RX-PERSIST-FORWARDFIX — 풋 처방전 발행 이력 canonical SSOT 조회 헬퍼
//
// ★ canonical SSOT = form_submissions (doc_type=처방전 = form_key 'rx_standard').
//   DA-20260806-foot-RX-PERSIST-SSOT (Option B CONFIRM / Option A REJECT):
//     - 처방전 발행 이력의 단일 원장 = form_submissions (494건 발행·유실0·published-immutable).
//     - `prescriptions` / `prescription_items` 테이블 = dead skeleton — INSERT 코드 전무.
//       ⇒ 조회/write 경로를 신설하지 말 것(dual-source-of-truth drift 안티패턴). 되살리기 금지.
//     - 이 파일은 발행 이력을 form_submissions 에서만 읽는 read-only 투영(ADDITIVE). write 0.
//
// 3축 grain 분리 (VG3, scalp2 canon 계승 — 조인 오염 금지):
//   services(약 마스터) ⊥ medical_charts.prescription_items(처방 기록) ⊥ form_submissions(발행 이력).
//   본 헬퍼는 **발행 이력 축(form_submissions)만** 소비한다. prescription_items(처방 기록 축) 조인 금지.
//
// PHI 안전 (VG2, §16-3a/§16-4):
//   field_data JSON 에는 patient_rrn(주민번호)·환자 전화·차트번호 등 PHI 평문이 들어있다.
//   투영은 **화이트리스트**(교부일·처방의료인·진단·교부번호·약품명)만 뽑는다 — RRN/풀 전화/차트번호는
//   UI 로 절대 흘리지 않는다(원본 field_data 를 그대로 state 에 담지 말 것).
// ─────────────────────────────────────────────────────────────────────────────

/** 처방전 doc_type discriminator (form_submissions ↔ form_templates.form_key). VG1 필터 SSOT. */
export const RX_ISSUANCE_FORM_KEY = 'rx_standard' as const;

/** 발행 이력 축(form_submissions)에서 투영한 처방전 1건. PHI 화이트리스트 grain(발행 이력 목록). */
export interface RxIssuanceRow {
  /** form_submissions.id */
  id: string;
  /** 교부일 — field_data.issue_date 우선, 없으면 printed_at/created_at 폴백 */
  issued_at: string | null;
  /** 처방의료인 성명 — field_data.prescriber_name */
  prescriber_name: string | null;
  /** 진단 — diag_name_1..4 (+ 코드) 합본. PHI 아님(상병 표시) */
  diagnosis: string | null;
  /** 교부번호 — field_data.issue_no */
  issue_no: string | null;
  /** 처방 의약품명(표시 전용) — field_data.rx_items_html 스냅샷에서 파싱 */
  medications: string[];
}

/** form_submissions 원시 행(조회 select 결과). form_templates 는 inner join 결과. */
export interface RawFormSubmissionRow {
  id?: string | null;
  printed_at?: string | null;
  created_at?: string | null;
  field_data?: Record<string, unknown> | null;
  form_templates?: { form_key?: string | null } | { form_key?: string | null }[] | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260807-foot-TREATTBL-RX-HISTORY-BYDRUG-LOOKUP — 약별 처방 이력 조회(치료테이블 '처방 이력' 탭)
//   위 mapRxIssuanceRows(환자별 차트 축, CustomerChartPage)와 동일 canonical SSOT(form_submissions
//   rx_standard·발행 이력 축)를 소비하되, '약별로 조회'하기 위해 (a) 환자 표시필드(성함·차트번호)를
//   화이트리스트로 추가 투영하고, (b) 발행 약품명을 distinct 집계해 드롭다운 소스로 제공한다.
//
//   PHI 안전(VG2 계승): patient_rrn(주민번호)·풀 전화는 여전히 투영 금지. 성함·차트번호만 추가 —
//     본 화면은 스태프 대상 치료테이블(role-gated)이므로 성함·차트번호 노출 허용(고객목록 export 동일 기준,
//     티켓 risk_reason WARN(a)). field_data 원본을 state 로 노출하지 않는다(화이트리스트 grain 유지).
//   3축 grain 분리 계승: 발행 이력 축(form_submissions)만 소비. medical_charts.prescription_items 조인 0.
// ─────────────────────────────────────────────────────────────────────────────

/** customers 임베드 포함 form_submissions 원시 행. customers = FK(customer_id) 임베디드 리소스(객체/배열). */
export interface RawFormSubmissionWithCustomerRow extends RawFormSubmissionRow {
  customers?:
    | { name?: string | null; chart_number?: string | null }
    | { name?: string | null; chart_number?: string | null }[]
    | null;
}

/** 발행 이력 1건 + 환자 표시필드(성함·차트번호 화이트리스트). RRN·풀 전화 미포함. */
export interface RxIssuancePatientRow extends RxIssuanceRow {
  /** customers.name — 성함(스태프 대상 노출 허용) */
  patient_name: string | null;
  /** customers.chart_number — 차트번호(스태프 대상 노출 허용) */
  chart_number: string | null;
}

/** 임베디드 customers(객체/배열) 안전 추출. */
function extractCustomer(
  c: RawFormSubmissionWithCustomerRow['customers'],
): { name?: string | null; chart_number?: string | null } | null {
  if (!c) return null;
  return Array.isArray(c) ? (c[0] ?? null) : c;
}

/** 단일 form_submissions 행 → RxIssuanceRow 투영(화이트리스트 grain). 내부 재사용. */
function projectRxRow(r: RawFormSubmissionRow): RxIssuanceRow | null {
  const fd = (r.field_data ?? {}) as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    issued_at: str(fd.issue_date) ?? r.printed_at ?? r.created_at ?? null,
    prescriber_name: str(fd.prescriber_name),
    diagnosis: composeDiagnosis(fd),
    issue_no: str(fd.issue_no),
    medications: parseRxMedicationNames(fd.rx_items_html),
  };
}

/**
 * form_submissions(+customers 임베드) → RxIssuancePatientRow[] (발행 이력 축·성함·차트번호 화이트리스트 투영).
 *
 * VG1: form_key='rx_standard' 만 통과(preFiltered=false 면 방어 필터). VG2: RRN·풀 전화 미투영(성함·차트만 추가).
 */
export function mapRxIssuancePatientRows(
  rows: RawFormSubmissionWithCustomerRow[] | null | undefined,
  preFiltered = true,
): RxIssuancePatientRow[] {
  if (!rows || rows.length === 0) return [];
  const out: RxIssuancePatientRow[] = [];
  for (const r of rows) {
    const fd = (r.field_data ?? {}) as Record<string, unknown>;
    if (!preFiltered) {
      const key = extractFormKey(r.form_templates) ?? str(fd.form_key);
      if (key !== RX_ISSUANCE_FORM_KEY) continue;
    }
    const base = projectRxRow(r);
    if (!base) continue;
    const cust = extractCustomer(r.customers);
    out.push({
      ...base,
      patient_name: str(cust?.name),
      chart_number: str(cust?.chart_number),
    });
  }
  return out;
}

/**
 * 발행 이력 행들에서 처방된 의약품명을 distinct 집계(드롭다운 소스). 정렬 = ko 로케일 오름차순.
 * medications 는 parseRxMedicationNames 산출(표시 전용·best-effort).
 */
export function collectDistinctMedications(
  rows: Pick<RxIssuanceRow, 'medications'>[] | null | undefined,
): string[] {
  if (!rows || rows.length === 0) return [];
  const set = new Set<string>();
  for (const r of rows) {
    for (const m of r.medications) {
      const name = m.trim();
      if (name) set.add(name);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 특정 약품명을 처방(발행)받은 행만 필터. 정확 일치(약명 전체) 기준. (단일 선택 = 복수 선택의 1-원소 특수형) */
export function filterRxRowsByMedication<T extends Pick<RxIssuanceRow, 'medications'>>(
  rows: T[] | null | undefined,
  medication: string | null,
): T[] {
  return filterRxRowsByMedications(rows, medication ? [medication] : []);
}

/**
 * 복수 약품명(합집합/OR) 필터 — 선택된 약 중 **하나라도** 처방(발행)된 행을 통과.
 *   T-20260807-foot-RXHIST-DRUG-MULTISELECT: 단일→복수 선택 확장.
 *   행 grain = 발행 1건(form_submission.id, 고유) → 합집합해도 행 중복 없음(한 발행이 여러 선택약을
 *   모두 포함해도 1행). 화면·엑셀 동일 규칙(동일 rows 소비) — AC2/AC5.
 *   선택 0개(빈 배열) = 조회 대상 없음(미선택 기본 동작, 기존과 동일) — AC6.
 */
export function filterRxRowsByMedications<T extends Pick<RxIssuanceRow, 'medications'>>(
  rows: T[] | null | undefined,
  medications: readonly string[] | null | undefined,
): T[] {
  if (!rows || rows.length === 0 || !medications || medications.length === 0) return [];
  const sel = new Set(medications.filter((m) => m && m.trim()));
  if (sel.size === 0) return [];
  return rows.filter((r) => r.medications.some((m) => sel.has(m)));
}

/** join 결과가 배열/객체 둘 다로 올 수 있어(임베디드 리소스) form_key 를 안전 추출. */
function extractFormKey(ft: RawFormSubmissionRow['form_templates']): string | null {
  if (!ft) return null;
  const obj = Array.isArray(ft) ? ft[0] : ft;
  return (obj?.form_key as string | undefined) ?? null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * rx_items_html 스냅샷(buildRxItemsHtml 산출물)에서 약품명만 파싱.
 * 표시 전용·best-effort. 형식 = 각 <tr> 의 첫 <td>(약품명 셀). 빈 행(패딩 10행)은 제외.
 * ⚠ buildRxItemsHtml(htmlFormTemplates.ts) 출력 구조에 결합 — 그 형식 변경 시 함께 갱신.
 */
export function parseRxMedicationNames(rxItemsHtml: unknown): string[] {
  if (typeof rxItemsHtml !== 'string' || rxItemsHtml.trim() === '') return [];
  const names: string[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/i;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(rxItemsHtml)) !== null) {
    const firstCell = cellRe.exec(m[1]);
    if (!firstCell) continue;
    const text = firstCell[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .trim();
    if (text) names.push(text);
  }
  return names;
}

/** field_data 의 상병(diag_name_1..4 + diag_code) 을 표시용 문자열로 합본. PHI 아님. */
function composeDiagnosis(fd: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const name = str(fd[`diag_name_${i}`]);
    const code = str(fd[`diag_code_${i}`]);
    if (!name && !code) continue;
    parts.push(code && name ? `${code} ${name}` : (name ?? code ?? ''));
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * form_submissions 조회 결과 → RxIssuanceRow[] (발행 이력 축·PHI 화이트리스트 투영).
 *
 * @param rows        form_submissions select 결과 (id/printed_at/created_at/field_data/form_templates)
 * @param preFiltered 이미 form_key='rx_standard' 로 필터된 결과면 true(inner join 필터). false 면 여기서 방어 필터.
 *
 * VG1: form_key='rx_standard' 만 통과(타 서식 — 소견서/KOH/진단서 혼입 0).
 * VG2: RRN·풀 전화·차트번호 등 PHI 는 투영 대상에서 제외(화이트리스트).
 */
export function mapRxIssuanceRows(
  rows: RawFormSubmissionRow[] | null | undefined,
  preFiltered = true,
): RxIssuanceRow[] {
  if (!rows || rows.length === 0) return [];
  const out: RxIssuanceRow[] = [];
  for (const r of rows) {
    const fd = (r.field_data ?? {}) as Record<string, unknown>;
    // VG1 방어 필터 — inner join 미사용 경로일 때 form_key/field_data.form_key 로 처방전만 통과.
    if (!preFiltered) {
      const key = extractFormKey(r.form_templates) ?? str(fd.form_key);
      if (key !== RX_ISSUANCE_FORM_KEY) continue;
    }
    const id = str(r.id);
    if (!id) continue;
    out.push({
      id,
      issued_at: str(fd.issue_date) ?? r.printed_at ?? r.created_at ?? null,
      prescriber_name: str(fd.prescriber_name),
      diagnosis: composeDiagnosis(fd),
      issue_no: str(fd.issue_no),
      medications: parseRxMedicationNames(fd.rx_items_html),
    });
  }
  return out;
}
