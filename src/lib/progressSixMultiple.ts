// progressSixMultiple.ts — 치료테이블 '경과분석' 탭 나열 기준(6배수 도래) 순수 로직.
// Ticket: T-20260812-foot-PROGCHK-6MULTIPLE-LIST-FILTER
//   경과분석 탭 목록 필터를 '예약일=오늘' → '활성 패키지 보유 + (used_sessions + 1) % 6 == 0 인 환자 전부'로 변경.
//   판정 로직 기존 그대로(Reservations.tsx): anticipatedSession = used_sessions + 1; 6배수: anticipatedSession % 6 == 0.
//   자매 SONGDO-FORM-DOWNLOAD(deployed) 다운로드 버튼 트리거 모집단(완료회차%6==5)과 동일 모집단(정합).
//   순수 함수만(supabase/DOM 미의존) — read-only 필터·정렬 결정 로직을 spec 으로 못박기 위해 분리.

// T-20260822-foot-PROGANALYSIS-DUE-CYCLE-CONFIGURABLE: 도래 회차 간격(현 하드코딩 6)을 설정값으로 승격.
//   base canon(4f50d3e4)의 '6' 상수를 코드에 박아두지 않고 런타임 조정 가능한 파라미터로 변경.
//   기본값=6 유지 → 설정 미변경 시 동작은 기존과 byte-identical(하위호환·회귀0).
//   저장/조정 UI 는 progressCheckpointConfig.ts(localStorage) + ProgressTargetsSection.tsx 설정 경로 담당.
//   본 순수 모듈은 상수·검증·판정만 소유(DOM/localStorage 미의존).
/** 도래 회차 간격 기본값(= base canon 6배수 루틴). */
export const DEFAULT_CHECKPOINT_INTERVAL = 6;

/** 도래 회차 간격 유효성: 양의 정수만 허용(0·음수·비정수·NaN 방어 — AC-5). */
export function isValidCheckpointInterval(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/** anticipatedSession = 지금까지 사용한 세션 수 + 1 (다음 내방 회차). */
export function anticipatedSession(usedSessions: number): number {
  return usedSessions + 1;
}

// T-20260814-foot-TREATTABLE-PROGRESSANALYSIS-ERROR: 경과분석 리스트 조회 400 Bad Request 근본원인.
//   나열기준 변경(T-20260812)으로 '활성 패키지 전건'을 조회 → package_sessions/customers/reservations 의
//   .in(...) 목록이 운영 누적(수백~수천 id)에서 PostgREST GET URL 길이 한계를 초과 → 400 Bad Request.
//   해결: .in() 목록을 IN_CHUNK_SIZE 단위로 분할 조회(선례 visitRecency.ts CHUNK=200 동일).
/** PostgREST .in() URL 길이 한계 회피용 청크 크기. */
export const IN_CHUNK_SIZE = 200;

/** 배열을 size 단위 청크로 분할(순서 보존·전체 원소 무손실). size<=0 이면 통짜 1청크 폴백. */
export function chunkIds<T>(arr: T[], size: number = IN_CHUNK_SIZE): T[][] {
  if (size <= 0) return arr.length ? [arr.slice()] : [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 도래 회차 간격의 배수 도래 대상 여부.
 *   - 활성 패키지 tier(total_sessions>0)만 대상 — 체험/Re:Born tier 0 배제(기존 진행판정 가드 동일).
 *   - anticipatedSession(used+1) 이 interval 의 배수(기본 6 → 6·12·18·24…)면 대상.
 *   - interval 미지정/비정상 → DEFAULT_CHECKPOINT_INTERVAL(6) 폴백 = base canon(4f50d3e4) 과 동일 동작(하위호환).
 * T-20260822-foot-PROGANALYSIS-DUE-CYCLE-CONFIGURABLE: '6' 하드코딩 → interval 파라미터로 승격(default=6).
 */
export function isSixMultipleTarget(
  input: { usedSessions: number; totalSessions: number | null | undefined },
  interval: number = DEFAULT_CHECKPOINT_INTERVAL,
): boolean {
  const total = input.totalSessions ?? 0;
  if (total <= 0) return false;
  const step = isValidCheckpointInterval(interval) ? interval : DEFAULT_CHECKPOINT_INTERVAL;
  return anticipatedSession(input.usedSessions) % step === 0;
}

/** 회차 라벨(anticipatedSession 기반, 예: 6 → "6회 경과분석"). */
export function sessionCheckpointLabel(anticipated: number): string {
  return `${anticipated}회 경과분석`;
}

/** 정렬 비교 대상 최소 형태. */
export interface ProgressSortRow {
  nextReservationDate: string | null; // yyyy-MM-dd (미예약=null)
  customerName: string;
}

// T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE §1 (B안 additive): '내일(D-1)' 필터.
//   기본뷰(canon)는 예약무관 6배수 도래자 전체 — 이 필터는 화면 상단 토글 ON 시에만 적용되는 순수 파생.
//   "다음 예약이 내일(=경과지 전날 준비 대상)"인 행만 남긴다. 미예약(null)은 제외. DB 무관(이미 조회된 rows 파생).
/** 다음 예약이 tomorrowISODate(yyyy-MM-dd, 서울 기준 내일)인 행만 필터. */
export function filterD1Targets<T extends { nextReservationDate: string | null }>(
  rows: T[],
  tomorrowISODate: string,
): T[] {
  return rows.filter((r) => r.nextReservationDate === tomorrowISODate);
}

/**
 * 정렬 비교자: 다음 예약일 오름차순(NULLS LAST) → 이름순(가나다).
 *   - 예약 있는 환자가 위(임박 순), 미예약 환자가 아래.
 *   - 같은 날짜(또는 둘 다 미예약) → 이름 가나다순(ko locale).
 */
export function compareProgressTargets(a: ProgressSortRow, b: ProgressSortRow): number {
  const ad = a.nextReservationDate;
  const bd = b.nextReservationDate;
  if (ad && bd) {
    if (ad !== bd) return ad.localeCompare(bd);
  } else if (ad && !bd) {
    return -1; // a 만 예약 있음 → 위(NULLS LAST).
  } else if (!ad && bd) {
    return 1; // b 만 예약 있음 → b 가 위.
  }
  return a.customerName.localeCompare(b.customerName, 'ko');
}
