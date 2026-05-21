-- Rollback: T-20260522-foot-PKG-TRIAL
-- 주의: 기존 trial_sessions > 0 데이터가 있으면 컬럼 제거 전 확인 필요
-- package_sessions.session_type 'trial' 허용 constraint는 별도 (20260521080000_pkg_sessions_trial.down.sql)

-- [1] get_package_remaining RPC 이전 버전으로 복구 (trial 제거)
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

-- [2] packages 테이블: trial 컬럼 제거
ALTER TABLE packages
  DROP COLUMN IF EXISTS trial_sessions,
  DROP COLUMN IF EXISTS trial_unit_price;

-- [3] package_templates 테이블: trial 컬럼 제거
ALTER TABLE package_templates
  DROP COLUMN IF EXISTS trial_sessions,
  DROP COLUMN IF EXISTS trial_unit_price;
