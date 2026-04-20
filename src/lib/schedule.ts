import type { Clinic } from './types';

// 운영일: 월~토, 일요일 휴무
export function isOpenDay(date: Date): boolean {
  return date.getDay() !== 0;
}

// 해당 날짜의 close_time (토요일은 weekend_close_time)
export function closeTimeFor(date: Date, clinic: Clinic): string {
  if (date.getDay() === 6) return clinic.weekend_close_time;
  return clinic.close_time;
}

export function openTimeFor(clinic: Clinic): string {
  return clinic.open_time;
}

// "10:00" + 30 → ["10:00", "10:30", ...] up to close
export function generateSlots(open: string, close: string, intervalMin: number): string[] {
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const startMin = oh * 60 + om;
  const endMin = ch * 60 + cm;
  const slots: string[] = [];
  for (let m = startMin; m < endMin; m += intervalMin) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return slots;
}

export const WEEK_DAYS_KO = ['월', '화', '수', '목', '금', '토', '일'];
