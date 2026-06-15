-- T-20260615-foot-RLS-CLINIC-ISOLATION — Phase 2a (AC2 일부: anon→RPC SSOT, ADDITIVE)
-- 표준: cross_crm_data_contract.md §16-3 (v1.12) — anon 직접 SELECT 제거 → SECURITY DEFINER RPC 대체.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 본 Phase 2a = SECURITY DEFINER RPC 7종 생성 + anon GRANT EXECUTE 만. ADDITIVE / ZERO-REGRESSION.
--   · anon 직접 SELECT 정책은 **건드리지 않음** → 기존 키오스크/native 동선 무회귀(셀프체크인 회귀 0).
--   · 이 단계가 선결: FE(키오스크 foot-checkin + native SelfCheckIn.tsx)가 prod 에 존재하지 않는
--     RPC 를 호출할 수 없으므로, RPC 가 prod 에 **먼저** 떠야 FE 전환이 가능. (원래 Phase 2 가
--     RPC생성+anon SELECT제거를 한 트랜잭션에 묶어 deadlock 이었음 → 2a/2b 분리로 해소.)
--   · §16-3 "무삭제 금지 / 선대체 후 제거" 의 '선대체' 가 본 파일.
--
-- 시퀀싱(2a → FE 전환 → 2b):
--   2a (본 파일, db-gate 적용 가능): RPC 7종 + anon GRANT. additive.
--   FE 전환: ① foot-checkin 레포(도메인 밖, cross-repo) ② native src/pages/SelfCheckIn.tsx
--            가 anon 직접 SELECT + INSERT...RETURNING → 본 RPC 호출로 전환 (planner 조율).
--   2b (20260615180000_*.PHASE2B_HOLD): 두 FE 전환 완료 후에만 anon SELECT 정책 DROP + REVOKE.
--
-- 본 파일 = anon→RPC 대체 패턴의 SSOT(레퍼런스). body 횡전개 시 동일 2a/2b 구조 포크.
-- author: dev-foot / 2026-06-15
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── [읽기 대체] 1) 예약 배너 (전화번호 → 오늘 confirmed 예약 1건) ──────────────
--   대체 대상: SelfCheckIn 전화 입력 시 reservations 직접 SELECT(reservation_time, visit_type).
--   최소 노출: 시간/방문유형만. clinic 스코프 + 오늘(KST) + status='confirmed' 한정.
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_reservation_banner(
  p_clinic_id UUID,
  p_phone     TEXT
)
RETURNS TABLE(reservation_time TIME WITHOUT TIME ZONE, visit_type TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.reservation_time, r.visit_type
    FROM reservations r
   WHERE r.clinic_id = p_clinic_id
     AND r.reservation_date = (now() AT TIME ZONE 'Asia/Seoul')::date
     AND r.status = 'confirmed'
     AND regexp_replace(COALESCE(r.customer_phone,''),'\D','','g')
           = regexp_replace(COALESCE(p_phone,''),'\D','','g')
     AND length(regexp_replace(COALESCE(p_phone,''),'\D','','g')) >= 8
   ORDER BY r.reservation_time ASC
   LIMIT 1
$$;

-- ── [읽기 대체] 2) 전화번호 → 기존 고객 id (포맷 변종 digit 비교 통합) ─────────
--   대체 대상: customers 직접 SELECT(id) 3종 변종. id 만 반환(PII 최소).
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_find_customer(
  p_clinic_id UUID,
  p_phone     TEXT
)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM customers c
   WHERE c.clinic_id = p_clinic_id
     AND length(regexp_replace(COALESCE(p_phone,''),'\D','','g')) >= 9
     AND regexp_replace(COALESCE(c.phone,''),'\D','','g')
           = regexp_replace(COALESCE(p_phone,''),'\D','','g')
   ORDER BY c.created_at DESC NULLS LAST
   LIMIT 1
$$;

-- ── [읽기 대체] 3) 당일 기존 체크인 (customer_id 기준) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_existing_checkin_today(
  p_clinic_id   UUID,
  p_customer_id UUID
)
RETURNS TABLE(id UUID, queue_number INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ci.id, ci.queue_number
    FROM check_ins ci
   WHERE ci.clinic_id = p_clinic_id
     AND ci.customer_id = p_customer_id
     AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
   ORDER BY ci.checked_in_at DESC
   LIMIT 1
$$;

-- ── [읽기 대체] 4) 당일 예약 매칭 (customer_id → phone → name 순) ──────────────
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_match_reservation(
  p_clinic_id   UUID,
  p_customer_id UUID,
  p_phone       TEXT,
  p_name        TEXT
)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_id    UUID;
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT r.id INTO v_id FROM reservations r
     WHERE r.clinic_id=p_clinic_id AND r.customer_id=p_customer_id
       AND r.reservation_date=v_today AND r.status='confirmed'
     ORDER BY r.reservation_time ASC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  IF length(v_digits) >= 8 THEN
    SELECT r.id INTO v_id FROM reservations r
     WHERE r.clinic_id=p_clinic_id AND r.reservation_date=v_today AND r.status='confirmed'
       AND regexp_replace(COALESCE(r.customer_phone,''),'\D','','g') = v_digits
     ORDER BY r.reservation_time ASC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    -- 끝 8자리 폴백
    SELECT r.id INTO v_id FROM reservations r
     WHERE r.clinic_id=p_clinic_id AND r.reservation_date=v_today AND r.status='confirmed'
       AND right(regexp_replace(COALESCE(r.customer_phone,''),'\D','','g'),8) = right(v_digits,8)
     ORDER BY r.reservation_time ASC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  IF COALESCE(btrim(p_name),'') <> '' THEN
    SELECT r.id INTO v_id FROM reservations r
     WHERE r.clinic_id=p_clinic_id AND r.reservation_date=v_today AND r.status='confirmed'
       AND r.customer_name = btrim(p_name)
     ORDER BY r.reservation_time ASC LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

-- ── [읽기 대체] 5) 예약 연결 체크인 (reservation_id 기준, cancelled 제외) ───────
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_linked_checkin(
  p_clinic_id      UUID,
  p_reservation_id UUID
)
RETURNS TABLE(id UUID, queue_number INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ci.id, ci.queue_number FROM check_ins ci
   WHERE ci.clinic_id = p_clinic_id
     AND ci.reservation_id = p_reservation_id
     AND ci.status <> 'cancelled'
   LIMIT 1
$$;

-- ── [쓰기 대체] 6) 고객 upsert (find-or-create) — INSERT...RETURNING 대체 ───────
--   anon SELECT 제거(2b) 후 .insert().select() 가 42501 → 본 RPC 로 id 반환. clinic 스코프 강제.
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer(
  p_clinic_id      UUID,
  p_name           TEXT,
  p_phone          TEXT,
  p_visit_type     TEXT,
  p_sms_opt_in     BOOLEAN DEFAULT NULL,
  p_birth_date     TEXT    DEFAULT NULL,
  p_address        TEXT    DEFAULT NULL,
  p_postal_code    TEXT    DEFAULT NULL,
  p_address_detail TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
BEGIN
  IF p_clinic_id IS NULL OR length(v_digits) < 9 THEN
    RAISE EXCEPTION 'invalid input';
  END IF;
  SELECT c.id INTO v_id FROM customers c
   WHERE c.clinic_id=p_clinic_id
     AND regexp_replace(COALESCE(c.phone,''),'\D','','g') = v_digits
   ORDER BY c.created_at DESC NULLS LAST LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE customers SET
      sms_opt_in    = COALESCE(p_sms_opt_in, sms_opt_in),
      sms_opt_in_at = CASE WHEN p_sms_opt_in IS TRUE THEN now()
                           WHEN p_sms_opt_in IS FALSE THEN NULL ELSE sms_opt_in_at END,
      address        = COALESCE(NULLIF(btrim(p_address),''), address),
      postal_code    = COALESCE(NULLIF(btrim(p_postal_code),''), postal_code),
      address_detail = COALESCE(NULLIF(btrim(p_address_detail),''), address_detail)
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO customers(clinic_id, name, phone, visit_type, sms_opt_in, sms_opt_in_at,
                        birth_date, address, postal_code, address_detail)
  VALUES (p_clinic_id, btrim(p_name), p_phone,
          CASE WHEN p_visit_type='new' THEN 'new' ELSE 'returning' END,
          p_sms_opt_in, CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
          NULLIF(btrim(p_birth_date),''), NULLIF(btrim(p_address),''),
          NULLIF(btrim(p_postal_code),''), NULLIF(btrim(p_address_detail),''))
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  SELECT c.id INTO v_id FROM customers c
   WHERE c.clinic_id=p_clinic_id
     AND regexp_replace(COALESCE(c.phone,''),'\D','','g') = v_digits
   ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  RETURN v_id;
END;
$$;

-- ── [쓰기 대체] 7) check_in 생성 — INSERT...RETURNING 대체 (id 반환) ───────────
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_create_check_in(
  p_clinic_id      UUID,
  p_customer_id    UUID,
  p_customer_name  TEXT,
  p_customer_phone TEXT,
  p_visit_type     TEXT,
  p_status         TEXT,
  p_queue_number   INT,
  p_notes          JSONB,
  p_reservation_id UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_clinic_id IS NULL THEN RAISE EXCEPTION 'invalid input'; END IF;
  -- 셀프체크인 허용 status 화이트리스트(기존 anon_insert_checkin_self 와 동일 제약)
  IF p_status NOT IN ('registered','treatment_waiting','consult_waiting','receiving') THEN
    RAISE EXCEPTION 'status not allowed for self check-in: %', p_status;
  END IF;
  INSERT INTO check_ins(clinic_id, customer_id, customer_name, customer_phone,
                        visit_type, status, queue_number, notes, reservation_id, checked_in_at)
  VALUES (p_clinic_id, p_customer_id, btrim(p_customer_name), p_customer_phone,
          p_visit_type, p_status, p_queue_number, p_notes, p_reservation_id, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- EXECUTE: anon 키오스크 경로 + authenticated. (§16-3 "anon RPC 경로만 GRANT EXECUTE 명시 개방")
GRANT EXECUTE ON FUNCTION
  public.fn_selfcheckin_reservation_banner(UUID,TEXT),
  public.fn_selfcheckin_find_customer(UUID,TEXT),
  public.fn_selfcheckin_existing_checkin_today(UUID,UUID),
  public.fn_selfcheckin_match_reservation(UUID,UUID,TEXT,TEXT),
  public.fn_selfcheckin_linked_checkin(UUID,UUID),
  public.fn_selfcheckin_upsert_customer(UUID,TEXT,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT),
  public.fn_selfcheckin_create_check_in(UUID,UUID,TEXT,TEXT,TEXT,TEXT,INT,JSONB,UUID)
TO anon, authenticated;

COMMIT;
