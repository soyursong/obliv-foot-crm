-- T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS  (A안 재컨펌 — 8/1 자동원복 해제)
-- 대표원장(문지은) A안 재컨펌 완료 2026-07-25 09:00 KST (ts 1784937364.145639)
-- planner NEW-TASK MSG-20260725-090449-wfwp / P1
--
-- ════════════════════════════════════════════════════════════════════════
-- 목적(개정): 김주연 총괄 계정(user_profiles.id = ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12,
--   juyeon@medibuilder.com)의 director(원장) 임시권한을 8/1 자동원복 없이 라이브 유지한다.
--   원복은 김주연 총괄이 "원복해줘" 요청할 때까지 발동하지 않으며, 요청 수신 시에만
--   canonical 함수(→admin)로 수동 발동한다.
--
-- ★ 선행 상태(20260724210000 마이그로 설치됨) ★
--   - 함수 foot_juyeon_tempgrant_tick(timestamptz): 발효 전 no-op / window admin→director /
--     8/1↑ director→admin(자동원복) + 잡 자기해지.  ← 이 8/1 자동원복 브랜치를 본 마이그가 무력화.
--   - cron job foot-juyeon-tempgrant-lifecycle (*/15): tick() 폴.
--   - 대상 role: 7/25 00:00 KST 발효로 이미 'director' (grant 라이브).
--
-- ── 본 마이그가 하는 일 (A안) ────────────────────────────────────────────────
--   1. 자동원복 브랜치 비활성화 — tick() 을 재정의해 (a) 8/1 만료 revert 로직 제거,
--      (b) 재부여(re-grant) 로직도 제거 → cron 경로는 순수 'hold' no-op. 스케줄은 유지하되
--      revert 미발동(planner 지시 옵션 1). grant 는 director 라이브 유지.
--   2. baseline='admin'(v_orig_role) 정본 절대 보존 — 스냅샷 재기록 없음. 두 함수 모두
--      v_orig_role := 'admin' **하드코딩 상수**. 현재 role(=director)을 baseline 으로 읽지
--      않는다 → original=director 잘못 고착(영구 director) 사고 원천 차단.
--   3. on-request 원복 경로 유지 — canonical 함수 foot_juyeon_tempgrant_revert() 신설.
--      총괄 "원복해줘" 수신 시에만 SELECT public.foot_juyeon_tempgrant_revert(); 로
--      director→admin(=v_orig_role) 수동 발동 + 잡 해지. 신규 스냅샷/수동 원복 티켓 불요.
--
-- ADDITIVE / db_change=true (신규 컬럼·테이블·enum = 0):
--   - CREATE OR REPLACE 함수 1 (foot_juyeon_tempgrant_tick, 동일 시그니처 — 자동원복 제거)
--   - 신규 함수 1 (foot_juyeon_tempgrant_revert — on-request 원복 canonical)
--   - 계정 1행 role ensure(admin→director, idempotent — grant 라이브 보장)
--   - cron 스케줄 재확인(upsert, 동일 */15 — 미발동 hold)
--   → §S2.4 데이터 정책 게이트 대상 아님(선례 redpay_reconcile_cron 20260710190000, DA 면제).
--     supervisor DDL-diff 게이트 대상(함수 = DDL 오브젝트).
--
-- Rollback: 20260725170000_foot_juyeon_tempgrant_disable_autorevert.rollback.sql
--   (선행 20260724210000 tick 자동원복 함수로 복원 + revert 함수 DROP + 스케줄 복원)
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. 사전 가드(fail-closed): 대상 계정 존재 + role ∈ {admin, director} ─────────
--    A안 시점 기대 role='director'(grant 라이브). admin(=발효 미도래 잔여)도 허용하여
--    ensure-grant 로 director 로 끌어올린다. 그 외 role(=예상 밖 상태) → abort.
DO $guard$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
   WHERE id = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'ABORT: 김주연(ee67fc6b) 계정 부재 — 상태 divergence. 재확인 후 재적용.';
  END IF;
  IF v_role NOT IN ('admin', 'director') THEN
    RAISE EXCEPTION 'ABORT: 김주연(ee67fc6b) role=% (기대 admin|director 아님) — divergence. baseline/상태 재확인.', v_role;
  END IF;
END
$guard$;

-- ── 1. grant 라이브 보장(idempotent): admin→director. 이미 director 면 0행(no-op) ──
--    baseline 스냅샷 재기록 아님 — 임시부여 role 을 라이브로 확정할 뿐. 원복 대상 baseline
--    은 아래 함수의 v_orig_role='admin' 상수로만 정의된다.
UPDATE public.user_profiles
   SET role = 'director', updated_at = now()
 WHERE id = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12'
   AND role = 'admin';

-- ── 2. tick 함수 재정의: 자동원복 + 재부여 제거 → cron 경로 순수 hold no-op ─────────
--    동일 시그니처(timestamptz) 유지 → CREATE OR REPLACE 안전(오버로드 없음).
--    이제 tick() 은 시각과 무관하게 어떤 role 변경도 하지 않는다(8/1 도래해도 미발동).
CREATE OR REPLACE FUNCTION public.foot_juyeon_tempgrant_tick(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $fn$
DECLARE
  v_id        uuid := 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';  -- 김주연(juyeon@medibuilder.com)
  v_orig_role text := 'admin';      -- ★ canonical baseline(원복 대상). 스냅샷 재기록 금지 — 상수 고정.
  v_temp_role text := 'director';   -- 임시부여(라이브) role
BEGIN
  -- A안: 자동원복 없음, 재부여 없음. grant(director)는 라이브 유지. cron 은 no-op hold.
  -- (향후 on-request 원복 결과를 clobber 하지 않기 위해 tick 은 어떤 role write 도 하지 않는다.)
  RETURN jsonb_build_object(
    'action', 'hold', 'rows', 0, 'p_now', p_now,
    'orig_role', v_orig_role, 'temp_role', v_temp_role, 'target', v_id,
    'auto_revert', false,
    'note', 'A안 — 8/1 자동원복 해제. 원복은 foot_juyeon_tempgrant_revert() on-request.'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.foot_juyeon_tempgrant_tick(timestamptz) FROM PUBLIC;

-- ── 3. canonical on-request 원복 함수 (총괄 "원복해줘" 수신 시에만 명시 호출) ──────────
--    director → admin(=v_orig_role 상수) + lifecycle 잡 해지. idempotent.
--    실행 예: SELECT public.foot_juyeon_tempgrant_revert();  (supervisor/service_role)
CREATE OR REPLACE FUNCTION public.foot_juyeon_tempgrant_revert()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $rv$
DECLARE
  v_id        uuid := 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
  v_orig_role text := 'admin';      -- ★ canonical baseline — 원복 목적지. 절대 director 로 두지 않음.
  v_temp_role text := 'director';
  v_changed   int  := 0;
BEGIN
  UPDATE public.user_profiles
     SET role = v_orig_role, updated_at = now()
   WHERE id = v_id AND role = v_temp_role;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  -- lifecycle 잡 해지(존재할 때만). 원복 후 폴링 불요.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-juyeon-tempgrant-lifecycle') THEN
    PERFORM cron.unschedule('foot-juyeon-tempgrant-lifecycle');
  END IF;

  RAISE LOG 'foot-juyeon-tempgrant: ON-REQUEST REVERT director->admin (rows=%) at %', v_changed, now();
  RETURN jsonb_build_object(
    'action', 'revert', 'rows', v_changed, 'orig_role', v_orig_role,
    'temp_role', v_temp_role, 'target', v_id
  );
END;
$rv$;

REVOKE ALL ON FUNCTION public.foot_juyeon_tempgrant_revert() FROM PUBLIC;

-- ── 4. lifecycle cron 스케줄 재확인(upsert, 동일 */15) — 유지하되 tick=hold 로 미발동 ──
--    cron.schedule(name,...) = 동명 upsert(pg_cron 1.6.4). 잡은 남기되 revert 안 함.
--    (on-request 원복 시 foot_juyeon_tempgrant_revert() 가 이 잡을 해지한다.)
SELECT cron.schedule(
  'foot-juyeon-tempgrant-lifecycle',
  '*/15 * * * *',
  $$SELECT public.foot_juyeon_tempgrant_tick();$$
);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- 적용 후 POSTCHECK (supervisor, 별도 실행):
--   -- (a) revert 브랜치 미발동 실증: tick 정의에 자동 UPDATE/revert 없음(hold only)
--   SELECT prosrc FROM pg_proc WHERE proname='foot_juyeon_tempgrant_tick';   -- 'hold' only, no revert
--   SELECT public.foot_juyeon_tempgrant_tick('2026-08-01 06:00:00+00'::timestamptz);  -- action=hold, rows=0
--   -- (b) role=director 유지
--   SELECT id, role FROM public.user_profiles WHERE id='ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';  -- director
--   -- (c) baseline='admin' 보존: 두 함수 v_orig_role 상수 = 'admin'
--   SELECT proname FROM pg_proc WHERE proname IN ('foot_juyeon_tempgrant_tick','foot_juyeon_tempgrant_revert');
--   -- (잡 유지 확인)
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname='foot-juyeon-tempgrant-lifecycle';
-- ════════════════════════════════════════════════════════════════════════
