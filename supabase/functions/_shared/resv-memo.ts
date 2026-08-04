/**
 * _shared/resv-memo.ts — T-20260804-dopamine-RESVSIDEBAR-MEMO-CRMSYNC-BIDIR-ALLBRANCH (lane B / dev-foot)
 *
 * 예약메모(reservation-grain, reservation_memo_history) 순수 로직.
 *   - assembleMemo: rmh timeline → 사이드바 표시용 full memo 조립(FE ReservationMemoTimeline 정합 정렬).
 *   - isSuspectedTruncationClobber: 도파민 재push 가 기존 dopamine-source 행 메모를 축약 replace(데이터소실)
 *     하려는지 판정(INTERIM preserve 가드). fail-safe = 의심되면 true → 파괴적 replace 억제.
 * 두 EF(reservation-ingest-from-dopamine, foot-reservation-memo-read)가 공유 + deno test 로 검증.
 */

export interface MemoEntry {
  content: string | null;
  source_system: string | null;
  created_at: string;
}

/**
 * rmh timeline → 표시용 full memo 조립.
 *   정렬 = FE ReservationMemoTimeline 과 정합: source_system 비-NULL(외부/dopamine) 최상단, 그다음 최신순.
 *   빈 content 제외. 엔트리 경계 = 개행 2줄. 표시할 내용 없으면 null.
 */
export function assembleMemo(entries: MemoEntry[]): string | null {
  const rows = entries
    .map((e) => ({ ...e, content: (e.content ?? '').trim() }))
    .filter((e) => e.content !== '');
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    const aExt = a.source_system != null ? 1 : 0;
    const bExt = b.source_system != null ? 1 : 0;
    if (aExt !== bExt) return bExt - aExt;              // 외부(dopamine) 먼저
    return b.created_at.localeCompare(a.created_at);     // 최신순
  });
  return rows.map((r) => r.content).join('\n\n');
}

/**
 * INTERIM preserve 가드 판정.
 *   기존 dopamine-source 행에 non-empty content 가 있는데, 유입 content 가
 *     (a) 기존을 포함(superset/append)하지도 않고 (b) 더 짧으면 = 축약 replace(데이터소실) 의심 → true.
 *   idempotent(동일값)·superset·확장(더 김)·기존 empty·유입 empty → false(정상 replace 또는 상위 no-op skip).
 *   ★ INTERIM: 최종 해소는 READ-first(사이드바 full 실메모 표시→편집=superset) + AC-2 APPEND/MERGE.
 *   입력은 이미 btrim 된 값을 기대(호출부에서 trim). 방어적으로 내부에서도 trim.
 */
export function isSuspectedTruncationClobber(oldContentRaw: string | null | undefined, newContentRaw: string | null | undefined): boolean {
  const oldContent = (oldContentRaw ?? '').trim();
  const newContent = (newContentRaw ?? '').trim();
  if (oldContent === '') return false;          // 보존할 기존 없음
  if (newContent === '') return false;          // 빈값 push 는 상위(no-op skip)에서 이미 처리
  if (newContent === oldContent) return false;  // idempotent
  if (newContent.includes(oldContent)) return false; // superset/append
  return newContent.length < oldContent.length; // 축약 & 비-superset → 의심
}
