/**
 * T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT (DA CONSULT-REPLY MSG-20260814-221208-dpnm)
 *
 * 직원 '삭제' = soft-delete(deleted_at) single-axis. client `.delete()` hard-delete = REJECT-as-mechanism.
 *   · '삭제' 의미 = 목록/드롭다운에서 제거(deleted_at 스탬프) + 접근차단(active=false 동반). 물리 purge 아님.
 *   · zero-ref 테스트계정도 uniform soft-delete(참조 유무로 hard/soft 분기 금지) → 참조 census 불요.
 *   · 비활성(active) 과 삭제(deleted_at) 는 직교 축. 둘 다 비파괴.
 *
 * 순수 로직 helper (payload 생성 · read-path 술어 · rows-affected 판정) — Staff.tsx + e2e spec 공유.
 */

/**
 * 활성(목록/드롭다운 노출) 직원 술어 — 모든 staff read-path 에 통일 적용(read-path parity).
 *   삭제된 직원(deleted_at NOT NULL)은 어떤 목록·선택 UI 에도 나타나지 않되 DB·FK 는 보존.
 */
export const ACTIVE_STAFF_PREDICATE = 'deleted_at IS NULL' as const;

/** 삭제 사유 기본 마커(UI 미입력 시). */
export const DEFAULT_DELETE_REASON = '직원 목록에서 삭제(관리자)';

export interface StaffSoftDeletePatch {
  /** soft-delete 단일 authority. 삭제 시각(ISO). NULL=활성. */
  deleted_at: string;
  /** 삭제 수행자 auth.uid()(감사). */
  deleted_by: string | null;
  /** 삭제 사유/맥락(보존). */
  deleted_reason: string;
  /** 삭제 직원은 접근도 차단(비활성 축 동반). */
  active: boolean;
}

/**
 * soft-delete UPDATE payload 생성.
 *   deleted_at=삭제시각(ISO), active=false(로그인·접근 차단 동반), deleted_by/deleted_reason=감사.
 */
export function buildStaffSoftDeletePatch(
  deletedBy: string | null,
  opts?: { now?: Date; reason?: string },
): StaffSoftDeletePatch {
  const now = opts?.now ?? new Date();
  const reason = opts?.reason?.trim();
  return {
    deleted_at: now.toISOString(),
    deleted_by: deletedBy,
    deleted_reason: reason && reason.length > 0 ? reason : DEFAULT_DELETE_REASON,
    active: false,
  };
}

/**
 * soft-delete UPDATE 결과 판정 (Cross-CRM Write Rows-Affected 표준 — silent write-failure 금지).
 *   RLS 거부/스코프 불일치/이미삭제 시 supabase 는 error=null + 0-row 반환 → '성공' 오인 차단.
 *   호출부는 `.is('deleted_at', null)` 멱등 가드 + `.select('id')` 로 rows-affected 확보 후 이 판정 사용.
 */
export function interpretSoftDeleteResult(
  rows: { id: string }[] | null | undefined,
): { ok: boolean; reason?: 'no_rows' } {
  if (!rows || rows.length === 0) return { ok: false, reason: 'no_rows' };
  return { ok: true };
}
