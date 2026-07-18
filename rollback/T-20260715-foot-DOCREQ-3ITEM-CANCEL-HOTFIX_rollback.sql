-- T-20260715-foot-DOCREQ-3ITEM-CANCEL-HOTFIX — ROLLBACK
-- 소프트취소(voided) 원복: status voided→draft + field_data 에서 resolved_reason/resolved_at 제거.
-- 원복 대상 = 이번 hotfix 로 회수한 3건(정확 PK). 다른 행 무접촉.
-- before: status='draft', field_data 에 resolved_reason/resolved_at 없음.
-- after(hotfix): status='voided', field_data.resolved_reason='cancelled', field_data.resolved_at=<ISO>.

BEGIN;

UPDATE form_submissions
SET status = 'draft',
    field_data = (field_data - 'resolved_reason' - 'resolved_at')
WHERE id IN (
    '27b15c11-4b1c-4850-b323-371366bccd8a',  -- F-4574 총괄테스트중
    'b94b9b13-0752-44ac-bafb-a3a83bdacdf2',  -- F-4678 총*현
    '755ac489-a262-48a8-bad0-2f03142c992a'   -- F-4692 송지현2
  )
  AND status = 'voided'
  AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'   -- jongno-foot
  AND field_data->>'request_origin' = 'staff_consult'
  AND field_data->>'resolved_reason' = 'cancelled';        -- hotfix 로 취소한 건만 원복

-- 기대 영향행 = 3. 다르면 ROLLBACK.
COMMIT;
