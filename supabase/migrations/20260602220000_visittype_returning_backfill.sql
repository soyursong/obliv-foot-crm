-- T-20260602-foot-VISITTYPE-RETURNING-AUTOSET (P1, GO_WARN) — 방문이력 고객 visit_type 일괄 정정
--
-- ⛔ supervisor SQL 게이트 (GO_WARN) — 프로덕션 적용 전 필수 절차 ⛔
--   1) scripts/visittype_returning_backfill_dryrun.sql 실행(READ-ONLY):
--      (a) 영향 건수 count
--      (b) 변경 대상 customer_id 목록 캡처(롤백 추적용 — 결과를 별도 보존)
--   2) supervisor SQL 리뷰 통과
--   3) 본 마이그레이션 실행(dev-foot 직접 실행 정책)
--
-- 배경: customers.visit_type DEFAULT 'new'(initial_schema.sql L.30) → 등록 시 '초진' 고착.
--   체크인 완료(check_ins.status='done') 시 'returning' 승격 로직이 코드 전체에 부재
--   → 방문이력(done 1건+)이 쌓여도 영구히 '초진' 배지 노출(김민경 F-0177 11회 = 오노출).
-- 본 마이그레이션: 이미 잘못 라벨된 기존 고객을 일괄 정정(트랙1).
--   앞으로의 신규 완료건은 코드(트랙2: lib/visitType.ts promoteVisitTypeToReturning)가 자동 승격.
--
-- 안전성:
--   - 멱등: .visit_type='new' 조건 → 이미 'returning'이면 미변경, visit_type 외 필드 비손상(AC-4).
--   - EXISTS 가드: done 체크인 0건인 진짜 초진은 손대지 않음(AC-2, 오버킬 방지).
--   - 복원적: 변경 대상은 'new'→'returning' 단방향. 역전환은 dry-run으로 캡처한 id 목록으로 가능.
--
-- 롤백: 20260602220000_visittype_returning_backfill.rollback.sql
-- ticket: T-20260602-foot-VISITTYPE-RETURNING-AUTOSET
-- author: dev-foot / 2026-06-02

BEGIN;

-- 적용: 방문이력(done 1건+) 있으나 visit_type='new'(오라벨) 고객 → 'returning'
UPDATE public.customers c
SET visit_type = 'returning'
WHERE c.visit_type = 'new'
  AND EXISTS (
    SELECT 1 FROM public.check_ins ci
    WHERE ci.customer_id = c.id
      AND ci.status = 'done'
  );

-- 검증: 적용 후 잔여 오라벨(done 있으나 여전히 new) 0건 확인
DO $$
DECLARE
  leftover integer;
BEGIN
  SELECT count(*) INTO leftover
  FROM public.customers c
  WHERE c.visit_type = 'new'
    AND EXISTS (
      SELECT 1 FROM public.check_ins ci
      WHERE ci.customer_id = c.id AND ci.status = 'done'
    );
  IF leftover <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: 잔여 오라벨 % 건 (done 있으나 visit_type=new)', leftover;
  END IF;
  RAISE NOTICE 'T-20260602-foot-VISITTYPE-RETURNING-AUTOSET: 백필 완료, 잔여 오라벨 0건.';
END;
$$;

COMMIT;
