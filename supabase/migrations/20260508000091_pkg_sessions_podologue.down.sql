-- Rollback: T-20260508-foot-C22-PKG-DEDUCT podologue constraint + RPC revert

-- [1] session_type constraint 원복 (podologue 제거)
ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS package_sessions_session_type_check;

ALTER TABLE package_sessions
  ADD CONSTRAINT package_sessions_session_type_check
    CHECK (session_type IN ('heated_laser','unheated_laser','iv','preconditioning'));

-- [2] get_package_remaining RPC 원복 (podologe 제거)
-- 주의: 기존 podologue 데이터가 있으면 constraint violation 발생 가능. 확인 후 실행.
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
    'total_used',      COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0),
    'total_remaining', p.total_sessions           - COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0)
  )
  FROM packages p
  LEFT JOIN package_sessions ps ON ps.package_id = p.id
  WHERE p.id = p_package_id
  GROUP BY p.id, p.heated_sessions, p.unheated_sessions, p.iv_sessions,
           p.preconditioning_sessions, p.total_sessions;
$$;
