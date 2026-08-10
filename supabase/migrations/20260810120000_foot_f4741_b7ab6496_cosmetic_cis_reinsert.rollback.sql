-- T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI — rollback
--
-- 신규 reinsert 된 화장품 3라인(고정 PK)만 DELETE. 순소실 0 (INSERT라 소실 원천 無).
-- business-key 보조 술어(check_in_id · seller · service_id) 동봉 = 오삭제 방어. 재실행 멱등(rows=0).

DELETE FROM public.check_in_services
WHERE id IN (
  'ab3c1841-3557-419c-9d0d-1acbfa961c1d',  -- 풋샴푸 (200ml) 42,000
  '47eb9b88-b595-46af-a183-c32c720b6845',  -- Care Toe Band (CTB) 15,000
  '515a6214-b038-4f45-8869-5dfd1db151da'   -- 리페어 핸드크림 (30ml) 16,000
)
  AND check_in_id     = 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf'
  AND seller_staff_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'
  AND service_id IN (
    '89095450-223f-4863-89a9-c7f32f62809d',
    'e17ba3a3-4842-4097-87bc-0778a64d2755',
    'cb6443a3-fe53-40e7-bd51-a4444d8a8966'
  );
