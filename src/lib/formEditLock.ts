/**
 * T-20260611-foot-CONCURRENT-EDIT-LOCK — 펜차트 양식 4종 편집 화면 동시편집 잠금(순수 로직).
 *
 * 범위 ①(김주연 총괄 확정): pen_chart / health_questionnaire_general /
 *   health_questionnaire_senior / refund_consent 의 "양식 관리(편집)" 화면 한정.
 *   환자별 펜차트 기록 작성 등 넓은 범위는 이번 범위 밖(추후 별도 티켓).
 *
 * 기술 방식 = Supabase Realtime presence(동일 양식 form_key 채널 등록/구독).
 *   → DB 스키마 변경(DDL) 없음(db_change:false). 잠금 상태는 ephemeral presence 로만 존재.
 *
 * 이 파일은 "누가 잠금을 보유하는가"를 결정하는 순수 함수만 담는다(브라우저/Realtime 의존 0).
 *   훅(useFormEditLock)·배너(FormEditLockBanner)에서 재사용하며, 단위 검증이 쉽도록 분리.
 *
 * 핵심 규칙:
 *  - 먼저 편집 진입한 계정(가장 이른 joinedAt)이 잠금 보유 → write/저장 활성.
 *  - 이후 진입 계정은 read-only + 안내 문구.
 *  - stale lock 방지(AC 필수): lastBeat 가 LOCK_STALE_MS 이상 끊긴 참가자는 후보에서 제외 →
 *    연결 단절/탭 강제종료 시 자동으로 다음 후보가 잠금 승계. 잠금 영구 잔존 금지.
 *  - 양식 4종은 form_key 별 독립 채널 → 서로 다른 양식 동시 편집은 차단 안 됨.
 */

/** 잠금 대상 양식 4종(범위 ① 확정). 이 목록 밖 form_key 에는 잠금을 적용하지 않는다. */
export const LOCKABLE_FORM_KEYS = [
  'pen_chart',
  'health_questionnaire_general',
  'health_questionnaire_senior',
  'refund_consent',
] as const;

export type LockableFormKey = (typeof LOCKABLE_FORM_KEYS)[number];

export function isLockableFormKey(formKey: string): formKey is LockableFormKey {
  return (LOCKABLE_FORM_KEYS as readonly string[]).includes(formKey);
}

/** 편집 화면 진입자 한 명의 presence 메타. */
export interface LockParticipant {
  /** user_profiles.id — presence key 로도 사용(동일 유저 멀티탭은 1인으로 합쳐짐). */
  userId: string;
  /** user_profiles.name — 안내 문구의 "{편집자 이름}". null 이면 폴백 표기. */
  userName: string | null;
  /** 편집 화면 최초 진입(track) 시각 epoch ms — 잠금 선출 기준(이른 쪽이 보유). */
  joinedAt: number;
  /** 마지막 heartbeat 시각 epoch ms — stale 판정 기준. */
  lastBeat: number;
}

/** heartbeat 재-track 주기. 이 간격마다 lastBeat 를 갱신한다. */
export const LOCK_HEARTBEAT_MS = 5_000;

/**
 * stale 판정 임계. lastBeat 가 이 값 이상 끊기면 죽은 세션으로 보고 잠금 후보에서 제외.
 * heartbeat 3회 누락(=15s) 기준. Realtime 서버의 소켓 종료 기반 자동 eviction 에 더해,
 * half-open 연결(소켓은 안 끊겼지만 멈춘 탭) 까지 막는 클라이언트측 방어선.
 */
export const LOCK_STALE_MS = 15_000;

/** 편집자 이름이 없을 때 안내 문구에 쓸 폴백. */
export const LOCK_FALLBACK_EDITOR_NAME = '다른 직원';

/**
 * 잠금 보유자(편집자)를 선출한다.
 *  - stale(lastBeat 오래됨) 참가자는 제외 → 자동 stale lock 해제.
 *  - 남은 후보 중 joinedAt 이 가장 이른 사람이 보유. 동시 진입(joinedAt 동률) 시 userId
 *    사전순 최소값으로 결정론적 타이브레이크(모든 클라이언트가 동일 결론 → split-brain 방지).
 * @returns 잠금 보유자. 후보가 없으면 null(아무도 편집 중 아님).
 */
export function electLockOwner(
  participants: readonly LockParticipant[],
  nowMs: number,
  staleMs: number = LOCK_STALE_MS,
): LockParticipant | null {
  const alive = participants.filter((p) => nowMs - p.lastBeat < staleMs);
  if (alive.length === 0) return null;
  return alive.reduce((best, cur) => {
    if (cur.joinedAt < best.joinedAt) return cur;
    if (cur.joinedAt > best.joinedAt) return best;
    return cur.userId < best.userId ? cur : best;
  });
}

/** 잠금 상태 평가 결과(훅·배너 공용). */
export interface LockEvaluation {
  /** 현재 사용자가 잠금 보유자 = 편집/저장 활성. */
  isOwner: boolean;
  /** 잠금이 걸려 있고 보유자가 내가 아님 = read-only. */
  isLocked: boolean;
  /** read-only 일 때 안내 문구에 넣을 편집자 이름(null 폴백 반영). */
  lockedByName: string | null;
  /** 현재 보유자 userId(없으면 null). */
  ownerUserId: string | null;
}

/** 선출 결과를 현재 사용자 관점의 잠금 상태로 환산. */
export function evaluateLock(
  participants: readonly LockParticipant[],
  selfUserId: string,
  nowMs: number,
  staleMs: number = LOCK_STALE_MS,
): LockEvaluation {
  const owner = electLockOwner(participants, nowMs, staleMs);
  if (!owner) {
    return { isOwner: false, isLocked: false, lockedByName: null, ownerUserId: null };
  }
  const isOwner = owner.userId === selfUserId;
  return {
    isOwner,
    isLocked: !isOwner,
    lockedByName: isOwner ? null : owner.userName,
    ownerUserId: owner.userId,
  };
}

/**
 * read-only 안내 문구(현장 확정 문구 — 그대로 사용, 변형 금지).
 *   "지금 {편집자 이름}님이 편집 중이에요. 편집이 끝나면 알려드릴게요."
 */
export function buildLockMessage(editorName: string | null): string {
  const name = editorName && editorName.trim().length > 0 ? editorName : LOCK_FALLBACK_EDITOR_NAME;
  return `지금 ${name}님이 편집 중이에요. 편집이 끝나면 알려드릴게요.`;
}
