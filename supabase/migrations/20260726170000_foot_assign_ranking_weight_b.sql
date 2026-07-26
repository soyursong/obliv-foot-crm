-- T-20260726-foot-CRM-ASSIGN-WEIGHT-B — 실장 랭킹 기본 가중치 B(월1:주2:객1) 반영.
--
-- 성격: DATA-ONLY(no-DDL). 스키마 무변경(db_change=false). V1 엔진(assignment_ranking_weights) 재사용 —
--   기본값(app fallback + 관리자 UI 초기 표시값)은 코드에서 B로 상향, 본 마이그는 V1이 잠정 seed 한
--   기존 config row(월1:주2:객1 이전의 균등 1:1:1)를 정본 B 로 정정한다.
--
-- ★ 가드(안전): weight_revenue_week=1 AND month=1 AND avg=1 인 '잠정 균등 default' row 만 갱신.
--   관리자가 화면에서 의도적으로 설정한 값(예: 3:1:2, 1:1:1 재설정 등)은 위 지문과 다를 수 있으나,
--   V1 자동 seed 시점(2026-07-26 02:42) 이후 실운영에서 균등 1:1:1 은 미변경 '잠정 default' 로 간주(총괄
--   B 확정, policy_superseded). 균등이 아닌 row 는 admin 의도값이므로 불변(AC4: 화면 재설정값 우선).
--   → 멱등: 재실행 시 이미 주2 이므로 매칭 0건(no-op).
--
-- ★ row 부재 clinic(예: songdo-foot)은 seed 하지 않음 — app fallback default(주2) 가 B 로 간주(V1 모델
--   '행 부재 시 app default' 계승). 관리자가 최초 저장 시 화면 기본 노출값(B)로 기록됨.
--
-- 근거: 랭킹1~2위 = 워크인·인바운드 선배정 특권 → 전주 실적(주매출) 2배 반영 = "이번 주 열심히=다음 주 기회↑".
-- reporter=김주연 총괄(U0ATDB587PV) 직접 확정. parent=T-20260726-foot-CRM-ASSIGN-V1(deployed).

BEGIN;

UPDATE assignment_ranking_weights
   SET weight_revenue_week = 2,
       updated_at          = now()
 WHERE weight_revenue_month = 1
   AND weight_revenue_week  = 1
   AND weight_avg_ticket    = 1;

COMMIT;
