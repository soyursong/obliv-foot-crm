import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** KST 기준 오늘 날짜를 'YYYY-MM-DD' 문자열로 반환 */
export function getKSTDateString(date?: Date): string {
  return (date ?? new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
