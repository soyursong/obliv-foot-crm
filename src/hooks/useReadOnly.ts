// T-20260819-foot-VIEWERONLY-WONJANG-ACCOUNT-ORIGIN — 뷰어전용(read-only) 계정 FE 초크포인트 훅.
//
//   planner GATE A ★조종 결정(MSG-20260819-131818-pn41):
//     FE choke-point = useReadOnly() + permissions.ts write predicate 단락. hybrid(b 미채택).
//   ★uniform — 의료/비의료 무구분. 컴포넌트는 이 훅으로 write 액션(버튼·저장·발행·취소)을 비활성/숨김.
//     의료 write(canIssueProgressDocs 등)도 permissions.isViewerOnly 로 동일 단락 → 이중 방어(FE+predicate).
//   ★inert 보장: user_profiles.read_only 컬럼 미적재(DDL_DIFF_HOLD) → profile.read_only=undefined →
//     useReadOnly()=false → 기존 계정 0 behavior change(scenario3 안전). flag=true 부여는 계정 LIVE 활성화 시점(HOLD:
//     문원장 medical 컨펌 + 김주연 identity 확인 後 planner 가 approved 전환).
//   ★열람(read)에는 영향 없음 — 뷰어는 메뉴·목록·상세를 그대로 보되 write 만 막힌다.

import { useAuth } from '../lib/auth';
import { isViewerOnly } from '../lib/permissions';

/**
 * 현재 로그인 계정이 뷰어전용(read-only)인지 여부.
 *   true = 모든 write/발행/취소/저장 액션을 비활성·숨김 처리해야 함(의료·비의료 무구분, uniform).
 *   ★write UI 게이트 전용 — 메뉴 접근/열람 판정에는 쓰지 말 것(뷰어도 열람은 가능).
 *   ★role-string write predicate(canEditCustomer(role) 등)와 함께 쓸 땐:
 *       const disabled = readOnly || !canEditCustomer(profile?.role)
 *     또는 permissions.gateViewerWrite(profile, canEditCustomer(profile?.role)) 로 감싼다.
 */
export function useReadOnly(): boolean {
  const { profile } = useAuth();
  return isViewerOnly(profile);
}
