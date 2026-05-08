-- T-20260508 C2 tickets: hira_consent, visit_route, assigned_staff_id
-- Tickets: C2-HIRA-CONSENT, C2-VISIT-ROUTE, C2-STAFF-DROPDOWN
-- Rollback: 20260508000060_chart2_c2_tickets.down.sql

ALTER TABLE customers
  -- C2-HIRA-CONSENT: 건강보험 조회 동의 Y/N
  ADD COLUMN IF NOT EXISTS hira_consent         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hira_consent_at      TIMESTAMPTZ,
  -- C2-VISIT-ROUTE: 방문경로 드롭다운
  ADD COLUMN IF NOT EXISTS visit_route          TEXT
    CONSTRAINT customers_visit_route_check
    CHECK (visit_route IS NULL OR visit_route IN ('TM','워크인','인바운드','지인소개')),
  -- C2-STAFF-DROPDOWN: 실제 직원 참조
  ADD COLUMN IF NOT EXISTS assigned_staff_id    UUID REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN customers.hira_consent      IS '건강보험 조회 동의 여부 (Y=true)';
COMMENT ON COLUMN customers.hira_consent_at   IS '건강보험 조회 동의 일시';
COMMENT ON COLUMN customers.visit_route       IS '방문경로: TM / 워크인 / 인바운드 / 지인소개';
COMMENT ON COLUMN customers.assigned_staff_id IS '담당 직원 FK (staff.id) — 데스크·상담실장 필터';
