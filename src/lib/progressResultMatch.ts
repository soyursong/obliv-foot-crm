/**
 * T-20260702-foot-PROGRESS-CSV-BULKRESULT
 * 경과분석 외부분석 결과이미지 일괄업로드 → 환자 자동매칭 순수 유틸 (무의존, 단위테스트 가능).
 *
 * SSOT = DA-20260718-foot-PROGRESS-BULKRESULT-AUTOMATCH 데이터 계약
 *   (_silver/2026-07-18/da_decision_foot_progress_bulkresult_automatch_contract_20260718.md).
 *
 * 오매칭 방지 가드 6종(§5) 중 데이터-로직 부분을 여기서 구현:
 *   G1 chart_no 단독 조인키(이름 조인 금지)      → matchOne() 은 chartNo 로만 customer 조회.
 *   G2 이름 = 대조 가드, 불일치→수동 confirm      → resolveMatch() NAME-MISMATCH 분기.
 *   G3 chart_no 미존재 → 환자 자동생성 금지        → resolveMatch() NO-MATCH = 수동 UI(생성 없음).
 *   G4 파싱 실패 → 수동 UI, fuzzy 추측 금지         → parseResultFilename() strict.
 *   (G5 apply 前 미리보기 사람게이트, G6 감사로그  → 호출부 Dialog 책임.)
 *
 * fail-closed 원칙(§3): 확신 없으면 자동첨부 안 하고 수동 UI 로 폴백. under-correct ≫ mis-assign.
 */

/** 결과이미지 허용 확장자(임상 이미지). */
export const RESULT_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
export const RESULT_IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** 파일 확장자 소문자 추출(점 뒤). 없으면 ''. */
export function fileExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export function extToMime(ext: string): string | null {
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * chart_no 정규화 (OPEN ITEM ② — 현장 확정 전 잠정 규칙).
 * 보수적: 앞뒤 공백 제거 + 내부 공백 제거 + 전각→반각 숫자. 대소문자·선행0 은 보존
 *   (선행0/prefix 는 customers.chart_number 저장값과 exact 대조가 원칙 — 함부로 깎지 않음).
 * ⚠ 표기편차·오타 정규화 확정 규칙은 현장 confirm(OPEN ITEM ②) 수신 후 강화. 현재는 무손실 최소 정규화.
 */
export function normalizeChartNo(raw: string | null | undefined): string {
  if (raw == null) return '';
  let s = String(raw).trim();
  // 전각 숫자 → 반각.
  s = s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30));
  // 내부 공백 제거(토큰 사이 우발 공백).
  s = s.replace(/\s+/g, '');
  return s;
}

/**
 * 이름 대조용 정규화(G2). 조인키 아님 — 오매칭 가드 전용.
 * derm CUSTNAME-PRONUN 선례: 공백·괄호발음병기 strip 후 관대 비교.
 *   "홍길동 (홍 길 동)" / "홍길동（Hong）" → "홍길동".
 */
export function normalizeNameForCompare(name: string | null | undefined): string {
  if (name == null) return '';
  return String(name)
    .replace(/[()（）[\]{}].*?$/g, '') // 괄호 이후(발음병기) 제거 — 첫 괄호부터 끝까지.
    .replace(/\s+/g, '')               // 모든 공백 제거.
    .trim()
    .toLowerCase();
}

/** ISO 8자리(YYYYMMDD) 또는 YYYY-MM-DD → 'YYYY-MM-DD'. 유효하지 않으면 null. */
export function normalizeVisitDate(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = String(token).trim();
  let y: string, m: string, d: string;
  const m8 = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  const mDash = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m8) {
    [, y, m, d] = m8;
  } else if (mDash) {
    [, y, m, d] = mDash;
  } else {
    return null;
  }
  const iso = `${y}-${m}-${d}`;
  // 실제 유효 날짜 검증(2026-02-31 등 배제).
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (
    dt.getUTCFullYear() !== Number(y) ||
    dt.getUTCMonth() + 1 !== Number(m) ||
    dt.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return iso;
}

export interface ParsedResultName {
  ok: boolean;
  patientName: string;     // 파일명 1번째 토큰(대조용, raw)
  chartNoRaw: string;      // 파일명 2번째 토큰(raw)
  chartNo: string;         // 정규화된 chart_no
  visitDate: string | null; // 정규화 'YYYY-MM-DD'
  reason?: string;         // 실패 사유(PARSE-FAIL 상세)
}

/**
 * 파일명 strict 파싱: `{이름}_{차트번호}_{날짜}.{ext}` (§3-1). fuzzy 추측 금지(G4).
 * - 확장자 제거 후 '_' 로 분할 → 정확히 3토큰이어야 함.
 *   토큰 수 불일치(언더스코어 과다/부족) → PARSE-FAIL.
 * - 날짜 토큰 미파싱 → PARSE-FAIL.
 * - 이름/차트번호 빈 값 → PARSE-FAIL.
 */
export function parseResultFilename(fileName: string): ParsedResultName {
  const fail = (reason: string): ParsedResultName => ({
    ok: false, patientName: '', chartNoRaw: '', chartNo: '', visitDate: null, reason,
  });
  if (!fileName) return fail('빈 파일명');

  const ext = fileExt(fileName);
  if (!RESULT_IMAGE_EXT.has(ext)) return fail(`허용 확장자 아님(${ext || '없음'})`);

  const base = fileName.slice(0, fileName.length - ext.length - 1); // 확장자·점 제거.
  const tokens = base.split('_');
  if (tokens.length !== 3) {
    return fail(`파일명 형식 오류(이름_차트번호_날짜 아님, 토큰 ${tokens.length}개)`);
  }
  const [name, chartRaw, dateTok] = tokens;
  if (!name.trim()) return fail('이름 토큰 비어있음');
  if (!chartRaw.trim()) return fail('차트번호 토큰 비어있음');

  const visitDate = normalizeVisitDate(dateTok);
  if (!visitDate) return fail(`날짜 파싱 실패(${dateTok})`);

  return {
    ok: true,
    patientName: name.trim(),
    chartNoRaw: chartRaw.trim(),
    chartNo: normalizeChartNo(chartRaw),
    visitDate,
    reason: undefined,
  };
}

/** 결과이미지 SHA-256 content-hash(hex) — §4 dedup/멱등키 요소. crypto.subtle(브라우저). */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 매칭 상태(§3 fail-closed 결정 트리 결과).
 *  - parse_fail   : 파일명 파싱 실패 → 수동 UI (G4)
 *  - no_match     : chart_no 미존재 → 수동 UI, 환자 자동생성 금지 (G3)
 *  - name_mismatch: chart_no 존재하나 이름 불일치 → 자동첨부 차단, 수동 confirm (G2)
 *  - auto         : chart_no 일치 + 이름 일치 + 해당일 방문 존재 → 자동첨부 가능
 *  - flagged      : chart_no·이름 일치하나 해당일 방문기록 없음 → soft-flag 첨부 허용(§3-4)
 */
export type ResultMatchStatus = 'parse_fail' | 'no_match' | 'name_mismatch' | 'auto' | 'flagged';

export interface CustomerLite {
  id: string;
  name: string | null;
  chart_number: string | null;
}

export interface ResolveMatchInput {
  parsed: ParsedResultName;
  /** normalizeChartNo(chart_number) → CustomerLite. 동일 정규화 chart_no 다건이면 배열. */
  customersByChartNo: Map<string, CustomerLite[]>;
  /** 매칭된 customer 의 (customerId → visit_date set) — 해당일 방문/시술 존재 판정용. */
  visitsByCustomer: Map<string, Set<string>>;
}

export interface ResolveMatchResult {
  status: ResultMatchStatus;
  customer: CustomerLite | null;
  /** 사람이 읽는 사유/안내. */
  detail: string;
}

/**
 * 결정적·fail-closed 매칭 해석(§3). 자동은 오직 (chart_no 단독조인 + 이름일치 + 방문존재)일 때만.
 * 동명 정규화 chart_no 가 2건 이상이면 결정 불가 → name_mismatch(수동 confirm)로 안전 폴백.
 */
export function resolveMatch(input: ResolveMatchInput): ResolveMatchResult {
  const { parsed, customersByChartNo, visitsByCustomer } = input;

  if (!parsed.ok) {
    return { status: 'parse_fail', customer: null, detail: parsed.reason ?? '파일명 파싱 실패' };
  }

  // G1: chart_no 단독 조인.
  const candidates = customersByChartNo.get(parsed.chartNo) ?? [];
  if (candidates.length === 0) {
    // G3: 자동생성 금지 — 수동 UI.
    return { status: 'no_match', customer: null, detail: `차트번호 ${parsed.chartNoRaw} 미존재 (수동 매칭 필요)` };
  }
  if (candidates.length > 1) {
    // chart_no 정규화 충돌(표기편차) — 결정 불가 → 안전 폴백(수동 confirm).
    return {
      status: 'name_mismatch',
      customer: null,
      detail: `차트번호 ${parsed.chartNoRaw} 중복 후보 ${candidates.length}건 (수동 확인 필요)`,
    };
  }

  const cust = candidates[0];
  // G2: 이름 대조(조인키 아님).
  const nameFile = normalizeNameForCompare(parsed.patientName);
  const nameDb = normalizeNameForCompare(cust.name);
  if (nameFile !== nameDb) {
    return {
      status: 'name_mismatch',
      customer: cust,
      detail: `이름 불일치 (파일 '${parsed.patientName}' ≠ 차트 '${cust.name ?? ''}') — 수동 확인 필요`,
    };
  }

  // 방문 존재 판정(§3-4).
  const visits = visitsByCustomer.get(cust.id);
  const hasVisit = !!visits && !!parsed.visitDate && visits.has(parsed.visitDate);
  if (hasVisit) {
    return { status: 'auto', customer: cust, detail: `자동매칭 (${cust.name} · ${parsed.visitDate})` };
  }
  // soft-flag: 결과가 방문기록 확정보다 먼저 도착 가능 → 첨부 허용 + 표시.
  return {
    status: 'flagged',
    customer: cust,
    detail: `매칭 방문 없음 (${cust.name} · ${parsed.visitDate}) — 첨부 가능(방문기록 확인 요망)`,
  };
}

/**
 * PHI 첨부 감사로그(§5 G6). apply 실행 시 actor·시각·대상·매칭방식 기록.
 * progressTreatmentCsv.logProgressCsvExport 선례와 동일 — 안정 prefix 로 관측/수집.
 */
export interface ResultBulkAuditMeta {
  actor: string | null;
  actorRole?: string | null;
  clinicId?: string | null;
  fileName: string;
  chartNo: string;
  visitDate: string | null;
  contentHash: string;
  matchedBy: 'auto' | 'manual';
  /** DB progress_result_images.match_status (auto|manual|flagged). */
  matchStatus: 'auto' | 'manual' | 'flagged';
  customerId: string | null;
}

export function logProgressResultAttach(meta: ResultBulkAuditMeta): void {
  const record = {
    tag: '[PHI-AUDIT][progress-result-attach]',
    at: new Date().toISOString(),
    actor: meta.actor ?? '(unknown)',
    actorRole: meta.actorRole ?? null,
    clinicId: meta.clinicId ?? null,
    fileName: meta.fileName,
    chartNo: meta.chartNo,
    visitDate: meta.visitDate,
    contentHash: meta.contentHash.slice(0, 12),
    matchedBy: meta.matchedBy,
    matchStatus: meta.matchStatus,
    customerId: meta.customerId,
  };
  console.info(record.tag, JSON.stringify(record));
}
