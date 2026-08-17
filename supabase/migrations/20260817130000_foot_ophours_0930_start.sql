-- ============================================================
-- T-20260817-foot-RESVSLOT-OPHOURS-0930 — up  (data-only UPDATE / ADDITIVE data / forward-only)
--   풋센터(종로, jongno-foot) 2026-09-01 세대 운영시간 델타: 시작시각 09:00 → 09:30.
--   발주: 김주연 총괄 최종확정(MSG-20260817-130650-ffa8 via responder, slack ts 1786784360.313339)
--         → planner approved(T-20260817-foot-RESVSLOT-OPHOURS-0930, 2026-08-17T13:12).
--
-- ── 부모 인프라 (08-15 배포본, prod 존재) ─────────────────────────────────────
--   T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901 이 clinic_operating_hours 세대 테이블 신설·prod 배포.
--   jongno-foot(74967aea) 2026-09-01 세대 6행(월~토) 이미 존재 · slot_interval 30 · last_booking_slot INCLUSIVE.
--   본 티켓 = 그 6행 中 시작시각(open_time) 만 09:00 → 09:30 으로 조정하는 순수 data UPDATE.
--
-- ── 확정 스펙 (9월 1일 이후 · 종로점만 · 총괄 확정표) ─────────────────────────
--   월~금(dow 1~5): 시작 09:30 / 마지막 슬롯 19:00(INCLUSIVE·불변) / 30분
--   토   (dow 6)   : 시작 09:30 / 마지막 슬롯 18:00(INCLUSIVE·불변) / 30분
--   일   (dow 0)   : 공식 휴무 유지(UI 휴무·실 예약 차단) = 현행 row-absent(negative-space) 그대로 무접촉.
--                    ★"테스트용 슬롯 개방"(row-present + is_closed 플래그)은 신규 컬럼 필요 →
--                      08-15 DA 결정(is_closed 발명 REJECT·휴무=row-absent) 역행 → 본 마이그 out-of-scope.
--                      DA CONSULT 1차 게이트(§8 risk#1) 경유 후 별건 처리(planner FOLLOWUP). AC-4 실차단 무변 유지.
--
-- ── DELTA ────────────────────────────────────────────────────────────────────
--   변경: open_time 09:00 → 09:30 (dow 1~6, effective_from=2026-09-01 세대행).
--   불변: close_time / last_booking_slot / effective_from / effective_to / 일요일 row-absent.
--   09-01 이전(현행 flat 3컬럼, clinics.open_time/close_time/weekend_close_time) = 무접촉 → forward-only 무교란(AC-2).
--   slot_interval(30) | (last−open): 평일 (19:00−09:30)=570m·570/30=19 ✓ / 토 (18:00−09:30)=510m·510/30=17 ✓
--     → 첫 슬롯 09:30 · 마지막 슬롯 19:00(평일)/18:00(토) 정확히 착지(off-by-one 무·정제 성립).
--
-- change_class = ADDITIVE data (data-only UPDATE · DDL 0 · 신규 컬럼 0 · 신규 테이블 0 · backfill 0 · DROP 0):
--   · 기존 6행의 open_time 1컬럼 값만 forward-only 갱신. mutation scope = 09-01 세대행 한정.
--   · 신규 클래스 아님 = 부모 08-15 세대 자산의 파라미터 튜닝(field-manager authority).
--   ★AC-1 HARD: 'ADDITIVE data'/'DDL 0' ≠ 게이트 면제. prod DML(UPDATE) 실재 = db_change=true.
--     → supervisor DB-GATE 물리 GO-token(db_apply_guard.sh lane) 선행 REQUIRED. apply_before_go 금지.
--     본 파일은 PROD 미적용(write0) 상태로 스테이징된다. GO-token 발행 전 prod UPDATE 선집행 금지.
--
-- ★scope: 이 repo = jongno-foot 단일 clinic. songdo-foot = 별도 CRM/DB → 무접촉.
-- ⚠ DOW 인코딩 = Postgres EXTRACT(DOW) = JS Date.getDay(): 0=일 … 6=토.
--
-- dry-run  : 20260817130000_foot_ophours_0930_start.dryrun.sql
-- rollback : 20260817130000_foot_ophours_0930_start.rollback.sql
-- ============================================================
BEGIN;

DO $$
DECLARE
  v_clinic_id UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';  -- 오블리브 종로 풋센터(jongno-foot)
  v_ef        DATE := DATE '2026-09-01';
  v_slug      TEXT;
  v_updated   int;
  v_wd_ok     int;   -- 갱신 후 09:30 착지한 dow 1~6 행수(기대 6)
  v_sun       int;   -- 일요일(dow 0) 행수(기대 0·무접촉)
BEGIN
  -- 방어: 하드코딩 clinic_id 가 실제 jongno-foot 인지 확인(songdo 오적재 방지).
  SELECT slug INTO v_slug FROM public.clinics WHERE id = v_clinic_id;
  IF v_slug IS DISTINCT FROM 'jongno-foot' THEN
    RAISE EXCEPTION 'clinic_id % slug=% (expected jongno-foot) — UPDATE abort', v_clinic_id, v_slug;
  END IF;

  -- 방어: 부모 09-01 세대행이 실재하는지(08-15 배포 전제). 부재 시 abort(무의미 no-op 조기 탐지).
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_operating_hours
    WHERE clinic_id = v_clinic_id AND effective_from = v_ef AND day_of_week BETWEEN 1 AND 6
  ) THEN
    RAISE EXCEPTION '09-01 세대행(dow 1~6) 부재 — 08-15 배포 전제 미충족, UPDATE abort';
  END IF;

  -- DELTA: 시작시각 09:00 → 09:30 (멱등: 이미 09:30 인 행은 미변경 → 재실행 시 v_updated=0).
  UPDATE public.clinic_operating_hours
     SET open_time = TIME '09:30'
   WHERE clinic_id      = v_clinic_id
     AND effective_from = v_ef
     AND day_of_week BETWEEN 1 AND 6       -- 월~토 (일요일 dow 0 무접촉)
     AND open_time <> TIME '09:30';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'clinic_operating_hours open_time 09:30 UPDATE ROW_COUNT=% (최초 기대=6·재실행 기대=0)', v_updated;

  -- 사후 검증 1: 09-01 세대 dow 1~6 = 전부 09:30.
  SELECT count(*) INTO v_wd_ok FROM public.clinic_operating_hours
   WHERE clinic_id = v_clinic_id AND effective_from = v_ef
     AND day_of_week BETWEEN 1 AND 6 AND open_time = TIME '09:30';
  IF v_wd_ok <> 6 THEN
    RAISE EXCEPTION '09-01 세대 09:30 착지 행수=% (기대 6) — abort', v_wd_ok;
  END IF;

  -- 사후 검증 2: 일요일(dow 0) 무접촉(휴무 row-absent 유지).
  SELECT count(*) INTO v_sun FROM public.clinic_operating_hours
   WHERE clinic_id = v_clinic_id AND effective_from = v_ef AND day_of_week = 0;
  IF v_sun <> 0 THEN
    RAISE EXCEPTION '일요일(dow 0) 행 존재(% 행) — 휴무 row-absent 위반(본 티켓 out-of-scope), abort', v_sun;
  END IF;

  -- 사후 검증 3: 마지막 슬롯(last_booking_slot)·운영종료(close_time) 불변(평일 19:00/20:00 · 토 18:00/19:00).
  IF EXISTS (
    SELECT 1 FROM public.clinic_operating_hours
     WHERE clinic_id = v_clinic_id AND effective_from = v_ef
       AND (
         (day_of_week BETWEEN 1 AND 5 AND (last_booking_slot <> TIME '19:00' OR close_time <> TIME '20:00'))
         OR (day_of_week = 6 AND (last_booking_slot <> TIME '18:00' OR close_time <> TIME '19:00'))
       )
  ) THEN
    RAISE EXCEPTION '마지막 슬롯/운영종료 변조 감지 — open_time 외 컬럼 불변 위반, abort';
  END IF;

  RAISE NOTICE 'clinic_operating_hours 09-01 세대 시작시각 09:30 조정 완료(월~토 6행, 마지막슬롯·일요일 무변)';
END $$;

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECK (supervisor DDL-diff / dev POSTCHECK)
-- [ ] jongno-foot(74967aea…) 09-01 세대 dow 1~6 = open_time '09:30' (6행)
-- [ ] 마지막 슬롯 불변: 평일 last_booking_slot '19:00'/close_time '20:00' · 토 '18:00'/'19:00'
-- [ ] 일요일(dow 0) = 0행(휴무 row-absent 무접촉·AC-4 실차단 유지)
-- [ ] clinics flat 3컬럼(open_time/close_time/weekend_close_time) 무변경 · 09-01 이전 무교란
-- [ ] DDL 0 (신규 테이블/컬럼/제약 없음) · 신규 npm 0
-- [ ] FE: 09-01(화) 첫 슬롯 09:30·마지막 19:00 / 09-05(토) 첫 09:30·마지막 18:00
--     / 08-31 이전 = 현행 flat 무교란 / 09-06(일) 슬롯 0·예약 차단(row-absent)
-- ============================================================
