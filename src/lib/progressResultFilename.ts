/**
 * T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK (AC-2 / AC-6)
 * 경과분석 "결과" 이미지 파일명 계약 — **단일 SSOT**(build ∧ parse 한 곳).
 *
 * 계약(reporter 문지은 대표원장 확정, 3중 강조 "한 글자라도 다르면 실패"):
 *   `경과분석_{이름}_{차트숫자}_예정_{N}회차_{YYMMDD}.{ext}`
 *   예) `경과분석_홍길동_1234_예정_6회차_260822.png`
 *
 * ⚠ 이 파일이 결과-파일명 계약의 유일 정의처다(중복 정의 금지 — 티켓 명시).
 *   - 업로드/파싱(본 티켓)  = parseProgressResultFilename()  로만 해석.
 *   - EXTRACT 클러스터가 결과-파일명을 "생성"하게 되면 buildProgressResultFilename() 를 재사용(중복 상수 금지).
 *   - 인풋(.md) 파일명 SSOT = progressAnalysisMd.progressAnalysisMdBasename({차트}_{이름}) — 별개 아티팩트(혼동 금지).
 *   - 구(舊) 3-토큰 결과계약 {이름}_{차트}_{날짜} = progressResultMatch.parseResultFilename (customer-level) — 별개, 무접촉.
 *
 * 파싱 키(AC-2) = 차트숫자 + 회차(N) + 날짜(YYMMDD) **3조합**. 이름·날짜 추측연결 절대 금지(fail-closed).
 * 내부 결속 = appointment_id(=progress_analysis_slips.reservation_id, UNIQUE) — progressResultApptMatch 에서 해석.
 */

import { normalizeChartNo } from './progressResultMatch';

/** 결과 이미지 허용 확장자(임상 이미지). progressResultMatch 와 동일 집합. */
export const RESULT_IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);

/** 파일명 계약 리터럴(계약 문자열 SSOT — 하드코딩 산개 금지). */
export const RESULT_FILENAME_PREFIX = '경과분석';
export const RESULT_FILENAME_SCHEDULE_TOKEN = '예정';
export const RESULT_FILENAME_SESSION_SUFFIX = '회차';

/** 확장자(소문자, 점 뒤). 없으면 ''. */
export function resultFileExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/**
 * AC-6: 이모지/그림문자 포함 = 즉시 실패. Extended_Pictographic + 변이선택자 + ZWJ + 국기(regional indicator).
 * (Node/브라우저 유니코드 프로퍼티 escape 지원 — vite 타겟 esnext.)
 */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}\u{20E3}\u{2122}\u{2139}\u{2328}]/u;

export function hasEmoji(s: string): boolean {
  return EMOJI_RE.test(s);
}

/** YYMMDD(6자리) → 'YYYY-MM-DD'. 유효하지 않으면 null. 20YY 로 확장(현장 전건 20xx). */
export function parseYYMMDD(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = String(token).trim();
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const [, yy, mm, dd] = m;
  const iso = `20${yy}-${mm}-${dd}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (
    dt.getUTCFullYear() !== 2000 + Number(yy) ||
    dt.getUTCMonth() + 1 !== Number(mm) ||
    dt.getUTCDate() !== Number(dd)
  ) {
    return null;
  }
  return iso;
}

/** YYMMDD 역변환('YYYY-MM-DD' → 'YYMMDD'). build 용. */
export function toYYMMDD(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${m[1].slice(2)}${m[2]}${m[3]}`;
}

export interface ParsedResultFilename {
  ok: boolean;
  patientName: string;      // 2번째 토큰(대조 참고용 — 조인키 아님, 절대 연결키로 쓰지 않음)
  chartNoRaw: string;       // 3번째 토큰(raw)
  chartNo: string;          // 정규화 chart_no(조인 축)
  sessionOrdinal: number | null; // 회차 N(정수)
  visitDate: string | null; // 'YYYY-MM-DD'
  ext: string;
  reason?: string;          // 실패 사유(AC-3 표시용)
}

/**
 * 6-토큰 strict 파싱. fuzzy·추측 금지(AC-2/AC-6). 한 글자라도 다르면 실패.
 * 토큰: [경과분석][이름][차트숫자][예정][N회차][YYMMDD]  (정확히 6개)
 */
export function parseProgressResultFilename(fileName: string): ParsedResultFilename {
  const fail = (reason: string): ParsedResultFilename => ({
    ok: false, patientName: '', chartNoRaw: '', chartNo: '', sessionOrdinal: null,
    visitDate: null, ext: '', reason,
  });
  if (!fileName) return fail('빈 파일명');

  // AC-6: 이모지 = 즉시 실패(파일명 전체 검사).
  if (hasEmoji(fileName)) return fail('이모지 포함 파일명 — 즉시 실패');

  const ext = resultFileExt(fileName);
  if (!RESULT_IMG_EXT.has(ext)) return fail(`허용 확장자 아님(${ext || '없음'})`);

  const base = fileName.slice(0, fileName.length - ext.length - 1);
  const tokens = base.split('_');
  if (tokens.length !== 6) {
    return fail(`파일명 형식 오류(6토큰 아님 — 토큰 ${tokens.length}개)`);
  }
  const [prefix, name, chartRaw, schedule, sessionTok, dateTok] = tokens;

  // 리터럴 토큰 정확 일치(한 글자라도 다르면 실패).
  if (prefix !== RESULT_FILENAME_PREFIX) return fail(`머리말 '${RESULT_FILENAME_PREFIX}' 아님(${prefix})`);
  if (schedule !== RESULT_FILENAME_SCHEDULE_TOKEN) return fail(`'${RESULT_FILENAME_SCHEDULE_TOKEN}' 토큰 아님(${schedule})`);
  if (!name.trim()) return fail('이름 토큰 비어있음');
  if (!chartRaw.trim()) return fail('차트번호 토큰 비어있음');

  // {N}회차 — 정확히 '숫자 + 회차'. 앞뒤 잉여문자 불가.
  const sm = new RegExp(`^(\\d+)${RESULT_FILENAME_SESSION_SUFFIX}$`).exec(sessionTok);
  if (!sm) return fail(`회차 형식 오류('N${RESULT_FILENAME_SESSION_SUFFIX}' 아님 — ${sessionTok})`);
  const sessionOrdinal = Number(sm[1]);
  if (!Number.isInteger(sessionOrdinal) || sessionOrdinal <= 0) return fail(`회차 값 오류(${sessionTok})`);

  const visitDate = parseYYMMDD(dateTok);
  if (!visitDate) return fail(`날짜(YYMMDD) 파싱 실패(${dateTok})`);

  return {
    ok: true,
    patientName: name.trim(),
    chartNoRaw: chartRaw.trim(),
    chartNo: normalizeChartNo(chartRaw),
    sessionOrdinal,
    visitDate,
    ext,
    reason: undefined,
  };
}

export interface BuildResultFilenameInput {
  patientName: string;
  chartNo: string;
  sessionOrdinal: number;
  /** 'YYYY-MM-DD' */
  visitDate: string;
  ext?: string; // 기본 png
}

/**
 * 결과 파일명 생성(SSOT — EXTRACT 클러스터가 결과파일명 생성 시 이 함수 재사용).
 * parse(build(x)) === x 라운드트립 보장(spec 로 박제).
 */
export function buildProgressResultFilename(input: BuildResultFilenameInput): string {
  const ext = (input.ext ?? 'png').toLowerCase();
  return `${RESULT_FILENAME_PREFIX}_${input.patientName}_${input.chartNo}_${RESULT_FILENAME_SCHEDULE_TOKEN}_${input.sessionOrdinal}${RESULT_FILENAME_SESSION_SUFFIX}_${toYYMMDD(input.visitDate)}.${ext}`;
}
