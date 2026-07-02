/**
 * T-20260702-foot-PROGRESS-CSV-EXPORT
 * 경과분석 탭 '시술기록 CSV 다운로드' 유틸리티 (무의존 — 외부 라이브러리 없음).
 *
 * 데이터 계약(착수-직후 feasibility 검증 결과, 봇 DB확인 ts:1782980933 + dev-foot 재검증):
 *   grain = 환자 × 방문(시술일) × 시술타입 → 1행.
 *   근거 테이블 = package_sessions (status='used', deleted_at IS NULL) 1건 = 1행.
 *     · package_sessions 는 이미 '시술타입 1개'로 분해되어 저장되므로
 *       같은 날 레이저+발톱교정 병행 = 2개 row = 자동 2행 분리(방문×시술타입 grain 충족).
 *   컬럼 매핑(각 row → 자기 package_id FK 로만 join, 오매핑 0):
 *     1 차트번호      = customers.chart_number
 *     2 환자명        = customers.name
 *     3 시술일        = package_sessions.session_date (KST 저장값)
 *     4 시술타입      = package_sessions.session_type → 한글 라벨(SESSION_TYPE_LABEL)
 *     5 세션번호      = package_sessions.session_number (패키지 전체 통합 카운터, 저장값 그대로)
 *     6 총회차        = packages.total_sessions (해당 row 자신의 package)
 *     7 시술부위      = check_ins.treatment_memo.foot_sites (check_in_id FK) → 'R1, L3' 저장값 그대로
 *                       (check_in 미연결분 = 저장 부재 → 빈 문자열)
 *     8 힐러적용여부  = reservations.is_healer_intent (레이저 타입 한정 + session_date >= 2026-06-14)
 *                       · 레이저 & 6/14 이후 & true  → '적용'
 *                       · 레이저 & 6/14 이후 & false → '미적용'
 *                       · 그 외(비레이저 / 6/14 이전)  → '' (데이터 부재 = 빈 문자열, 0/false 아님)
 *
 * 규칙:
 *  - PHI 가드: 호출부(경과분석 탭)에서 admin/manager(운영권한) 게이팅 + export 감사로그(호출부 책임).
 *  - 무의존: 브라우저 Blob + URL.createObjectURL. UTF-8 BOM 선두 부착 → Excel(한글) 바로 열림.
 *  - 순수 additive: 스키마/트리거/비즈로직 무변경. read-only 조회만.
 */

/** 힐러 데이터 존재 시작일(reservations.is_healer_intent 도입 = 2026-06-14). 이전 방문분은 '데이터 부재'. */
export const HEALER_DATA_START = '2026-06-14';

/** 레이저 계열 session_type(힐러적용여부 대상 한정). */
const LASER_SESSION_TYPES = new Set(['heated_laser', 'unheated_laser']);

/**
 * session_type 코드 → 한글 라벨.
 * 문원장/총괄 확정 스펙 표기(레이저가열·레이저비가열·발톱교정·각질 등)를 우선 적용.
 * 코드-어휘 SSOT = supabase session_type CHECK + src/lib/treatmentRequestCodes.ts
 *   (podologue=내성/발톱교정, ribbon=각질(발각질)).
 */
export const SESSION_TYPE_LABEL: Record<string, string> = {
  heated_laser: '레이저가열',
  unheated_laser: '레이저비가열',
  podologue: '발톱교정',
  ribbon: '각질',
  preconditioning: '프리컨디셔닝',
  iv: '수액',
  trial: '체험',
  reborn: 'Re:Born',
};

export function sessionTypeLabel(code: string | null | undefined): string {
  if (!code) return '';
  return SESSION_TYPE_LABEL[code] ?? code; // 미정의 코드는 원본 유지(무손실).
}

/** CSV 컬럼 헤더 순서 (스펙 1~8 고정). */
export const PROGRESS_CSV_HEADERS = [
  '차트번호',
  '환자명',
  '시술일',
  '시술타입',
  '세션번호',
  '총회차',
  '시술부위',
  '힐러적용여부',
] as const;

export type ProgressCsvHeader = (typeof PROGRESS_CSV_HEADERS)[number];
export type ProgressCsvRow = Record<ProgressCsvHeader, string | number>;

/**
 * 힐러적용여부 셀 값 산출.
 * @param sessionType session_type 코드
 * @param sessionDate 시술일(YYYY-MM-DD)
 * @param isHealerIntent reservations.is_healer_intent (연결 예약 없으면 null)
 */
export function healerCell(
  sessionType: string | null | undefined,
  sessionDate: string | null | undefined,
  isHealerIntent: boolean | null | undefined,
): string {
  if (!sessionType || !LASER_SESSION_TYPES.has(sessionType)) return ''; // 레이저 한정.
  if (!sessionDate || sessionDate < HEALER_DATA_START) return '';        // 6/14 이전 = 데이터 부재.
  return isHealerIntent === true ? '적용' : '미적용';
}

/** 단일 CSV 셀 이스케이프 — 콤마/따옴표/개행 포함 시 따옴표로 감싸고 내부 따옴표는 2배로. */
function escapeCsvCell(value: string | number): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** rows → CSV 문자열 (헤더 포함, CRLF 줄바꿈 — Excel 호환). */
export function buildProgressCsv(rows: ProgressCsvRow[]): string {
  const lines: string[] = [];
  lines.push(PROGRESS_CSV_HEADERS.map(escapeCsvCell).join(','));
  for (const r of rows) {
    lines.push(PROGRESS_CSV_HEADERS.map((h) => escapeCsvCell(r[h])).join(','));
  }
  return lines.join('\r\n');
}

/** 다운로드 당일(로컬) → '경과분석_YYYYMMDD' 파일명(확장자 제외). */
export function progressCsvFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `경과분석_${y}${m}${d}`;
}

/**
 * PHI 반출 감사로그(GO_WARN 필수 AC) — export 실행 시 actor·시각·대상 환자수/차트번호 범위 기록.
 * 스키마 무변경 제약(신규 감사 테이블 = §S2.4 DA CONSULT 게이트, 본 티켓 scope 밖) 하의
 * 클라이언트 구조화 감사. 안정 prefix 로 관측/수집 가능. (서버 영속 감사 필요 시 후속 티켓 + DA CONSULT.)
 */
export interface ProgressCsvAuditMeta {
  actor: string | null;         // 수행자(email 또는 id)
  actorRole?: string | null;
  clinicId?: string | null;
  patientCount: number;         // 대상 환자수
  rowCount: number;             // 내보낸 시술기록 행수
  chartNumbers: (string | null)[]; // 대상 차트번호(범위 표기용)
}

export function logProgressCsvExport(meta: ProgressCsvAuditMeta): void {
  const charts = meta.chartNumbers.filter((c): c is string => !!c).sort();
  const chartRange = charts.length === 0 ? '(차트번호 없음)' : `${charts[0]} ~ ${charts[charts.length - 1]} (${charts.length}건)`;
  const record = {
    tag: '[PHI-AUDIT][progress-csv-export]',
    at: new Date().toISOString(),
    actor: meta.actor ?? '(unknown)',
    actorRole: meta.actorRole ?? null,
    clinicId: meta.clinicId ?? null,
    patientCount: meta.patientCount,
    rowCount: meta.rowCount,
    chartRange,
  };
  // 관측 파이프라인이 수집하는 안정 prefix. console.info = 브라우저/수집기 캡처.
  console.info(record.tag, JSON.stringify(record));
}

/** 시술기록 rows 를 CSV 파일로 다운로드 (무의존, UTF-8 BOM). */
export function downloadProgressCsv(rows: ProgressCsvRow[], filename: string = progressCsvFilename()): void {
  const csv = buildProgressCsv(rows);
  // UTF-8 BOM(﻿) → Excel 한글 인코딩 자동 인식(바로 열림).
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
