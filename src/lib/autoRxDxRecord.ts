// ─────────────────────────────────────────────────────────────────────────────
// T-20260818-foot-PENCHART-AUTORECORD-CRMDATA-DOCFORM-AUTOFILL
//   고객상세 2번차트 [펜차트 자동기록용] 위치에 CRM 데이터(처방약 rx_items·상병코드 dx_items)를
//   화면 진입 시 자동 생성/표시하기 위한 순수 투영 로직 SSOT(React/DOM 무관·단위 테스트 대상).
//
//   ★데이터소스 정본(AC-2) = PaymentMiniWindow 가 저장한 form_submissions(form_key='rx_standard').
//     PaymentMiniWindow.buildCodeEnrichedValues 가 field_data 에 아래를 착지시킨다:
//       - 처방약: field_data.rx_items  = 구조화 leaf [{code,name,total_qty,unit_dose,daily_freq,total_days}]
//                 (T-20260809-foot-PAYMINI-RX-QTY-STRUCTURED-LEAF-RECONCILE AC1, ADDITIVE persist)
//       - 상병코드: field_data.diag_code_N / diag_name_N (N=1..4)
//     ⚠ PaymentDialog(현장 비도달 표면) 값 참조 금지 — 정본은 rx_standard form_submissions 단일 원장.
//
//   ★구조화 우선(AC-4): 처방약은 구조화 rx_items(수량 total_qty 포함)에서 읽는다.
//     구조화 미완(T-20260809 RECONCILE 이전 발행분 = rx_items 배열 부재)인 행은 표시용
//     rx_items_html 스냅샷 파싱(약품명만, 수량 없음)으로 폴백 — 삽입 누락 최소화(dev-foot 판정).
//     폴백 사용 여부는 medicationsFromHtml 플래그로 노출(육안검증·evidence).
//
//   ★read-only 파생(db_change=false·비파괴). 발행 이력 축(form_submissions)만 소비 —
//     medical_charts.prescription_items / prescriptions(dead skeleton) 무접촉(3축 grain 분리 계승).
//   ★PHI 안전: RRN·풀 전화·차트번호 등 field_data 평문 PHI 는 투영 대상에서 제외(화이트리스트 grain).
// ─────────────────────────────────────────────────────────────────────────────

import {
  RX_ISSUANCE_FORM_KEY,
  parseRxMedicationNames,
  type RawFormSubmissionRow,
} from '@/lib/rxIssuanceHistory';

/** 자동기록 처방약 1건(구조화 rx_items leaf 투영). 수량·용법 표시 전용. PHI 아님. */
export interface AutoRxMedication {
  /** 약 코드(services.service_code) — 없으면 null(자유텍스트 약) */
  code: string | null;
  /** 약품명 */
  name: string;
  /** 총 수량(canonical total_qty). 폴백(html 파싱) 시 null. */
  totalQty: string | null;
  /** 1회 투약량(unit_dose) */
  unitDose: string | null;
  /** 1일 투여횟수(daily_freq) */
  dailyFreq: string | null;
  /** 총 투약일수(total_days) */
  totalDays: string | null;
}

/** 자동기록 상병코드 1건(diag_code_N/diag_name_N 투영). PHI 아님(상병 표시). */
export interface AutoDxCode {
  code: string | null;
  name: string | null;
}

/** 발행 1건(form_submission) 단위 자동기록 레코드 — 처방약·상병코드 묶음. */
export interface AutoRxDxRecord {
  /** form_submissions.id (안정 key) */
  key: string;
  /** 교부일 — field_data.issue_date 우선, 없으면 printed_at/created_at 폴백('YYYY-MM-DD' 파트) */
  issuedAt: string | null;
  /** 교부번호 — field_data.issue_no */
  issueNo: string | null;
  /** 처방의료인 — field_data.prescriber_name */
  prescriberName: string | null;
  /** 상병코드(코드+명) 목록 */
  diagnoses: AutoDxCode[];
  /** 처방약 목록 */
  medications: AutoRxMedication[];
  /** true = 구조화 rx_items 부재로 rx_items_html 파싱 폴백(수량 없음) */
  medicationsFromHtml: boolean;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** ISO/타임스탬프/도트포맷 → 'YYYY-MM-DD' 날짜 파트. 파싱 실패 시 원문 반환(표시 안전). */
export function autoRxDxDateKey(v: string | null | undefined): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = /^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})/.exec(s);
  if (dotted) return `${dotted[1]}-${dotted[2].padStart(2, '0')}-${dotted[3].padStart(2, '0')}`;
  return s;
}

/** field_data 의 상병(diag_code_1..4 / diag_name_1..4) → AutoDxCode[]. 코드·명 둘 다 없는 인덱스는 skip. */
function extractDiagnoses(fd: Record<string, unknown>): AutoDxCode[] {
  const out: AutoDxCode[] = [];
  for (let i = 1; i <= 4; i++) {
    const code = str(fd[`diag_code_${i}`]);
    const name = str(fd[`diag_name_${i}`]);
    if (!code && !name) continue;
    out.push({ code, name });
  }
  return out;
}

/** 구조화 rx_items leaf 1건 → AutoRxMedication. 이름 없는(빈) leaf 는 null. */
function projectStructuredMed(raw: unknown): AutoRxMedication | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = str(o.name);
  if (!name) return null;
  return {
    code: str(o.code),
    name,
    // canonical 수량 키 = total_qty (bare count/quantity/qty 금지 — RECONCILE AC3).
    totalQty: str(o.total_qty),
    unitDose: str(o.unit_dose),
    dailyFreq: str(o.daily_freq),
    totalDays: str(o.total_days),
  };
}

/**
 * 단일 form_submissions(rx_standard) 행 → AutoRxDxRecord 투영(화이트리스트 grain).
 *   - 처방약: 구조화 rx_items 우선(AC-4), 부재 시 rx_items_html 파싱 폴백(수량 없음).
 *   - 상병코드: diag_code_N/diag_name_N.
 *   - 처방약·상병코드 둘 다 비면 null(빈 레코드 제외 — AC-3 빈칸/미표시).
 */
export function projectAutoRxDxRecord(r: RawFormSubmissionRow): AutoRxDxRecord | null {
  const id = str(r.id);
  if (!id) return null;
  const fd = (r.field_data ?? {}) as Record<string, unknown>;

  const diagnoses = extractDiagnoses(fd);

  let medications: AutoRxMedication[] = [];
  let fromHtml = false;
  const structured = Array.isArray(fd.rx_items) ? (fd.rx_items as unknown[]) : null;
  if (structured && structured.length > 0) {
    medications = structured.map(projectStructuredMed).filter((m): m is AutoRxMedication => m !== null);
  }
  // AC-4 폴백: 구조화 leaf 가 (없거나 전부 빈) 경우에만 html 스냅샷 파싱(약품명만).
  if (medications.length === 0) {
    const names = parseRxMedicationNames(fd.rx_items_html);
    if (names.length > 0) {
      fromHtml = true;
      medications = names.map((name) => ({
        code: null,
        name,
        totalQty: null,
        unitDose: null,
        dailyFreq: null,
        totalDays: null,
      }));
    }
  }

  if (diagnoses.length === 0 && medications.length === 0) return null;

  return {
    key: id,
    issuedAt: autoRxDxDateKey(str(fd.issue_date) ?? r.printed_at ?? r.created_at ?? null),
    issueNo: str(fd.issue_no),
    prescriberName: str(fd.prescriber_name),
    diagnoses,
    medications,
    medicationsFromHtml: fromHtml,
  };
}

/** join 결과가 배열/객체 둘 다로 올 수 있어 form_key 안전 추출. */
function extractFormKey(ft: RawFormSubmissionRow['form_templates']): string | null {
  if (!ft) return null;
  const obj = Array.isArray(ft) ? ft[0] : ft;
  return (obj?.form_key as string | undefined) ?? null;
}

/**
 * form_submissions(rx_standard) 조회 결과 → AutoRxDxRecord[] (교부일 최신순).
 *
 * @param rows        form_submissions select 결과 (id/printed_at/created_at/field_data/form_templates)
 * @param preFiltered 이미 form_key='rx_standard' 로 필터된 결과면 true. false 면 방어 필터(rx_standard 만 통과).
 *
 * - 처방약·상병코드가 모두 빈 행은 제외(빈 레코드 미표시 — AC-3).
 * - 정렬 = 교부일 내림차순(최신 먼저). 파싱 불가(null)는 맨 뒤.
 */
export function buildAutoRxDxRecords(
  rows: RawFormSubmissionRow[] | null | undefined,
  preFiltered = true,
): AutoRxDxRecord[] {
  if (!rows || rows.length === 0) return [];
  const out: AutoRxDxRecord[] = [];
  for (const r of rows) {
    if (!preFiltered) {
      const fd = (r.field_data ?? {}) as Record<string, unknown>;
      const key = extractFormKey(r.form_templates) ?? str(fd.form_key);
      if (key !== RX_ISSUANCE_FORM_KEY) continue;
    }
    const rec = projectAutoRxDxRecord(r);
    if (rec) out.push(rec);
  }
  out.sort((a, b) => {
    const da = a.issuedAt;
    const db = b.issuedAt;
    if (da === db) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? 1 : -1;
  });
  return out;
}

/** 처방약 1건 표시 문자열 — '약품명 ×수량 (1회 unit_dose · 1일 daily_freq회 · total_days일)'. 수량/용법 없으면 생략. */
export function formatAutoRxMedication(m: AutoRxMedication): string {
  let head = m.name;
  if (m.totalQty && m.totalQty !== '1') head += ` ×${m.totalQty}`;
  const dose: string[] = [];
  if (m.unitDose) dose.push(`1회 ${m.unitDose}`);
  if (m.dailyFreq) dose.push(`1일 ${m.dailyFreq}회`);
  if (m.totalDays) dose.push(`${m.totalDays}일분`);
  return dose.length > 0 ? `${head} (${dose.join(' · ')})` : head;
}

/** 상병코드 1건 표시 문자열 — '코드 명' / '명' / '코드'. */
export function formatAutoDxCode(d: AutoDxCode): string {
  if (d.code && d.name) return `${d.code} ${d.name}`;
  return d.name ?? d.code ?? '';
}
