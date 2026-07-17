-- ROLLBACK: T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN — bill_receipt_new seed 제거
-- 신양식 row 1건만 삭제(기존 bill_receipt sort35 등 무접촉). 발행이력(form_submissions) 존재 시
--   FK 로 삭제 차단될 수 있음 — 그 경우 active=false 로 비활성 후 잔존이 안전(법정 발행이력 보존).
DELETE FROM public.form_templates
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND form_key = 'bill_receipt_new'
  AND category = 'foot-service';
