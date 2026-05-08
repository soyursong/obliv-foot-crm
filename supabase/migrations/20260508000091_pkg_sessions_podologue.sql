-- T-20260508-foot-C22-PKG-DEDUCT: package_sessions.session_type에 podologue 추가
-- + get_package_remaining RPC podologe_sessions 참조 추가
-- Rollback: 20260508000091_pkg_sessions_podologue.down.sql
--
-- 주의: packages.podologe_sessions 컬럼은 20260507000020_package_templates.sql에서 이미 추가됨
-- 컬럼명 오타(podologe, e하나)이나 기존 코드와 일치 — 변경하지 말 것

-- [1] session_type CHECK constraint에 podologue 추가
ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS package_sessions_session_type_check;

ALTER TABLE package_sessions
  ADD CONSTRAINT package_sessions_session_type_check
    CHECK (session_type IN ('heated_laser','unheated_laser','iv','preconditioning','podologue'));

-- [2] get_package_remaining: podologe_sessions 참조 추가
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
    'total_used',      COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0),
    'total_remaining', p.total_sessions           - COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0)
  )
  FROM packages p
  LEFT JOIN package_sessions ps ON ps.package_id = p.id
  WHERE p.id = p_package_id
  GROUP BY p.id, p.heated_sessions, p.unheated_sessions, p.iv_sessions,
           p.preconditioning_sessions, p.podologe_sessions, p.total_sessions;
$$;
