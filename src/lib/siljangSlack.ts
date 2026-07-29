// T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경1 — 실장 표시명 suffix + 6명 Slack ID 매핑 SSOT.
//
// (a) 신규 실장(consultant) 등록 시 표시명(display_name) 뒤 "실장" suffix. 소급 X(신규 등록분만).
//     배정 로직/매출귀속 키(staff.id/consultant_id/assigned_consultant_id)에 무영향 — 표시명만.
// (b) 실장 ↔ Slack ID 매핑(총괄 확정). 변경2 발송 멘션의 fallback(staff.slack_user_id 미매핑 시).
//     실 발송 해소 우선순위 = staff.slack_user_id → 이 상수(이름 매칭) → 이름 텍스트(멘션 없음).
//     ⚠ EF(supabase/functions/send-consult-notify/index.ts)에도 동일 표 복제(Deno=src import 불가). 변경 시 양쪽 동기화.

/** 실장 표시명 suffix. 이미 '실장'으로 끝나면 중복 부여 방지. */
export const SILJANG_SUFFIX = '실장';

/** 신규 실장(consultant) 등록 시 display_name 파생: `${이름} 실장`. 빈 이름/기존 suffix 시 안전 처리. */
export function withSiljangSuffix(name: string): string {
  const n = name.trim();
  if (!n) return n;
  if (n.endsWith(SILJANG_SUFFIX)) return n; // 이미 suffix 부여됨 → 중복 방지
  return `${n} ${SILJANG_SUFFIX}`;
}

/** 실장 이름에서 ' 실장' suffix 제거(매핑 조회 키). */
export function stripSiljangSuffix(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s*실장\s*$/u, '').trim();
}

/** 실장 ↔ Slack ID 매핑(총괄 확정, MSG-20260729-133148-duna). 키 = 이름(suffix 제거). */
export const SILJANG_SLACK_MAP: Record<string, string> = {
  엄경은: 'U0B4JFD5Z6V',
  송지현: 'U0B4BSU84E9',
  정연주: 'U0B49P7JB3P',
  강경민: 'U0BFYC35B0X',
  김지윤: 'U0B902NG8JF',
  김주연: 'U0ATDB587PV',
};

/** staff 표시명/이름으로 Slack ID 해소(staff.slack_user_id 우선은 호출부에서). 미매핑 시 null. */
export function resolveSiljangSlackId(nameOrDisplay: string | null | undefined): string | null {
  const key = stripSiljangSuffix(nameOrDisplay);
  return SILJANG_SLACK_MAP[key] ?? null;
}
