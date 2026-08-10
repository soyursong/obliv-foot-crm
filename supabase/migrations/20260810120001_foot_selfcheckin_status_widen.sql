-- T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN
-- doctrine: DA-20260810-meta-RLS-DRIFT-GUARD-SEV1-TRIAGE
-- parent:   T-20260629-meta-RLS-DRIFT-GUARD-PROD-PERIODIC
-- class: B6 (가용성 P0, 노출 아님) / change-class = semantic-equiv ADDITIVE (read-set widen, scope 불변)
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 배경 (RLS Drift Guard 초회 triage)
-- ══════════════════════════════════════════════════════════════════════════════
-- 셀프체크인 배너/오늘 예약 명단 2종 RPC 가 reservations.status = 'confirmed' 단일값 필터 →
--   셀프체크인이 매칭 예약을 성공시키면 reservations.status 가 'confirmed'→'checked_in' 로 전이
--   (Dashboard.tsx:6347, CheckInDetailSheet.tsx:1024). 전이 후 confirmed-only 필터에서 사라짐
--   → 재방문 고객이 배너/명단에서 자기 예약을 못 봄 = false-empty (가용성 P0, PHI 노출 아님).
--   실분포 = ['checked_in','confirmed']. foot CHECK 제약(docs/T-20260711-...-SURVEY.md L40):
--   reservations.status IN ('confirmed','reserved','checked_in','cancelled','done','noshow','no_show').
--   → 'reserved'(대기)·'checked_in' 정당 vocabulary.
--
-- 교정: status = 'confirmed'  →  status IN ('confirmed','reserved','checked_in')
--   scalp2 T-20260723-scalp2-SELFCHECKIN-NATIVE-RPC-CONFIRMED-BIAS-CHECK(deployed) 선례 동형.
--   semantic-equiv ADDITIVE: read-set 만 넓힘. clinic_id + date 스코프 불변.
--   cancelled/done/noshow/no_show 는 계속 제외(배너 부적격 = 지점격리/노출면 무변).
--
-- 유일 델타: 두 함수의 WHERE status 필터 1줄씩. 그 외 시그니처·반환형·권한(anon/authenticated
--   EXECUTE)·SECURITY DEFINER·owner·search_path·마스킹 산식·정렬 전부 불변(function-diff = status 절만).
-- 멱등: CREATE OR REPLACE + GRANT 재부여 (반환 signature 동일 → ACL 보존).
-- 가역: rollback = 직전 prosrc(status='confirmed') 복원. 20260810120001_..._widen.rollback.sql
-- 게이트: db_change=true, e2e_spec_exempt_reason=db_only. DA CONSULT-REPLY GO 후 → supervisor
--   DDL-diff(function-diff) + DB-GATE GO-token 물리선행 → prod apply (apply_before_go 금지).
-- renumber(MIG-SCOPE-RECHECK §13.1.C, 2026-08-10): version slot 20260810120000 → 20260810120001.
--   SAME-REPO(obliv-foot-crm) 동일 slot 을 T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT
--   STEP7(classa_rebackfill_step7)이 점유 → schema_migrations ON CONFLICT DO NOTHING silent-skip
--   원장무결성 hazard 회피 위해 SELFCHECKIN-WIDEN 단일파일 distinct slot 으로 bump. apply 순서·GO-token
--   물리선행 불변(renumber = 파일-side 정정, no prod apply). 선례 T-20260802-foot-DAYCLOSE-VERSION-COLLISION-RENUMBER.

BEGIN;

-- ── 1) fn_selfcheckin_reservation_banner (base 20260615170000_rls_clinic_isolation_anon_rpc_additive) ──
--    유일 델타: r.status = 'confirmed' → r.status IN ('confirmed','reserved','checked_in')
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_reservation_banner(
  p_clinic_id UUID,
  p_phone     TEXT
)
RETURNS TABLE(reservation_time TIME WITHOUT TIME ZONE, visit_type TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.reservation_time, r.visit_type
    FROM reservations r
   WHERE r.clinic_id = p_clinic_id
     AND r.reservation_date = (now() AT TIME ZONE 'Asia/Seoul')::date
     AND r.status IN ('confirmed','reserved','checked_in')
     AND regexp_replace(COALESCE(r.customer_phone,''),'\D','','g')
           = regexp_replace(COALESCE(p_phone,''),'\D','','g')
     AND length(regexp_replace(COALESCE(p_phone,''),'\D','','g')) >= 8
   ORDER BY r.reservation_time ASC
   LIMIT 1
$$;

-- ── 2) fn_selfcheckin_today_reservations (base 20260721120000_selfcheckin_today_reservations_nfc_normalize_mask) ──
--    유일 델타: r.status = 'confirmed' → r.status IN ('confirmed','reserved','checked_in')
--    NFC 마스킹 래핑·시그니처·반환형 6컬럼·search_path='' 전부 보존.
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_today_reservations(
  p_clinic_id UUID,
  p_date      DATE
)
RETURNS TABLE(
  id               UUID,
  customer_id      UUID,
  customer_name    TEXT,
  customer_phone   TEXT,
  reservation_time TIME WITHOUT TIME ZONE,
  visit_type       TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    t.id,
    t.customer_id,
    CASE
      WHEN t.nm IS NULL OR btrim(t.nm) = ''       THEN t.nm
      WHEN char_length(btrim(t.nm)) = 1           THEN btrim(t.nm)
      WHEN char_length(btrim(t.nm)) = 2           THEN left(btrim(t.nm), 1) || '*'
      ELSE left(btrim(t.nm), 1)
           || repeat('*', char_length(btrim(t.nm)) - 2)
           || right(btrim(t.nm), 1)
    END                                                        AS customer_name,
    CASE
      WHEN t.ph IS NULL                              THEN NULL
      WHEN regexp_replace(t.ph, '\D', '', 'g') = ''  THEN NULL
      ELSE right(regexp_replace(t.ph, '\D', '', 'g'), 4)
    END                                                        AS customer_phone,
    t.reservation_time,
    t.visit_type
  FROM (
    SELECT
      r.id,
      r.customer_id,
      normalize(COALESCE(r.customer_name,  c.name), NFC)  AS nm,
      COALESCE(r.customer_phone, c.phone)                 AS ph,
      r.reservation_time,
      r.visit_type
    FROM public.reservations r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.clinic_id        = p_clinic_id     -- AC4 지점 격리
      AND r.reservation_date = p_date          -- AC4 인자 날짜(오늘 KST) 한정
      AND r.status IN ('confirmed','reserved','checked_in')  -- ★ WIDEN: false-empty 교정 (scalp2 동형)
  ) t
  ORDER BY t.reservation_time ASC;
$$;

ALTER  FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE) OWNER TO postgres;

-- 반환 signature 동일 → CREATE OR REPLACE 가 기존 ACL 보존. 안전차 GRANT 재부여 명시(멱등).
GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_reservation_banner(UUID, TEXT)
  TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_today_reservations(UUID, DATE) IS
  'T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN (base T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE): '
  '셀프체크인 anon 오늘 예약자 목록. 서버측 마스킹(name=성+끝자 홍*동, phone=뒤 4자리). '
  'status IN (confirmed,reserved,checked_in) 로 widen → 체크인 전이 후 false-empty 교정. '
  'clinic_id + date 스코프 유지 + search_path='''' 핀. 데이터 mutation 0.';

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (apply 후 supervisor DB-GATE / POSTCHECK)
-- ══════════════════════════════════════════════════════════════════════════════
--   -- 1) status 화이트리스트 widen 반영 (기대: 두 함수 prosrc 에 checked_in 포함)
--   SELECT p.proname, (p.prosrc LIKE '%checked_in%') AS has_widen
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('fn_selfcheckin_reservation_banner','fn_selfcheckin_today_reservations');
--   -- 기대: 둘 다 has_widen=true
--
--   -- 2) SECDEF/search_path/owner/ACL 불변 (기대: today=proconfig{search_path=""}, banner={search_path="public, pg_temp"})
--   SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('fn_selfcheckin_reservation_banner','fn_selfcheckin_today_reservations');
--
--   -- 3) anon EXECUTE 유지 (기대: 둘 다 true)
--   SELECT has_function_privilege('anon','public.fn_selfcheckin_reservation_banner(uuid,text)','EXECUTE'),
--          has_function_privilege('anon','public.fn_selfcheckin_today_reservations(uuid,date)','EXECUTE');
--
--   -- 4) behavioral: 오늘 checked_in 예약이 배너/명단에 표시 (false-empty 해소, cross-clinic 0 회귀)
