-- T-20260608-foot-PKG-REBORN-ITEM (REOPEN P0 핫픽스)
-- 결함: 20260608120000_foot_pkg_reborn_item.sql 은 packages 테이블에 reborn_sessions/
--       reborn_unit_price 컬럼만 ADD 했고, package_sessions.session_type CHECK 제약과
--       get_package_remaining RPC 에 'reborn' 반영을 누락함.
--   → Re:Born 회차 차감 시 package_sessions INSERT(session_type='reborn') 가
--     package_sessions_session_type_check 위반으로 거부 → "차감 안됨".
--   (증거: prod 에 active Re:Born 패키지 존재하나 package_sessions reborn 행 0건.)
--
-- 신규 session_type 추가 시 동시 갱신 필수 4지점(재발 방지 체크리스트):
--   [1] package_sessions.session_type CHECK 제약
--   [2] get_package_remaining RPC (잔여 집계)
--   [3] CustomerChartPage computeRemainingFromSessionRows (FE 클라 집계)  ← 이미 reborn 포함
--   [4] FE 드롭다운/TREAT_KO 한글 매핑                                    ← 이미 reborn 포함
-- 본 마이그는 [1][2] 누락분을 보충함.
--
-- additive · backward-compatible: CHECK IN-list 확장(기존 행 전부 기존 좁은 집합 ⊂ 신집합 → 위반 0).
-- Rollback SQL: 20260608130000_pkg_sessions_reborn_check.rollback.sql 참조.

-- [1] session_type CHECK 제약에 'reborn' 추가
ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS package_sessions_session_type_check;

ALTER TABLE package_sessions
  ADD CONSTRAINT package_sessions_session_type_check
    CHECK (session_type IN ('heated_laser','unheated_laser','iv','preconditioning','podologue','trial','reborn'));

-- [2] get_package_remaining RPC: reborn 차감 추적 추가
CREATE OR REPLACE FUNCTION get_package_remaining(p_package_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'heated',          p.heated_sessions          - COALESCE(SUM(CASE WHEN ps.session_type = 'heated_laser'    AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'unheated',        p.unheated_sessions        - COALESCE(SUM(CASE WHEN ps.session_type = 'unheated_laser'  AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'iv',              p.iv_sessions              - COALESCE(SUM(CASE WHEN ps.session_type = 'iv'              AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'preconditioning', p.preconditioning_sessions - COALESCE(SUM(CASE WHEN ps.session_type = 'preconditioning' AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'podologe',        p.podologe_sessions        - COALESCE(SUM(CASE WHEN ps.session_type = 'podologue'       AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'trial',           p.trial_sessions           - COALESCE(SUM(CASE WHEN ps.session_type = 'trial'           AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'reborn',          p.reborn_sessions          - COALESCE(SUM(CASE WHEN ps.session_type = 'reborn'          AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'total_used',      COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0),
    'total_remaining', p.total_sessions           - COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0)
  )
  FROM packages p
  LEFT JOIN package_sessions ps ON ps.package_id = p.id
  WHERE p.id = p_package_id
  GROUP BY p.id, p.heated_sessions, p.unheated_sessions, p.iv_sessions,
           p.preconditioning_sessions, p.podologe_sessions, p.trial_sessions,
           p.reborn_sessions, p.total_sessions;
$$;
