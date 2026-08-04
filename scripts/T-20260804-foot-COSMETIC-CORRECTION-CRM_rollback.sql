-- T-20260804-foot-COSMETIC-CORRECTION-CRM — ROLLBACK SQL
-- 실 apply 후 원복용. per-row PK freeze. apply 순서의 역순.
-- ★ 재귀속(#2a,#5)만 apply-ready. 제외(#1/#2b/#4)·INSERT(#3)는 메커니즘 확정(DA CONSULT/supervisor) 후 롤백문 추가.

-- ── A) 재귀속 원복 (#2a 김현수: seller → NULL 복원 / #5 김영웅: seller → 최민지 복원) ──
-- #2a  line 76199926 : 3a0c6774(김규리) → NULL (dry-run baseline: seller_staff_id = NULL)
update check_in_services set seller_staff_id = NULL
  where id = '76199926-9be6-44a5-a5dd-fa77bc6c2e33' and seller_staff_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b';
-- #5  line 3a8ed9f3 : 3a0c6774(김규리) → 03642b85(최민지) (dry-run baseline: seller_staff_id = 03642b85)
update check_in_services set seller_staff_id = '03642b85-4b30-48e4-b762-c2d04e6af7f3'
  where id = '3a8ed9f3-f55f-4afd-a110-72c24eeab5e3' and seller_staff_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b';

-- ── B) 제외(#1a/#1b/#2b/#4) soft-void 원복 — DA-20260805-COSMETIC-VOID-SEMANTIC 확정(voided_at 프리미티브) ──
-- 4-PK soft-void 를 원복(voided_at/voided_by/voided_reason → NULL). 정확히 이 4 PK(blanket 금지).
update check_in_services
  set voided_at = NULL, voided_by = NULL, voided_reason = NULL
  where id in (
    'b81521e2-3e4f-4d41-8c63-971d78f08482',  -- #1a 김민경 안티펑거스500ml 287,000
    'aaec854c-31e2-4071-b2d8-535cfed6c55d',  -- #1b 김민경 풋샴푸200ml 42,000
    '81682cf7-317a-4e55-98c5-eeafdda0d605',  -- #2b 오렌지족 풋샴푸200ml 42,000
    '31ea7f5e-fad9-406f-9d50-5bf116b51d23'   -- #4  정가언 CTB 15,000
  )
  and voided_by = 'T-20260804-foot-COSMETIC-CORRECTION-CRM';  -- 본 티켓 마킹분만 원복(타 void 보존)

-- ── C) 누락 INSERT(#3) 원복 — supervisor 원장접점 판정 후 (line + 동반 payment 삭제/void 예정) ──
-- (플레이스홀더: delete from check_in_services where id = '<신규 INSERT id>';  -- 멱등 태그로 식별)
