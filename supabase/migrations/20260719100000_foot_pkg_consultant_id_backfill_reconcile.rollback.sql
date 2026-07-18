-- ROLLBACK — T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE 백필 RECONCILE (20260719100000)
-- 효과: reconcile 직전 상태(= 최초 heuristic 백필 결과, filled 119 / null 22) 복원.
-- 방식: 최초 heuristic 백필(20260718241000) 로직을 fill-from-NULL 로 재적용.
--   reconcile 로 NULL 이 된 heuristic-launder 행은 다시 heuristic 값으로,
--   det-fix 행(9155d158)은 IS NULL 이 아니므로 무접촉(det 값 유지) — 완전복원 아님(det 정정은 개선이라 존치).
--   ※ 완전한 pre-reconcile 복원이 필요하면 최초 백필 rollback→최초 백필 재실행 순으로.
-- data-only. DDL 무변경.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DO $rb$
DECLARE
  v_clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_filled int;
BEGIN
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = v_clinic AND ci.consultant_id IS NOT NULL AND st.to_status = 'consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id) p.id AS package_id, ta.consultant_id
    FROM packages p JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id = v_clinic
    ORDER BY p.id, (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC, ta.check_in_id
  )
  UPDATE packages p SET consultant_id = pa.consultant_id
    FROM pkg_attr pa
   WHERE p.id = pa.package_id AND p.clinic_id = v_clinic
     AND p.consultant_id IS NULL AND pa.consultant_id IS NOT NULL;

  SELECT COUNT(*) INTO v_filled FROM packages WHERE clinic_id = v_clinic AND consultant_id IS NOT NULL;
  RAISE NOTICE '[PKG-CONSULTANT-RECONCILE-ROLLBACK] heuristic 재적용 완료 · filled_post=%', v_filled;
END;
$rb$;

NOTIFY pgrst, 'reload schema';
COMMIT;
