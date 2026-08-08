export function elapsedMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function elapsedMMSS(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mm = Math.floor(diff / 60000);
  const ss = Math.floor((diff % 60000) / 1000);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// T-20260808-foot-DASH-CUSTBOX-TIMER-COUNTDOWN: 종료시각 기준 남은시간(카운트다운) 라벨.
//   클라이언트 계산(Date.now())만 사용 → 서버폴링 0. 0 이하 → '종료'.
//   소스 = 2번차트 2구역 레이저 타이머(timer_records.ends_at). 대시보드 고객박스 우측 하단 표시.
export function remainingLabel(endsAt: Date | string): string {
  const end = typeof endsAt === 'string' ? new Date(endsAt).getTime() : endsAt.getTime();
  const diff = end - Date.now();
  if (diff <= 0) return '종료';
  const mm = Math.floor(diff / 60000);
  const ss = Math.floor((diff % 60000) / 1000);
  return mm > 0
    ? `남은 ${mm}분 ${String(ss).padStart(2, '0')}초`
    : `남은 ${ss}초`;
}

export function elapsedLabel(mins: number): string {
  // T-20260630-foot-DATEFMT-YMD-RELATIVE-PURGE(AC-2): 상대표기(방금) 제거 → 절대 의미(1분 미만) 표기.
  if (mins < 1) return '1분 미만';
  if (mins < 60) return `${mins}분`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}
