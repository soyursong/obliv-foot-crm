-- T-20260608-foot-PKG-REBORN-ITEM (REOPEN P0) rollback
-- CHECK 제약을 reborn 이전(trial 포함) 상태로 되돌리고 RPC 도 reborn 미포함으로 복원.
-- 주의: 롤백 전 package_sessions 에 session_type='reborn' 행이 존재하면 제약 위반으로 실패함.
--       (선 정리: DELETE FROM package_sessions WHERE session_type='reborn'; 또는 reborn 행 보존 필요 시 롤백 보류)

-- [1] CHECK 제약 reborn 제거 (trial 까지로 복원)
ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS package_sessions_session_type_check;

ALTER TABLE package_sessions
  ADD CONSTRAINT package_sessions_session_type_check
    CHECK (session_type IN ('heated_laser','unheated_laser','iv','preconditioning','podologue','trial'));

-- [2] get_package_remaining RPC reborn 제거 (trial 버전 복원)
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
    'total_used',      COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0),
    'total_remaining', p.total_sessions           - COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0)
  )
  FROM packages p
  LEFT JOIN package_sessions ps ON ps.package_id = p.id
  WHERE p.id = p_package_id
  GROUP BY p.id, p.heated_sessions, p.unheated_sessions, p.iv_sessions,
           p.preconditioning_sessions, p.podologe_sessions, p.trial_sessions, p.total_sessions;
$$;
