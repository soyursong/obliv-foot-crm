-- ============================================================
-- T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901 — up  (DDL + seed, ADDITIVE / forward-only)
--   풋센터(종로, jongno-foot) 운영시간 date-aware 세대 테이블 — 롱레 clinic_operating_hours VERBATIM MIRROR.
--   CEO 조종실 발주 MISSION (MSG-20260815-150459-1ma4) — 2026-09-01 forward-only 발효.
--
-- DA CONSULT-REPLY (결정 SSOT · 2건 정합 reconciliation):
--   본 티켓엔 data-architect CONSULT-REPLY 가 2건 존재하며, Q3(저장 시맨틱)에서 표면상 갈린다. 본 구현은 둘을 동시 충족한다.
--   (1) MSG-20260815-155009-sa8v (P1, done, ref DA-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901):
--       Q3 = last_booking_slot INCLUSIVE 저장 canonical (롱레 verbatim mirror). ← 본 테이블 저장 방식.
--   (2) MSG-20260815-154808-3yen / -154824-cp5l (ref DA-20260815-foot-JONGNO-OPHOURS-CHANGE):
--       Q3 = ★수정요청(load-bearing). foot flat 컬럼이 이미 EXCLUSIVE-close(close_time=마지막슬롯+interval,
--       generateSlots [open,close) schedule.ts) 이므로 (A)close_exclusive 저장 강권 / (B)INCLUSIVE 유지도 acceptable —
--       단 (B) 채택 시 4가드 의무: [컬럼 comment + SSOT 명문화 + resolver 변환지점 단일화 + off-by-one self-test].
--   ★reconciliation = 본 구현은 INCLUSIVE 저장((1) sa8v 지정) = (2) 3yen 옵션 (B). ∴ 3yen 옵션-B 4가드 전부 충족:
--       가드1 컬럼 comment      → 하단 COMMENT ON COLUMN last_booking_slot/close_time (INCLUSIVE↔EXCLUSIVE 명시).
--       가드2 SSOT 명문화       → 본 헤더 + types.ts OperatingHoursGeneration + schedule.ts slotWindowFor 주석.
--       가드3 변환지점 단일화   → schedule.ts slotWindowFor 의 addMinutes(row.last_booking_slot, slot_interval) 단 1곳.
--       가드4 off-by-one test   → tests/e2e/T-20260815-foot-JONGNO-OPHOURS-CHANGE.spec.ts T1 (마지막슬롯==last_booking_slot).
--       + DA Q1 fallback test  → 같은 spec T4/T5 (2026-08-31 이전 조회일 = flat 값, 회귀 0).
--   ★정정: 직전 초안이 ref 'DA-...-CHANGE'(-20260901 없음)를 'fabricated/무효'로 기록했으나, MSG-...-3yen/-cp5l 이
--       실재 DA 메시지로 해당 ref 를 사용함을 확인 → '무효' 기록 철회. 두 ref 는 동일 adjudication 의 병렬 스레드.
--       (4ab6900d 초안의 C-1~C-7 개별 인용만 무효 · 상위 verdict 는 양 reply 모두 CONDITIONAL-GO/ADDITIVE 로 일치.)
--   결정 SSOT 문서(참고) = agents/docs/da_replies/da_decision_foot_jongno_ophours_change_20260901_20260815.md
--
-- ── DA 판정 반영(초안 divergent → 롱레 canonical 정정) ──────────────────────────
--   Q1 = 신규 clinic_operating_hours 신설(canonical). clinic_schedules ADD COLUMN valid_from 확장 = 미채택.
--        ★read-path repoint 본 티켓 in-scope: seed 단독 = stale asset. FE resolver 를 operating_hours-우선 배선(clinic.ts/schedule.ts).
--   Q4-보강 census(3yen · census-gate) = **왜 신 테이블인가(1줄)**: 기존 dow-grained clinic_schedules 는 slot resolver 가
--        전혀 read 하지 않는 dead/unwired 자산이다(census 실측: `grep clinic_schedules src/` = 0건 · 실 소비는 flat 3컬럼뿐).
--        → date-aware 발효축을 dead 테이블에 볼트온하면 축 혼동 + 여전히 unwired. 신 테이블(=date-aware 상위집합) 채택이 깨끗.
--        clinic_schedules 는 무접촉 존치(RLS/audit 스크립트 참조만 존재 · slot 경로 무관 → 부작용 무).
--   Q2 = 롱레 verbatim mirror. dow→day_of_week · valid_from-only→effective_from+effective_to pair.
--   Q3 (발견 A) = last_booking_slot INCLUSIVE 저장 canonical. slot-exclusive boundary(last_booking_slot+interval)=resolver 파생-only(저장금지).
--        ★close_time = 독립 사실 컬럼(영업종료≠예약정책) = 파생 아님·2nd-SoT 아님 → 롱레 mirror 유지(초안 EXCLUSIVE-close 오인 제거 = 정정).
--   Q4 (휴무) = 일요일 정기휴무 = clinic_operating_hours 요일축(holidays 아님). is_closed 컬럼 = 롱레 census dispositive =
--        롱레 물리 DDL 에 is_closed 부재 → 신규 휴무 축(is_closed) 발명 REJECT → 휴무 = 해당 요일 row-absent(negative-space).
--   Q5 = 기존 clinic_schedules 무접촉 존치(FE 미참조 → drift moot). 09-01 이전 = flat fallback 무변(forward-only).
--   Q5/Q7 (RLS · 3yen census) = admin/manager ALL + approved SELECT + anon DENY. non-PHI config.
--        ★mirror-not-invent 실측: treatment_sets = `authenticated FOR ALL USING(true)`(개방 패턴) 확인. 단 3yen 은
--          "config 테이블에 clinic-scoped/config 헬퍼 선례 있으면 그 쪽 우선"이라 지시 → config 형제 clinic_schedules 는
--          20260426 rls_role_separation 에서 admin_all(is_admin_or_manager)+approved_read(is_approved_user) 로 강화됨(현행 prod).
--          ∴ treatment_sets 개방패턴 대신 clinic_schedules 강화패턴(is_admin_or_manager/is_approved_user)을 mirror = 더 강한 선례.
--          두 헬퍼 실존(20260423/20260426). anon = REVOKE(A7 surface 무증가).
--
-- change_class = ADDITIVE  (§3.1 CEO 파괴게이트 N/A):
--   · 신규 테이블 1개 · mutation 0 · backfill 0 · DROP 0 · jongno seed(6행) · forward-only.
--   · 기존 clinics flat 컬럼(open_time/close_time/weekend_close_time) 무변경.
--   · 2026-08-31 이전 = 세대행 미커버 → FE resolver 가 flat 컬럼 fallback(현행 동작 무교란, AC-2).
--   ★AC-1 HARD: 'ADDITIVE'/'§3.1 N/A' ≠ 게이트 면제. DDL 실재(CREATE TABLE + seed DML + RLS) = DDL-0 carve 아님
--     → supervisor DDL-diff + MIG-GATE + 물리 GO-token(db_apply_guard.sh lane) 선행 REQUIRED. apply_before_go 금지.
--     본 파일은 PROD 미적용(write0) 상태로 스테이징된다. GO-token 발행 전 prod DDL/DML/GRANT 선집행 금지.
--
-- ★scope: 이 repo = jongno-foot 단일 clinic(clinic.ts .single() by slug). songdo-foot = 별도 CRM/DB → 무접촉(AC-5).
--
-- ⚠ DOW 인코딩 = Postgres EXTRACT(DOW) = JS Date.getDay(): 0=일 … 6=토. (resolver·CHECK 동일 규약)
--
-- dry-run  : 20260815000000_foot_clinic_operating_hours_gen.dryrun.sql
-- rollback : 20260815000000_foot_clinic_operating_hours_gen.rollback.sql
-- ============================================================
BEGIN;

-- ─── 1. clinic_operating_hours 테이블 (롱레 verbatim mirror) ──────────────
CREATE TABLE IF NOT EXISTS public.clinic_operating_hours (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  day_of_week       SMALLINT    NOT NULL,           -- 0=일 … 6=토 (Postgres EXTRACT(DOW) / JS getDay)
  open_time         TIME        NOT NULL,           -- 영업개시 = 첫 신규 슬롯 하한
  close_time        TIME        NOT NULL,           -- 운영종료(독립 사실·표시). 슬롯 생성 상한과 분리(DA Q3).
  last_booking_slot TIME        NOT NULL,           -- 마지막 신규 예약 슬롯(INCLUSIVE 상한). close 와 별개. (DA Q3)
  effective_from    DATE        NOT NULL,           -- 세대 발효일(KST 영업일, 포함)
  effective_to      DATE,                           -- 세대 종료일(KST, 포함). NULL=무기한. (DA Q2: pair 필수)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clinic_operating_hours_dow_chk        CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT clinic_operating_hours_slot_bound_chk CHECK (last_booking_slot <= close_time),
  CONSTRAINT clinic_operating_hours_uq             UNIQUE (clinic_id, day_of_week, effective_from)
);

-- resolver 조회 최적화(clinic + dow + effective_from DESC) — 롱레 mirror.
CREATE INDEX IF NOT EXISTS idx_clinic_operating_hours_resolve
  ON public.clinic_operating_hours (clinic_id, day_of_week, effective_from DESC);

COMMENT ON TABLE public.clinic_operating_hours IS
  'DOW·세대별 운영시간 SSOT (롱레 clinic_operating_hours verbatim mirror). 마지막 신규 예약슬롯(last_booking_slot, INCLUSIVE)을 운영종료(close_time)와 분리. resolver=effective_from<=조회일 & effective_to 커버 최신세대·요일매칭 1행, 커버 세대 부재=clinics flat 3컬럼 fallback(forward-only). 휴무=해당 요일 row-absent(is_closed 컬럼 없음). day_of_week=EXTRACT(DOW) 0=일..6=토. T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901.';
COMMENT ON COLUMN public.clinic_operating_hours.close_time IS
  '운영종료(독립 사실·표시). 슬롯 상한 아님 — 슬롯 상한 = last_booking_slot(INCLUSIVE). foot 슬롯생성은 EXCLUSIVE close = last_booking_slot + slot_interval 로 resolver 가 파생(저장 아님). DA Q3.';
COMMENT ON COLUMN public.clinic_operating_hours.last_booking_slot IS
  '마지막 신규 예약 슬롯(INCLUSIVE 상한). 롱레 canonical mirror. 휴무 요일은 행 자체 부재(negative-space). DA Q3/Q4.';

-- ─── 2. RLS (DA Q7: admin/manager ALL + approved SELECT + anon DENY) ──────────
--   운영시간 = 非-PHI staff config. foot 헬퍼 is_admin_or_manager()/is_approved_user() mirror(census 확인).
ALTER TABLE public.clinic_operating_hours ENABLE ROW LEVEL SECURITY;

-- 읽기 = 승인된 스태프(FE clinic.ts resolver read-path).
DROP POLICY IF EXISTS clinic_operating_hours_approved_read ON public.clinic_operating_hours;
CREATE POLICY clinic_operating_hours_approved_read
  ON public.clinic_operating_hours FOR SELECT TO authenticated
  USING (public.is_approved_user());

-- 쓰기(ALL) = admin/manager (운영시간 관리 — 현재 FE UI 없음, 향후 대비 · seed 는 마이그 service_role).
DROP POLICY IF EXISTS clinic_operating_hours_admin_all ON public.clinic_operating_hours;
CREATE POLICY clinic_operating_hours_admin_all
  ON public.clinic_operating_hours FOR ALL TO authenticated
  USING (public.is_admin_or_manager())
  WITH CHECK (public.is_admin_or_manager());

-- anon DENY: TO public 금지 + anon 상속분 명시 REVOKE(foot anon_revoke_reftables 정책 정합, A7).
REVOKE ALL ON public.clinic_operating_hours FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_operating_hours TO authenticated;

-- ─── 3. 시드 — 2026-09-01 발효 세대(jongno-foot 단독, forward-only) ────────────
-- 확정 운영시간(CEO MISSION):
--   월~금(dow 1~5): open 09:00 / close 20:00(운영종료) / last_booking_slot 19:00(INCLUSIVE 마지막슬롯)
--   토   (dow 6)   : open 09:00 / close 19:00           / last_booking_slot 18:00
--   일   (dow 0)   : 휴무 → 행 미삽입(row-absent negative-space). ★is_closed 컬럼 없음(DA Q4).
-- 현행세대(2000-01-01) 행 미삽입 — 종로는 8/31까지 flat fallback 유지가 곧 무변경(forward-only 격리, AC-2).
-- 제약: CHECK(last_booking_slot <= close_time) → 평일 19:00<=20:00 ✓ / 토 18:00<=19:00 ✓.
DO $$
DECLARE
  v_clinic_id UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';  -- 오블리브 종로 풋센터(jongno-foot)
  v_ef        DATE := DATE '2026-09-01';
  v_slug      TEXT;
BEGIN
  -- 방어: 하드코딩 clinic_id 가 실제 jongno-foot 인지 확인(songdo 오적재 방지).
  SELECT slug INTO v_slug FROM public.clinics WHERE id = v_clinic_id;
  IF v_slug IS DISTINCT FROM 'jongno-foot' THEN
    RAISE EXCEPTION 'clinic_id % slug=% (expected jongno-foot) — 시드 abort', v_clinic_id, v_slug;
  END IF;

  -- 멱등: 해당 세대(effective_from) 이미 존재 시 스킵.
  IF EXISTS (
    SELECT 1 FROM public.clinic_operating_hours
    WHERE clinic_id = v_clinic_id AND effective_from = v_ef
  ) THEN
    RAISE NOTICE 'clinic_operating_hours 세대(% / %) 이미 존재 — 시드 스킵', v_clinic_id, v_ef;
    RETURN;
  END IF;

  INSERT INTO public.clinic_operating_hours
    (clinic_id, day_of_week, open_time, close_time, last_booking_slot, effective_from, effective_to)
  VALUES
    -- 일(0) = 휴무 → 행 없음(row-absent · DA Q4).
    (v_clinic_id, 1, TIME '09:00', TIME '20:00', TIME '19:00', v_ef, NULL),   -- 월
    (v_clinic_id, 2, TIME '09:00', TIME '20:00', TIME '19:00', v_ef, NULL),   -- 화
    (v_clinic_id, 3, TIME '09:00', TIME '20:00', TIME '19:00', v_ef, NULL),   -- 수
    (v_clinic_id, 4, TIME '09:00', TIME '20:00', TIME '19:00', v_ef, NULL),   -- 목
    (v_clinic_id, 5, TIME '09:00', TIME '20:00', TIME '19:00', v_ef, NULL),   -- 금
    (v_clinic_id, 6, TIME '09:00', TIME '19:00', TIME '18:00', v_ef, NULL)    -- 토
  ON CONFLICT (clinic_id, day_of_week, effective_from) DO NOTHING;

  RAISE NOTICE 'clinic_operating_hours 시드 완료(jongno-foot 2026-09-01 세대 6행, 일요일 row-absent 휴무)';
END $$;

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECK (supervisor DDL-diff / dev POSTCHECK)
-- [ ] clinic_operating_hours 테이블 존재 + FK clinic_id→clinics(id) ON DELETE CASCADE
--     + UNIQUE(clinic_id,day_of_week,effective_from) + CHECK(last_booking_slot<=close_time) + dow CHECK
-- [ ] 컬럼셋 = 롱레 verbatim mirror: day_of_week/open_time/close_time/last_booking_slot/effective_from/effective_to (is_closed 컬럼 부재)
-- [ ] RLS: approved SELECT(is_approved_user) + admin/manager ALL(is_admin_or_manager) + anon 무권한(REVOKE)
-- [ ] jongno-foot(74967aea…) 6행(월~토, effective_from=2026-09-01 / effective_to=NULL) · 일요일(dow 0) 0행(휴무 row-absent)
-- [ ] clinics 테이블 무변경(open_time/close_time/weekend_close_time 그대로)
-- [ ] songdo-foot(별도 DB) 무접촉
-- [ ] FE: 09-01(화) 마지막슬롯 19:00(20:00 부재) / 09-05(토) 18:00(19:00 부재) / 09-06(일) 슬롯 0·예약 차단
--     / 08-31 이전 = 현행(평일 20:00 / 토·일 18:00 / 일 영업) 무교란
-- [ ] ★slot_interval 의존성(3yen · 옵션 B): resolver 는 EXCLUSIVE close = last_booking_slot + live clinic.slot_interval 파생.
--     마지막슬롯 == last_booking_slot 이 정확하려면 clinic.slot_interval 이 (last_booking_slot − open_time) 을 정제(整除)해야 함.
--     jongno seed = open 09:00 / last 19:00(600m)·18:00(540m) → interval | gcd(600,540)=60 필요(10·12·15·20·30·60 OK).
--     실 jongno clinics.slot_interval(seed 기본 30) 을 POST-VERIFY 시 실측·확인(30=OK). 미정제면 마지막슬롯이 앞당겨짐(under-count·안전측).
-- ============================================================
