-- ============================================================
-- T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL — STEP3 백필 apply
-- (Data-Correction Backfill SOP: 대상셋 freeze + before_image + dry-run + 멱등 + 판정근거 + 폴백)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase / prod)
-- 작성: dev-foot / 2026-08-13
-- 폴백: T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL_backfill_rollback.sql
--
-- ★★★ 하드가드: supervisor DB-GATE GO-token 발행 後에만 prod 실행. GO-token 前 apply 금지(apply_before_go). ★★★
-- ★★★ CEO informational surface(§3.1) — 승인게이트 아님(가역+A/A 확정)이나 apply 前 planner 경유 통지 필수. ★★★
--
-- ─── 확정 파라미터 (planner RESUME + reporter 김주연 총괄 field 권위) ──────────────
--   대상 = pre-0713 customers (created_at < 2026-07-13T00:00:00+09:00 = 7/12까지, 경계=B, 7/13 당일 EXCLUDE)
--   식별 = blanket ALL 218 = test (reporter "다 테스트용" 전부-테스트 지시 = DA blanket-REJECT override)
--   백필 = customers.is_test=true, 멱등 COALESCE(is_test,false)=false 만(이미 true 3건 제외 → 실 215건)
--   flag = customers 에만 (check_ins/payments/packages 무접촉)
--
-- ─── freeze 근거 (2026-08-13 READ-ONLY pin) ───────────────────────────────────────
--   frozen count       = 215
--   frozen id sha256    = 1396a1b85bfc2daf1feae04b17ad2aeabe6497d38f15f55cdffa04b6fb93a99b
--     (= sha256( string_agg(id::text, ',' ORDER BY created_at, id) ) over 대상셋 )
--   frozen created 범위 = 2026-05-19 06:34:03+00 ~ 2026-07-11 06:58:30+00 (전건 pre-0713)
--   대상셋 스냅샷 파일  = scripts/T-20260812-..._freeze_targetset.json (215 ids)
--   → apply 시 count/sha256 재계산해 frozen 값과 불일치면 ABORT(대상셋 drift 방어).
--
-- ─── disjoint ─────────────────────────────────────────────────────────────────────
--   체험권 차감 정정 31건(7/14+, 자매 TRIALDEDUCT)과 컷오프상 교집합 0 — 무접촉.
-- ============================================================

BEGIN;

-- ── 0) 판정근거 + before_image 를 담을 durable audit 테이블 (멱등 생성) ──────────────
CREATE TABLE IF NOT EXISTS public.backfill_audit_20260812_istest (
  id              uuid PRIMARY KEY,
  is_test_before  boolean,
  created_at_snap timestamptz,
  flipped_at      timestamptz NOT NULL DEFAULT now(),
  ticket          text NOT NULL DEFAULT 'T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL'
);

-- ── 1) FREEZE 검증 (대상셋 drift 방어 — frozen count/sha256 대조) ───────────────────
DO $$
DECLARE
  v_count int;
  v_sha   text;
  c_frozen_count int  := 215;
  c_frozen_sha   text := '1396a1b85bfc2daf1feae04b17ad2aeabe6497d38f15f55cdffa04b6fb93a99b';
BEGIN
  SELECT count(*)::int,
         encode(digest(COALESCE(string_agg(id::text, ',' ORDER BY created_at, id), ''), 'sha256'), 'hex')
    INTO v_count, v_sha
  FROM public.customers
  WHERE created_at < '2026-07-13T00:00:00+09:00'
    AND COALESCE(is_test, false) = false;

  RAISE NOTICE '[FREEZE] live count=% sha256=%', v_count, v_sha;
  RAISE NOTICE '[FREEZE] frozen count=% sha256=%', c_frozen_count, c_frozen_sha;

  IF v_count <> c_frozen_count THEN
    RAISE EXCEPTION '[ABORT] 대상셋 count drift: live % <> frozen % — reporter/planner 재확인 필요',
      v_count, c_frozen_count;
  END IF;
  IF v_sha <> c_frozen_sha THEN
    RAISE EXCEPTION '[ABORT] 대상셋 id-set drift: live sha % <> frozen sha % — 구성원 변동, 재freeze 필요',
      v_sha, c_frozen_sha;
  END IF;
  RAISE NOTICE '[FREEZE] OK — 대상셋 무변동 (215 / sha 정합)';
END $$;

-- ── 2) before_image 스냅샷 (멱등: 이미 감사행 있으면 skip) ─────────────────────────
INSERT INTO public.backfill_audit_20260812_istest (id, is_test_before, created_at_snap)
SELECT id, is_test, created_at
FROM public.customers
WHERE created_at < '2026-07-13T00:00:00+09:00'
  AND COALESCE(is_test, false) = false
ON CONFLICT (id) DO NOTHING;

-- ── 3) dry-run count (apply 직전 규모 로깅) ────────────────────────────────────────
DO $$
DECLARE v_will int;
BEGIN
  SELECT count(*)::int INTO v_will
  FROM public.customers cu
  JOIN public.backfill_audit_20260812_istest a ON a.id = cu.id
  WHERE COALESCE(cu.is_test, false) = false;      -- 멱등: 아직 false 인 것만 flip 예정
  RAISE NOTICE '[DRY-RUN] flip 예정 행 수 = % (기대 215)', v_will;
END $$;

-- ── 4) APPLY (멱등 UPDATE — audit 대상셋 ∩ 아직 false) ─────────────────────────────
UPDATE public.customers cu
SET is_test = true
FROM public.backfill_audit_20260812_istest a
WHERE cu.id = a.id
  AND COALESCE(cu.is_test, false) = false;         -- 멱등 가드 (재실행 안전)

-- ── 5) POST-VERIFY (기대치 대조 — 불일치면 트랜잭션 ROLLBACK 유도) ────────────────
DO $$
DECLARE
  v_flipped int;
  v_remaining_false int;
  v_boundary_touch int;
BEGIN
  -- audit 대상 중 이제 true 가 된 수 = 215 이어야
  SELECT count(*)::int INTO v_flipped
  FROM public.customers cu JOIN public.backfill_audit_20260812_istest a ON a.id = cu.id
  WHERE cu.is_test IS TRUE;
  IF v_flipped <> 215 THEN
    RAISE EXCEPTION '[ABORT] flip 후 true 수 % <> 215', v_flipped;
  END IF;

  -- audit 대상 중 아직 false 로 남은 것 = 0 이어야
  SELECT count(*)::int INTO v_remaining_false
  FROM public.customers cu JOIN public.backfill_audit_20260812_istest a ON a.id = cu.id
  WHERE COALESCE(cu.is_test, false) = false;
  IF v_remaining_false <> 0 THEN
    RAISE EXCEPTION '[ABORT] flip 후 잔여 false % <> 0', v_remaining_false;
  END IF;

  -- 7/13 당일(경계 EXCLUDE) 및 pre-cutoff 밖 고객은 audit 에 없어야(무접촉 증명)
  SELECT count(*)::int INTO v_boundary_touch
  FROM public.backfill_audit_20260812_istest a
  JOIN public.customers cu ON cu.id = a.id
  WHERE cu.created_at >= '2026-07-13T00:00:00+09:00';
  IF v_boundary_touch <> 0 THEN
    RAISE EXCEPTION '[ABORT] 경계(7/13+) 고객이 audit 에 % 건 포함됨', v_boundary_touch;
  END IF;

  RAISE NOTICE '[POST-VERIFY] OK — flipped=215, 잔여false=0, 경계접촉=0';
END $$;

COMMIT;

-- 참고: v_daily_revenue(LIVE)는 이미 is_test 필터 → 백필 즉시 매출 유니버스에서 215명 제외 반영.
--       v_daily_visits / v_daily_visit_rate 는 STEP2 뷰개정 배포 후 반영.
