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
  /** form_submissions.customer_id (customers PK FK) — 2번차트 오픈 대상 식별자(T-20260807-RXHISTORY-TAB-4IMPROVE AC-3). */
  customer_id?: string | null;
  customers?:
    | { name?: string | null; chart_number?: string | null }
    | { name?: string | null; chart_number?: string | null }[]
    | null;
}

/** 발행 이력 1건 + 환자 표시필드(성함·차트번호 화이트리스트). RRN·풀 전화 미포함. */
export interface RxIssuancePatientRow extends RxIssuanceRow {
  /** form_submissions.customer_id (customers PK) — 성함/차트번호 클릭→2번차트 오픈 식별자(AC-3). PHI 아님(내부 UUID). */
  customer_id: string | null;
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
      customer_id: str(r.customer_id),
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

// ─────────────────────────────────────────────────────────────────────────────
// T-20260807-foot-RXHISTORY-TAB-4IMPROVE — 처방이력 탭 4대 개선 (AC-1 월별필터 / AC-2 실처방 dedup / AC-4 대표+기타)
//
// ★ AC-2 DB 조사 결론(canonical 기준 컬럼 특정): "실제 약 처방 나간 건"의 별도 canonical 컬럼/테이블은
//   존재하지 않는다. 처방 도메인 SSOT = form_submissions(form_key='rx_standard') = 처방전 '발행/출력' 이력
//   단일 원장(DA-20260806-foot-RX-PERSIST-SSOT Option B). prescriptions/prescription_items = dead skeleton
//   (되살리기 금지). 따라서 "출력 이력" vs "실제 처방"의 구분은 **신규 컬럼/canonical write/스키마 변경 없이**
//   순수 read-side 집계(dedup)로 충족한다: 동일 환자 · 동일 교부일(날짜) · 동일 약품집합 = 실처방 1건.
//   ⇒ db_change=false 유지, data-architect CONSULT 불요.
// ─────────────────────────────────────────────────────────────────────────────

/** issued_at(타임스탬프/ISO) → 'YYYY-MM-DD' 날짜 파트(dedup·필터 키). 파싱 실패 시 null. */
export function rxIssuedDateKey(issued_at: string | null | undefined): string | null {
  const s = str(issued_at);
  if (!s) return null;
  // ISO/타임스탬프 앞 10글자(YYYY-MM-DD) 우선 — 로컬 TZ 변환 없이 문자열 파트로 안정 추출.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 'YYYY.MM.DD' 등 대체 포맷 방어.
  const dotted = /^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})/.exec(s);
  if (dotted) {
    return `${dotted[1]}-${dotted[2].padStart(2, '0')}-${dotted[3].padStart(2, '0')}`;
  }
  return null;
}

/** 약품집합을 순서 무관 정규화 키로(재출력 시 약품 나열 순서 달라도 동일건 판정). */
function medSetKey(medications: readonly string[]): string {
  return medications
    .map((m) => m.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .join('');
}

/**
 * AC-1 월별/기간 필터 — 교부일(issued_at 의 날짜 파트)이 [from, to] 구간(포함)에 드는 행만 통과.
 * from/to = 'YYYY-MM-DD'. issued_at 날짜 파싱 불가 행은 제외(기간 특정 불가).
 */
export function filterRxRowsByDateRange<T extends Pick<RxIssuanceRow, 'issued_at'>>(
  rows: T[] | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): T[] {
  if (!rows || rows.length === 0) return [];
  const lo = str(from);
  const hi = str(to);
  if (!lo && !hi) return rows.slice();
  return rows.filter((r) => {
    const d = rxIssuedDateKey(r.issued_at);
    if (!d) return false;
    if (lo && d < lo) return false;
    if (hi && d > hi) return false;
    return true;
  });
}

/**
 * AC-2 실처방 기준 중복 자동제거 — "발행문서(처방전) 1건" 단위로 집계.
 *
 * ★ T-20260807-foot-RXHIST-BARTOVEN-QTY2-DEDUP-DISPLAY (P1 회귀 수정): 실처방 식별자 = 교부번호(issue_no).
 *   - 교부번호가 다르면 별개 발행 → 병합 금지(과수렴 차단). 같은 날 같은 약이라도 별개 교부번호면 각 1건.
 *   - 교부번호가 같은 여러 form_submission = 동일 문서 재출력 → 1건 병합(출력 횟수 카운트 아님, AC-2 본래 의도).
 *   - 초안 등 교부번호 미부여(issue_no=NULL)만 폴백으로 (교부일+약품집합) 키(확정 발행과 섞지 않음).
 * 순서 = 입력 순서(printed_at desc)의 첫 등장 행을 대표로 유지(안정).
 * 반환 행에 dup_count(병합된 발행 건수 = 재출력 횟수) 부여 — dup_count>1 은 UI 에 '재출력 N회'로 표기.
 *
 * ★ T-20260808-foot-RXHIST-HIDE-SOFTDELETE: member_ids(이 대표 행으로 병합된 모든 form_submissions.id).
 *   숨김(soft-delete) 시 대표 1건만 지우면 동일 교부번호 재출력 sibling 이 refetch 후 새 대표로 되살아남 →
 *   AC-2(영속 숨김) 위반. 따라서 숨김은 member_ids 전량을 soft-delete 해야 한다.
 */
export function dedupeRxIssuanceRows(
  rows: RxIssuancePatientRow[] | null | undefined,
): (RxIssuancePatientRow & { dup_count: number; member_ids: string[] })[] {
  if (!rows || rows.length === 0) return [];
  const byKey = new Map<string, RxIssuancePatientRow & { dup_count: number; member_ids: string[] }>();
  for (const r of rows) {
    const patientKey = r.customer_id ?? r.chart_number ?? r.patient_name ?? '?';
    // ★ T-20260807-foot-RXHIST-BARTOVEN-QTY2-DEDUP-DISPLAY (P1 회귀 수정):
    //   실처방(발행문서) 고유 식별자 = 교부번호(issue_no). 교부번호가 다르면 별개 발행 → 병합 금지
    //   (RC: 같은 날 같은 약을 서로 다른 교부번호로 2건 발행[김병완 F-4741]이 medSetKey 병합으로 1건 과수렴).
    //   교부번호 동일 = 동일 문서 재출력 → 1건. 초안(issue_no=NULL)만 (교부일+약품집합) 폴백(확정발행과 미혼합).
    const issueNo = str(r.issue_no);
    const docKey = issueNo
      ? `no:${issueNo}`
      : `set:${rxIssuedDateKey(r.issued_at) ?? '?'}:${medSetKey(r.medications)}`;
    const key = `${patientKey}|${docKey}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.dup_count += 1;
      existing.member_ids.push(r.id);
    } else {
      byKey.set(key, { ...r, dup_count: 1, member_ids: [r.id] });
    }
  }
  return Array.from(byKey.values());
}

/**
 * AC-4 대표+기타 분리 — 선택된 약품(대표) vs 같은 처방에 함께 나간 그 외 약품(기타).
 *   representative = 행의 약품 중 선택집합에 든 것(선택 순 유지 위해 selected 순서 우선).
 *   others        = 행의 약품 중 선택집합에 들지 않은 나머지(원 순서 유지).
 * 선택 0개면 representative=[] , others=행 전체 약품(대표 컬럼 미사용 기본 표시).
 */
export function splitRepresentativeMedications(
  medications: readonly string[],
  selected: readonly string[] | null | undefined,
): { representative: string[]; others: string[] } {
  const sel = new Set((selected ?? []).map((m) => m.trim()).filter(Boolean));
  if (sel.size === 0) return { representative: [], others: [...medications] };
  const representative: string[] = [];
  const others: string[] = [];
  for (const m of medications) {
    if (sel.has(m.trim())) representative.push(m);
    else others.push(m);
  }
  return { representative, others };
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
