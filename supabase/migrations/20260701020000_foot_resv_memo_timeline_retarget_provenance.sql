-- T-20260630-dopamine-FOOTRESV-MEMO-PUSH-DROP — SoT 재타겟(timeline-only) + ADDITIVE 멱등 provenance
-- ============================================================================
-- DA CONSULT #3 RULING(DA-20260701-FOOTRESV-MEMO-SOT-RETARGET, 2026-07-01 01:42) 반영.
--
-- ★ 문제(FE-read drift): 선행 DA binding은 reservations.memo = 풋 예약상세 팝업>예약메모 표시 SoT
--   를 전제했으나, 실제 표시부(ReservationDetailPopup.tsx <ReservationMemoTimeline>)는
--   reservation_memo_history(append-only timeline)만 read/write. → 도파민이 reservations.memo에
--   써도 영원히 미표시 = AC-1 false-green.
--
-- ★ 재타겟(timeline-only): ingest RPC가 p_memo non-empty 시 reservation_memo_history 에 기록.
--   reservations.memo 매핑(INSERT VALUES + ON CONFLICT COALESCE + cancel-path UPDATE)은 ★제거
--   (deprecated 컬럼 재오염 방지 + FE 미read = 무가치). reservations 다른 컬럼 upsert 불변.
--
-- ★ 멱등 provenance(ADDITIVE): source_system 컬럼 + partial unique index 로 외부 sync 행은
--   (reservation_id, source_system)당 단 1행. 재push=in-place upsert(스팸 0), 편집 재push=동일행
--   content 갱신(stale 0). 사람 저작 행(source_system NULL)=멱등 인덱스 제외=순수 append-only 보존.
--
-- ★ 구현 binding 6항(DA ruling):
--   1. clinic_id = v_clinic_id(p_clinic_slug 해석분) ★critical — 틀리면 RLS rmh_clinic_access로
--      foot 스태프 미가시 = silent AC-1 재실패.
--   2. reservations.memo 매핑 제거(timeline-only).
--   3. btrim + NULLIF empty guard 로 빈값 skip(no-op, AC-2).
--   4. source_system = p_source_system(reuse). created_by_name='도파민TM' 리터럴.
--   5. PII: content 평문 = 기존 timeline 사람메모와 동급(신규 PII 표면 0, pgsodium 불요).
--   6. p_memo 8th-position canon param 불변(인터페이스 안 깨짐).
--
-- ★ 선행 권위 body = 20260630193000_foot_tm_edit_cancel_lifecycle_guard.sql (17-arg + 가드#5).
--   본 migration = 그 body의 strict superset(reservations.memo 매핑 제거 + timeline 가드 INSERT 추가).
--   ⇒ 본 migration 이 upsert_reservation_from_source 의 새 최종 권위 body.
--      이후 193000/190000/rpc17 단독 재적용 금지(clobber).
--
-- ★ 게이트 = ADDITIVE 확정 → 대표게이트 면제(autonomy §3.1 ADDITIVE+DA GO). supervisor = DDL-diff only.
--   rollback: 20260701020000_foot_resv_memo_timeline_retarget_provenance.rollback.sql
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1. ADDITIVE: source_system provenance 컬럼 (NULL=원내 사람 저작, 'dopamine' 등=외부 sync)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.reservation_memo_history
  ADD COLUMN IF NOT EXISTS source_system text;

COMMENT ON COLUMN public.reservation_memo_history.source_system IS
  'T-20260630-FOOTRESV-MEMO-PUSH-DROP: 메모 행 머신 provenance. NULL=원내 사람 저작(append-only 보존), 비-NULL(예: dopamine)=외부 sync(reservation_id당 멱등 1행).';

-- ────────────────────────────────────────────────────────────────
-- 2. 멱등키: partial unique index — 외부 sync 행만 (reservation_id, source_system)당 1행.
--    사람 저작 행(source_system NULL)은 WHERE 절로 제외 → append-only 불변 보존.
-- ────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_rmh_resv_source
  ON public.reservation_memo_history (reservation_id, source_system)
  WHERE source_system IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 3. RPC 재구현 (strict superset): reservations.memo 매핑 제거 + timeline 가드 INSERT.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source(
  p_source_system       TEXT,
  p_external_id         TEXT,
  p_clinic_slug         TEXT,
  p_customer_phone      TEXT,
  p_customer_name       TEXT,
  p_reservation_date    DATE,
  p_reservation_time    TIME,
  p_memo                TEXT    DEFAULT NULL,
  p_status              TEXT    DEFAULT 'confirmed',
  p_visit_type          TEXT    DEFAULT 'new',
  p_created_via         TEXT    DEFAULT NULL,
  p_service_id          UUID    DEFAULT NULL,
  p_registrar_id        UUID    DEFAULT NULL,
  p_registrar_name      TEXT    DEFAULT NULL,
  p_customer_real_name  TEXT    DEFAULT NULL,
  p_customer_real_phone TEXT    DEFAULT NULL,
  p_is_companion        BOOLEAN DEFAULT false
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id      UUID;
  v_customer_id    UUID;
  v_reservation_id UUID;
  v_norm_phone     TEXT;
  v_real_name      TEXT;
  v_created_via    TEXT;
  v_visit_type     TEXT;
  v_cur_status     TEXT;   -- 가드#5: 멱등키 행의 현재 lifecycle 상태(선조회)
  v_memo_clean     TEXT;   -- timeline 가드: btrim + NULLIF empty
  c_created_via_enum CONSTANT TEXT[] := ARRAY['manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin'];
  c_visit_type_enum  CONSTANT TEXT[] := ARRAY['new','returning','experience'];
  -- 가드#5: 풋이 물리동선으로 이미 진행시킨(되돌리기 금지) 상태 집합.
  c_inflight_terminal CONSTANT TEXT[] := ARRAY['checked_in','done','no_show'];
BEGIN
  -- 1. 입력 검증 (멱등키)
  IF p_source_system IS NULL OR p_external_id IS NULL THEN
    RAISE EXCEPTION 'source_system and external_id are required' USING ERRCODE = '22023';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- (a)② 취소 fast-path (ADDITIVE) — p_status='cancelled' → 멱등키 행 cancelled 전이 + 슬롯 release.
  --   ★ self-mint scope(가드#3): source_system=p_source_system AND NOT NULL 인 행만 주소지정.
  --   ★ 멱등(가드#2): 이미 cancelled → 성공 no-op(기존 id 회신).
  --   ★ lifecycle 가드(#5): checked_in/done/no_show → reject(stale cancel clobber 금지).
  --   ★ memo: reservations.memo 매핑 제거(timeline-only). 취소는 timeline 기록 미대상(AC 범위 외).
  -- ────────────────────────────────────────────────────────────────
  IF lower(btrim(COALESCE(p_status, ''))) = 'cancelled' THEN
    SELECT r.id, r.status INTO v_reservation_id, v_cur_status
      FROM public.reservations r
     WHERE r.source_system IS NOT NULL
       AND r.source_system = p_source_system
       AND r.external_id   = p_external_id
     LIMIT 1;

    IF v_reservation_id IS NULL THEN
      RETURN NULL;
    END IF;

    IF v_cur_status = 'cancelled' THEN
      RETURN v_reservation_id;
    END IF;

    IF v_cur_status = ANY (c_inflight_terminal) THEN
      RAISE EXCEPTION 'lifecycle-invalid cancel: reservation % is "%" (in-flight/terminal) — TM cancel rejected (foot physical-flow owns lifecycle)',
        v_reservation_id, v_cur_status
        USING ERRCODE = 'P0001', HINT = 'LIFECYCLE_INVALID';
    END IF;

    -- confirmed/reserved → cancelled 전이 + 슬롯 release. (reservations.memo 매핑 제거: 다른 컬럼 불변)
    UPDATE public.reservations r
       SET status     = 'cancelled',
           updated_at = now()
     WHERE r.id = v_reservation_id;

    RETURN v_reservation_id;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- ★ 가드#5 (active 재푸시): self-mint 행이 이미 물리동선 진행/취소 상태면 stale edit clobber 금지 → reject.
  -- ────────────────────────────────────────────────────────────────
  SELECT r.status INTO v_cur_status
    FROM public.reservations r
   WHERE r.source_system IS NOT NULL
     AND r.source_system = p_source_system
     AND r.external_id   = p_external_id
   LIMIT 1;

  IF v_cur_status = ANY (c_inflight_terminal) OR v_cur_status = 'cancelled' THEN
    RAISE EXCEPTION 'lifecycle-invalid edit: reservation (%/%) is "%" — TM stale edit rejected (foot physical-flow owns lifecycle)',
      p_source_system, p_external_id, v_cur_status
      USING ERRCODE = 'P0001', HINT = 'LIFECYCLE_INVALID';
  END IF;

  -- 2. 클리닉 조회 (active/upsert 경로)
  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'clinic_slug is required' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_clinic_id FROM public.clinics WHERE slug = p_clinic_slug;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_slug USING ERRCODE = '23503';
  END IF;

  -- 본명/동행명 스냅샷 (§4-2b): customer_real_name 우선 → 후방호환 customer_name 폴백.
  v_real_name := COALESCE(
    NULLIF(btrim(p_customer_real_name), ''),
    NULLIF(btrim(p_customer_name), '')
  );

  -- created_via / visit_type enum 가드 (비-enum → NULL/기본, CHECK 위반 500 차단)
  v_created_via := CASE WHEN p_created_via = ANY (c_created_via_enum) THEN p_created_via ELSE NULL END;
  v_visit_type  := CASE WHEN COALESCE(p_visit_type,'new') = ANY (c_visit_type_enum)
                        THEN COALESCE(p_visit_type,'new') ELSE 'new' END;

  -- 3~4. customer 산출 (discriminator-gated)
  IF p_is_companion THEN
    v_customer_id := NULL;
    v_norm_phone  := NULL;
  ELSE
    v_norm_phone := public.normalize_phone(p_customer_phone);
    INSERT INTO public.customers (clinic_id, name, phone, visit_type)
    VALUES (v_clinic_id, p_customer_name, v_norm_phone, 'new')
    ON CONFLICT (clinic_id, phone) DO UPDATE SET
      name = CASE
        WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name <> '' THEN EXCLUDED.name
        ELSE customers.name
      END,
      updated_at = now()
    RETURNING id INTO v_customer_id;
  END IF;

  -- 5. 예약 upsert — (source_system, external_id) UNIQUE 멱등.
  --   ★ reservations.memo 매핑 제거(timeline-only): INSERT 컬럼 목록·VALUES·ON CONFLICT 에서 memo 제외.
  --     (reservations.memo = deprecated[T-20260504-MEMO-RESTRUCTURE], FE 미read.)
  INSERT INTO public.reservations (
    clinic_id, customer_id, customer_name, customer_phone,
    reservation_date, reservation_time,
    visit_type, status,
    source_system, external_id,
    created_via, service_id, registrar_id, registrar_name,
    customer_real_name
  ) VALUES (
    v_clinic_id, v_customer_id, p_customer_name, v_norm_phone,
    p_reservation_date, p_reservation_time,
    v_visit_type, COALESCE(p_status,'confirmed'),
    p_source_system, p_external_id,
    v_created_via, p_service_id, p_registrar_id, NULLIF(btrim(p_registrar_name),''),
    v_real_name
  )
  ON CONFLICT (source_system, external_id)
    WHERE source_system IS NOT NULL AND external_id IS NOT NULL
  DO UPDATE SET
    customer_id        = EXCLUDED.customer_id,
    customer_name      = EXCLUDED.customer_name,
    customer_phone     = EXCLUDED.customer_phone,
    reservation_date   = EXCLUDED.reservation_date,
    reservation_time   = EXCLUDED.reservation_time,
    visit_type         = EXCLUDED.visit_type,
    status             = EXCLUDED.status,
    created_via        = COALESCE(EXCLUDED.created_via, reservations.created_via),
    service_id         = COALESCE(EXCLUDED.service_id, reservations.service_id),
    registrar_id       = COALESCE(EXCLUDED.registrar_id, reservations.registrar_id),
    registrar_name     = COALESCE(EXCLUDED.registrar_name, reservations.registrar_name),
    customer_real_name = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_name),''), reservations.customer_real_name),
    updated_at         = now()
  RETURNING id INTO v_reservation_id;

  -- ────────────────────────────────────────────────────────────────
  -- ★ 6. 예약메모 timeline 가드 INSERT (SoT 재타겟 = reservation_memo_history).
  --   - 빈값 skip(btrim+NULLIF, Q3b: 빈값 재push=no-op → timeline 불변·기존 외부 memo 보존).
  --   - clinic_id = v_clinic_id ★critical (RLS rmh_clinic_access 가시성).
  --   - 멱등: (reservation_id, source_system) partial unique → 재push=in-place upsert(스팸 0),
  --     편집 재push=동일행 content 갱신(stale 0). 사람 행(source_system NULL) 미적용.
  --   - created_by_name='도파민TM'(표시 라벨) / created_by=NULL(staff 아님) /
  --     source_system=p_source_system(머신 provenance/멱등키, 두 축 분리).
  -- ────────────────────────────────────────────────────────────────
  v_memo_clean := NULLIF(btrim(p_memo), '');
  IF v_memo_clean IS NOT NULL THEN
    INSERT INTO public.reservation_memo_history
      (reservation_id, clinic_id, content, created_by, created_by_name, source_system)
    VALUES
      (v_reservation_id, v_clinic_id, v_memo_clean, NULL, '도파민TM', p_source_system)
    ON CONFLICT (reservation_id, source_system) WHERE source_system IS NOT NULL
    DO UPDATE SET
      content    = EXCLUDED.content,
      created_at = now();
  END IF;

  RETURN v_reservation_id;
END;
$$;

-- service_role 키로만 호출 (anon/authenticated 차단) — 17-arg 시그니처 기준 (REPLACE 는 ACL 보존)
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM authenticated;

COMMENT ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) IS
  '도파민/외부 → 풋CRM reservations 표준 멱등 upsert (17-arg superset + lifecycle 가드#5 + 예약메모 timeline 재타겟).
   (source_system, external_id) idempotent. p_memo non-empty → reservation_memo_history 멱등 upsert
   (created_by_name=도파민TM, source_system=p_source_system, (reservation_id,source_system) 1행).
   ★ reservations.memo 매핑 제거(deprecated, FE 미read) = timeline-only SoT.
   p_status=cancelled → self-mint 행만 cancelled 전이+슬롯 release. active 재푸시=mutable UPDATE(in-flight/terminal reject).
   9~17 trailing DEFAULT → 8-arg 후방호환. (TM-EDIT-CANCEL ⊃ MEMO-PUSH-DROP[timeline] ⊃ COMPANION + 가드#5)';

COMMIT;

-- 사후 검증 (수동):
--   (a) source_system ADDITIVE: \d+ reservation_memo_history → source_system text NULL.
--   (b) partial unique: \di+ uq_rmh_resv_source → UNIQUE, predicate (source_system IS NOT NULL).
--   (c) RPC reservations.memo 제거: pg_get_functiondef(...) NOT ILIKE '%memo = COALESCE(EXCLUDED.memo%'
--       AND ILIKE '%reservation_memo_history%'.
--   (d) clinic_id=v_clinic_id 결선: functiondef ILIKE '%v_reservation_id, v_clinic_id, v_memo_clean%'.
--   (e) 사람 행(NULL) 멱등 미적용: INSERT INTO rmh(... source_system=NULL) 2회 → 2행(인덱스 미발화).
