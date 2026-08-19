-- ============================================================================
-- SCAFFOLD ONLY — NOT FOR APPLY (write0 / DDL0)
-- T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE
-- (y) visit_route keep-widen — 2-table CHECK ADD (ADDITIVE·firewall-neutral)
-- ----------------------------------------------------------------------------
-- 근거: DA-BLESS-7 (MSG-20260819-163315-f5ey, DA-20260819-foot-INFLOW-VISITROUTE-
--       CHECK-WIDEN-ADDITIVE-BLESS) + planner INFO MSG-20260819-163750-4ck1.
-- 패턴: 20260716160000_foot_visit_route_gonghom_add.sql 준용 (2-table 대칭).
--
-- ⚠ 본 파일은 supabase/migrations/ apply-path **밖**(db-gate/)에 의도적으로 배치.
--    GO-token 前 오배포 물리 차단. finalize 시 실 timestamp 로 migrations/ 이관.
--
-- ⚠ APPLY 금지 조건 (미해소 = §4 introspection):
--    · OPEN-1 (F1): revisit(재방문) in/out 미확정 → widened set 리터럴 미확정.
--    · OPEN-2: 신규 항목 store-literal 폼(한글 라벨 vs canonical 코드) 미확정.
--    · OPEN-3: inbound.kakao enum = 별 DA CONSULT.
--    · supervisor MIG-GATE(2-table DDL-diff) + 물리 GO-token 선행 REQUIRED.
--
-- ★2-table 원자성: customers ∧ reservations 동일 widened set 동시 갱신.
--    1개만 widen = write fail·divergence (DA 명시).
-- ============================================================================

-- === PENDING widened set (placeholder — 실 리터럴 = F1 해소 + OPEN-2 확정 後) ===
--   기존 7값 (byte-parity, 존치 MANDATORY):
--     'TM','워크인','인바운드','지인소개','네이버','인콜','공홈'
--   신규 ADDITIVE 후보 (총괄 확정 SEPARATE 4항목 + 카톡; revisit=F1 pending):
--     · 에이전시            (canonical: partner.agency)            -- SEPARATE 정산
--     · 타센터연계          (canonical: internal.center_referral)  -- SEPARATE 정산
--     · 병원인계            (canonical: internal.transfer)         -- SEPARATE 정산
--     · 임직원가족          (canonical: internal.staff)            -- SEPARATE 정산
--     · 인바운드(카톡)      (canonical: inbound.kakao)             -- OPEN-3 DA enum 게이트
--     · <재방문>            (canonical: inbound.revisit)           -- ★F1 PENDING: in/out 미정
--   ※ 위 한글 라벨 폼 = OPEN-2 확정 前 잠정(mirror-not-invent). 실 offered-label 확정 시 fix.
--   ※ 신규 라벨은 VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE 미매핑 → deriveAssignLeadSource
--      WALK_IN 폴백 = 배정 money-shift 0 (accounting-neutral by-construction).

BEGIN;

-- ── 1) customers.visit_route (widened superset 재생성) ──────────────────────
-- ALTER TABLE public.customers
--   DROP CONSTRAINT IF EXISTS customers_visit_route_check;
-- ALTER TABLE public.customers
--   ADD CONSTRAINT customers_visit_route_check
--   CHECK (visit_route IS NULL OR visit_route IN (
--     'TM','워크인','인바운드','지인소개','네이버','인콜','공홈'   -- 기존 7값 존치
--     /* , <PENDING 신규 라벨: F1 + OPEN-2 확정 後 삽입> */
--   ));

-- ── 2) reservations.visit_route (동일 widened set — 2-table 대칭 MANDATORY) ──
-- ALTER TABLE public.reservations
--   DROP CONSTRAINT IF EXISTS reservations_visit_route_check;
-- ALTER TABLE public.reservations
--   ADD CONSTRAINT reservations_visit_route_check
--   CHECK (visit_route IS NULL OR visit_route IN (
--     'TM','워크인','인바운드','지인소개','네이버','인콜','공홈'   -- ★ customers 와 byte-동일
--     /* , <PENDING 신규 라벨: 위와 identical set> */
--   ));

-- ── 3) 검증 (finalize 時 활성화): 2-table 대칭 + 기존 7값 존치 + 신규값 포함 ──
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_constraint
--      WHERE conname = 'customers_visit_route_check'
--        AND pg_get_constraintdef(oid) LIKE '%공홈%'      -- 기존값 존치 sentinel
--        /* AND pg_get_constraintdef(oid) LIKE '%<신규값>%' */
--   ) THEN RAISE EXCEPTION 'customers_visit_route_check widen/존치 실패'; END IF;
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_constraint
--      WHERE conname = 'reservations_visit_route_check'
--        AND pg_get_constraintdef(oid) LIKE '%공홈%'
--        /* AND pg_get_constraintdef(oid) LIKE '%<신규값>%' */
--   ) THEN RAISE EXCEPTION 'reservations_visit_route_check widen/존치 실패'; END IF;
--   -- 2-table set 대칭 검증(finalize): 두 constraintdef 의 IN-리스트 identical.
-- END $$;

ROLLBACK;  -- ★SCAFFOLD: 실 apply 아님. finalize 시 COMMIT + migrations/ 이관.

-- ── ROLLBACK 계획 (finalize 시 별 .rollback.sql): 직전 7값 복원 (2-table 대칭) ──
--   customers/reservations _visit_route_check → ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈')
