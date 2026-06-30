-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT (forward-only 정합)
--
-- 우선경로(권장, 발행 후 안전): active-토글 복원 — 레거시 재활성 + 신규 2폼 비활성.
--   고아 print record 방지를 위해 신규 2행이 이미 발행이력을 가진 뒤에는 이 경로만 사용한다.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 레거시 단일행 재활성
UPDATE form_templates
   SET active = true
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND form_key = 'treat_confirm'
   AND service_id IS NULL;

-- 신규 2폼 비활성(행 보존 — DELETE 아님)
UPDATE form_templates
   SET active = false
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND form_key IN ('treat_confirm_code', 'treat_confirm_nocode');

COMMIT;

-- ── seed행 DELETE (조건부 — 발행이력 0건 검증 시에만 허용) ─────────────────────────────────
--  신규 2행에 연결된 form_submissions(발행/print log) count=0 일 때만 물리 삭제 허용.
--  발행 후에는 위 active-토글 롤백만 사용(고아 레코드 방지). 아래는 수동 검증 후에만 주석 해제.
--
-- DELETE FROM form_templates ft
--  WHERE ft.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
--    AND ft.form_key IN ('treat_confirm_code', 'treat_confirm_nocode')
--    AND NOT EXISTS (SELECT 1 FROM form_submissions s WHERE s.template_id = ft.id);
