export function elapsedMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function elapsedMMSS(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mm = Math.floor(diff / 60000);
  const ss = Math.floor((diff % 60000) / 1000);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function elapsedLabel(mins: number): string {
  // T-20260630-foot-DATEFMT-YMD-RELATIVE-PURGE(AC-2): 상대표기(방금) 제거 → 절대 의미(1분 미만) 표기.
  if (mins < 1) return '1분 미만';
  if (mins < 60) return `${mins}분`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}
