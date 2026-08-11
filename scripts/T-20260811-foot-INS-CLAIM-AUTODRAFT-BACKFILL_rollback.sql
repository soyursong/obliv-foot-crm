-- T-20260811-foot-INS-CLAIM-AUTODRAFT-BACKFILL — FALLBACK ROLLBACK (archive-first, 선택 삭제)
-- ============================================================
-- ★언제: apply 후 판정근거 스냅샷 이상(over-generate / freeze 이탈 / 금액 불일치 등) 확인 시에만.
--   정상 백필은 롤백 불요(draft = 검수 대상, 파괴 아님).
--
-- 안전 규율(Data-Correction Backfill SOP + Orphan Archive-First):
--   • archive-first: 삭제 전 대상 행을 아카이브 테이블로 전량 복사(CREATE TABLE AS SELECT = 컬럼 완전성 by construction, §2-S-3).
--   • 선택 삭제만: 이 백필이 생성한 draft 만(calculation_engine_version='autodraft_from_charges_v1'
--     + clinic=jongno-foot + claim_status='draft' + created_at ∈ apply 윈도우). 수동/제출/타 상태 청구 무접촉.
--   • 원장 무접촉: service_charges/payments/edi_submissions 절대 미접촉.
--   • ★forward-트리거 draft 오삭제 방지: engine_version 단독 금지 — created_at 윈도우(apply 시각) 필수.
--     apply 윈도우 밖(라이브 트리거 생성분)은 보존.
--
-- 실행 전 필수: 아래 :apply_start / :apply_end 를 apply 실제 실행 시각으로 치환(±여유 최소화).
--   Management API 는 psql :var 미지원 → 값 직접 기입 후 실행.
-- ============================================================
BEGIN;

-- 0) clinic 앵커
DO $$
DECLARE v_clinic uuid;
BEGIN
  SELECT id INTO v_clinic FROM public.clinics WHERE slug = 'jongno-foot' ORDER BY id LIMIT 1;
  IF v_clinic IS NULL OR v_clinic <> '74967aea-a60b-4da3-a0e7-9c997a930bc8' THEN
    RAISE EXCEPTION 'CLINIC-ANCHOR-FAIL: %', v_clinic;
  END IF;
END $$;

-- 1) 삭제 대상 claim 식별(재사용 임시 셋) — apply 윈도우 필수
CREATE TEMP TABLE _rb_claims ON COMMIT DROP AS
SELECT ic.id AS claim_id
FROM public.insurance_claims ic
JOIN public.clinics c ON c.id = ic.clinic_id AND c.slug = 'jongno-foot'
WHERE ic.claim_status = 'draft'
  AND ic.calculation_engine_version = 'autodraft_from_charges_v1'
  AND ic.created_at >= TIMESTAMPTZ '2026-08-11 00:00:00+09'   -- ★ apply_start 로 치환
  AND ic.created_at <  TIMESTAMPTZ '2026-08-12 00:00:00+09';  -- ★ apply_end 로 치환

-- 대상 건수 확인(0 이면 아래 전부 no-op)
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _rb_claims;
  RAISE NOTICE 'ROLLBACK 대상 claim = % 건 (윈도우/engine_version/clinic 필터)', n;
END $$;

-- 2) archive-first — 전량 복사(컬럼 완전성 = SELECT * 로 by construction)
CREATE TABLE IF NOT EXISTS public.archive_ins_claim_backfill_20260811 AS
  SELECT ic.*, now() AS archived_at
  FROM public.insurance_claims ic
  WHERE ic.id IN (SELECT claim_id FROM _rb_claims);

CREATE TABLE IF NOT EXISTS public.archive_claim_items_backfill_20260811 AS
  SELECT cit.*, now() AS archived_at
  FROM public.claim_items cit
  WHERE cit.claim_id IN (SELECT claim_id FROM _rb_claims);

-- 3) 순소실 0 검증: archive 행수 == 삭제 대상 행수
DO $$
DECLARE v_claims int; v_arch int; v_items int; v_arch_items int;
BEGIN
  SELECT count(*) INTO v_claims FROM _rb_claims;
  SELECT count(*) INTO v_arch   FROM public.archive_ins_claim_backfill_20260811;
  SELECT count(*) INTO v_items  FROM public.claim_items WHERE claim_id IN (SELECT claim_id FROM _rb_claims);
  SELECT count(*) INTO v_arch_items FROM public.archive_claim_items_backfill_20260811;
  IF v_arch < v_claims OR v_arch_items < v_items THEN
    RAISE EXCEPTION 'ARCHIVE-INCOMPLETE: claims arch=%/%  items arch=%/% → ABORT(순소실 방지)', v_arch, v_claims, v_arch_items, v_items;
  END IF;
END $$;

-- 4) 삭제(자식 먼저) — 원장 무접촉
DELETE FROM public.claim_items       WHERE claim_id IN (SELECT claim_id FROM _rb_claims);
DELETE FROM public.insurance_claims  WHERE id       IN (SELECT claim_id FROM _rb_claims);

-- 5) 확인 후 COMMIT. (검토 중이면 ROLLBACK 로 바꿔 dry-run 가능.)
COMMIT;
