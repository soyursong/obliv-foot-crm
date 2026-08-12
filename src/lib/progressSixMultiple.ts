// progressSixMultiple.ts — 치료테이블 '경과분석' 탭 나열 기준(6배수 도래) 순수 로직.
// Ticket: T-20260812-foot-PROGCHK-6MULTIPLE-LIST-FILTER
//   경과분석 탭 목록 필터를 '예약일=오늘' → '활성 패키지 보유 + (used_sessions + 1) % 6 == 0 인 환자 전부'로 변경.
//   판정 로직 기존 그대로(Reservations.tsx): anticipatedSession = used_sessions + 1; 6배수: anticipatedSession % 6 == 0.
//   자매 SONGDO-FORM-DOWNLOAD(deployed) 다운로드 버튼 트리거 모집단(완료회차%6==5)과 동일 모집단(정합).
//   순수 함수만(supabase/DOM 미의존) — read-only 필터·정렬 결정 로직을 spec 으로 못박기 위해 분리.

/** anticipatedSession = 지금까지 사용한 세션 수 + 1 (다음 내방 회차). */
export function anticipatedSession(usedSessions: number): number {
  return usedSessions + 1;
}

/**
 * 6배수 도래 대상 여부.
 *   - 활성 패키지 tier(total_sessions>0)만 대상 — 체험/Re:Born tier 0 배제(기존 진행판정 가드 동일).
 *   - anticipatedSession(used+1) 이 6의 배수(6·12·18·24…)면 대상.
 */
export function isSixMultipleTarget(input: { usedSessions: number; totalSessions: number | null | undefined }): boolean {
  const total = input.totalSessions ?? 0;
  if (total <= 0) return false;
  return anticipatedSession(input.usedSessions) % 6 === 0;
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
