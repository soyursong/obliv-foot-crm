// T-20260819-foot-VIEWERONLY-WONJANG-ACCOUNT-ORIGIN — 뷰어전용(read-only) 계정 FE 초크포인트 훅.
//
//   저장위치 = auth app_metadata.read_only (=Option B, planner 설계결정 2026-08-19 12:51 / db_change=FALSE 확정).
//     ★Option A(user_profiles.read_only 컬럼) REJECT — db_change:true(DA CONSULT+MIG-GATE) + has_ops_authority/
//       exempt_from_restrictions DDL_DIFF_HOLD(prod 미적재 stuck) 얽힘. app_metadata=per-user JWT claim 로
//       scenario3 완벽(전역 director role 무오염·문지은 대표원장 계정 무접촉) + 신규 컬럼 0.
//   planner GATE A ★조종 결정(MSG-20260819-131818-pn41, hybrid·b 미채택):
//     FE choke-point = useReadOnly()(session.user.app_metadata.read_only 단일 소스) + permissions write predicate 단락.
//   ★uniform — 의료/비의료 무구분. 컴포넌트는 이 훅으로 write 액션(버튼·저장·발행·취소)을 비활성/숨김.
//     의료 write(canIssueProgressDocs 등)도 permissions.gateViewerWrite/isViewerOnly 로 동일 단락(이중 방어).
//   ★inert 보장: 어떤 계정도 app_metadata.read_only=true 미부여(계정 LIVE 활성화 前 = HOLD) → useReadOnly()=false →
//     기존 계정 0 behavior change(scenario3 안전). flag 부여는 origin@ 계정 LIVE 활성화 시점(문원장 medical 컨펌 +
//     김주연 identity 확인 後 planner GO). GoTrue admin API(service_role)로 app_metadata 세팅.
//   ★열람(read)에는 영향 없음 — 뷰어는 메뉴·목록·상세를 그대로 보되 write 만 막힌다.

import { useAuth } from '../lib/auth';
import { isReadOnlyFromAppMetadata } from '../lib/permissions';

/**
 * 현재 로그인 계정이 뷰어전용(read-only)인지 여부 — session.user.app_metadata.read_only 단일 소스.
 *   true = 모든 write/발행/취소/저장 액션을 비활성·숨김 처리해야 함(의료·비의료 무구분, uniform).
 *   ★write UI 게이트 전용 — 메뉴 접근/열람 판정에는 쓰지 말 것(뷰어도 열람은 가능).
 *   ★role-string write predicate(canEditCustomer(role) 등)와 함께 쓸 땐:
 *       const disabled = readOnly || !canEditCustomer(profile?.role)
 *     또는 permissions.gateViewerWrite({ read_only: readOnly }, canEditCustomer(profile?.role)) 로 감싼다.
 */
export function useReadOnly(): boolean {
  const { session } = useAuth();
  // app_metadata 는 GoTrue 가 관리(위조불가·서버 세팅)하는 JWT claim. user_metadata(사용자 편집가능)와 구분.
  return isReadOnlyFromAppMetadata(session?.user?.app_metadata);
}
