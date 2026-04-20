export function elapsedMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function elapsedLabel(mins: number): string {
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export function urgencyClass(mins: number): string {
  if (mins >= 40) return 'ring-2 ring-red-500 animate-pulse';
  if (mins >= 20) return 'ring-2 ring-orange-400';
  return '';
}
