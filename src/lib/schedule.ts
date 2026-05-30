import type { Clinic } from './types';

/**
 * T-20260530-foot-WALKIN-OFFHOUR-SLOT: 풋센터(204) 확정 운영시간
 * 현장 확인: 2026-05-30 08:42 KST (김주연 총괄)
 * AC-5 업데이트: 2026-05-30 KST (김주연 총괄) — 일요일 토요일과 동일 적용
 *
 * ⚠️  코드·화면 표시용 "실제 영업시간" — slot 생성용 close_time 은 +30분 (DB 값 기준)
 *     weekday → DB close_time           = '20:30' → 마지막 슬롯 20:00
 *     saturday/sunday → DB weekend_close_time = '18:30' → 마지막 슬롯 18:00
 */
export const CLINIC_HOURS = {
  weekday:  { open: '10:00', close: '20:00' }, // 월~금
  saturday: { open: '10:00', close: '18:00' }, // 토
  sunday:   { open: '10:00', close: '18:00' }, // 일 (토요일 동일, 2026-05-30 김주연 총괄)
} as const;

// 운영일: 월~일 (일요일 포함, 2026-05-30 김주연 총괄 지시)
export function isOpenDay(_date: Date): boolean {
  return true;
}

// 해당 날짜의 close_time (토요일·일요일은 weekend_close_time)
export function closeTimeFor(date: Date, clinic: Clinic): string {
  const dow = date.getDay();
  if (dow === 6 || dow === 0) return clinic.weekend_close_time;
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
