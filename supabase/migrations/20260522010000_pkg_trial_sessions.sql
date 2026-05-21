-- T-20260522-foot-PKG-TRIAL: packages + package_templates에 trial_sessions/trial_unit_price 컬럼 추가
-- 구입 티켓 추가 화면에 "체험권" 5번째 항목 신설 — 기존 4종(가열/비가열/포돌로게/수액)과 동일 패턴
-- Rollback: 20260522010000_pkg_trial_sessions.down.sql
--
-- 설계 메모:
--   trial_sessions: 구입한 체험권 회차 (packages 테이블 기준)
--   trial_unit_price: 체험권 회당 수가 (packages 테이블 기준)
--   get_package_remaining RPC에 trial 차감 추적 추가
--   package_sessions.session_type 'trial' 허용은 20260521080000_pkg_sessions_trial.sql에서 기완료

-- [1] packages 테이블: trial_sessions, trial_unit_price 컬럼 추가
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS trial_sessions   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_unit_price INT DEFAULT 0;

-- [2] package_templates 테이블: trial_sessions, trial_unit_price 컬럼 추가
ALTER TABLE package_templates
  ADD COLUMN IF NOT EXISTS trial_sessions   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_unit_price INT DEFAULT 0;

-- [3] get_package_remaining RPC 갱신: trial 차감 추적 추가
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
    'trial',           p.trial_sessions           - COALESCE(SUM(CASE WHEN ps.session_type = 'trial'          AND ps.status = 'used' THEN 1 ELSE 0 END), 0),
    'total_used',      COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0),
    'total_remaining', p.total_sessions           - COALESCE(COUNT(ps.id) FILTER (WHERE ps.status = 'used'), 0)
  )
  FROM packages p
  LEFT JOIN package_sessions ps ON ps.package_id = p.id
  WHERE p.id = p_package_id
  GROUP BY p.id, p.heated_sessions, p.unheated_sessions, p.iv_sessions,
           p.preconditioning_sessions, p.podologe_sessions, p.trial_sessions, p.total_sessions;
$$;
