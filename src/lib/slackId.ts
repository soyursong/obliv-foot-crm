// T-20260805-foot-CONSULT-SLACKID-MAP-SELFSERVICE Part B — 셀프서비스 slack_user_id 입력 가드.
//
// 총괄이 Staff 관리(배정 설정) 화면에서 staff.slack_user_id 를 개발팀 경유 없이 직접 편집할 때,
// 잘못된 값이 저장되어 상담배정 알림이 엉뚱한 곳으로 가는 사고(CHOIHH 오배선)를 재발 방지한다.
//   (a) 봇 ID(장쳰봇) 저장 금지 — 봇 계정에 멘션되면 실장에게 안 감.
//   (b) Slack 멤버 ID 형식 위반 저장 금지 — 이름/한글/오타가 slack_user_id 로 새면 발송 실패.
//
// ⚠ 매핑 SSOT(src/lib/siljangSlack.ts)와 파일 분리: 그 파일에는 봇 ID 리터럴을 두지 않는다
//    (매핑에 봇 ID 잔존이 없어야 한다는 기존 정합 보존). 검증 관심사는 여기로 격리.

/** 장쳰봇 Slack user ID. 이 값은 slack_user_id 로 저장 금지(멘션이 봇에게 감). */
export const SLACK_BOT_USER_ID = 'U0ATJ9SG4GY';

/** Slack 멤버 ID 형식: 'U'/'W' + 대문자·숫자 7~14자(총 8~15자). 대소문자 정규화 후 검증. */
const SLACK_MEMBER_ID_RE = /^[UW][A-Z0-9]{7,14}$/;

export type SlackIdCheck =
  | { ok: true; value: string | null } // value=null → 매핑 해제(빈 입력 허용)
  | { ok: false; reason: 'bot' | 'format'; message: string };

/**
 * 셀프서비스 입력값을 slack_user_id 저장 전 검증·정규화한다.
 *  - 빈 입력 → 매핑 해제 허용({ ok:true, value:null }).
 *  - 봇 ID → 거부(reason:'bot').
 *  - 형식 위반(한글/이름/오타/자릿수) → 거부(reason:'format').
 *  - 통과 → 대문자 정규화된 값 반환({ ok:true, value }).
 */
export function checkSlackUserId(raw: string | null | undefined): SlackIdCheck {
  const v = (raw ?? '').trim().toUpperCase();
  if (!v) return { ok: true, value: null };
  if (v === SLACK_BOT_USER_ID) {
    return { ok: false, reason: 'bot', message: '봇 계정 ID는 넣을 수 없어요. 실장 본인의 Slack 멤버 ID를 넣어주세요.' };
  }
  if (!SLACK_MEMBER_ID_RE.test(v)) {
    return { ok: false, reason: 'format', message: 'Slack 멤버 ID 형식이 아니에요. 예: U01AB2CD3EF (영문 대문자 U로 시작).' };
  }
  return { ok: true, value: v };
}
