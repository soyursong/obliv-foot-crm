import { parseISO } from 'date-fns';
import { getClinic } from './clinic';
import { isNewResvOutOfWindow } from './schedule';

// ─────────────────────────────────────────────────────────────────────────────
// T-20260816-foot-JONGNO-OPHOURS-WRITEGATE (Phase2) — 스태프 직접입력 신규예약 out-of-window soft 경고.
//   CEO DECISION MSG-20260818-070213-u1rx: 스태프 스코프 = (i) soft(경고 후 진행).
//     census 근거 = 스태프 창밖 예약의 지배적 유형이 '원장 지시 창밖 1건' 류 정상 예외운영(마감직후 재진
//     끼워넣기) → 하드차단은 월 ~6.8건 정당 예외 과대차단 → soft nudge 로 우발적 창밖만 환기하고 의도적
//     예외는 통과시킨다.
//   ★차단축(외부/도파민 HARD)은 서버 EF(reservation-ingest-from-dopamine)가 소유 — 이 helper 는 스태프 경로 전용.
//   ★경고 문구 = 현장 친화 언어(방침 5·dev-jargon 금지: out_of_window/운영창/슬롯세대 미사용).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 스태프 신규예약이 (2026-09-01~) 운영시간 밖이면 confirm 을 띄운다.
 *   @returns true  = 진행(창 안 / 09-01 이전 / clinic 미확정 / 사용자가 '확인' 선택)
 *            false = 중단(사용자가 '취소' 선택)
 *   조회 실패·판정 불가 시 무경고 통과(과대차단 방지, forward-only 무교란).
 */
export async function confirmStaffResvWindow(
  date: string | null | undefined,
  time: string | null | undefined,
): Promise<boolean> {
  if (!date || !time) return true;
  let clinic;
  try {
    clinic = await getClinic();
  } catch {
    return true; // 클리닉 조회 실패 = 무경고 통과(정당 예외 과대차단 방지)
  }
  if (!isNewResvOutOfWindow(parseISO(date), time, clinic)) return true;
  return window.confirm('9/1부터 이 시간은 예약 마감 이후입니다. 그래도 등록할까요?');
}
