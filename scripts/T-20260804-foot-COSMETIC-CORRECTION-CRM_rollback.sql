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

-- ── B) 제외(#1a/#1b/#2b/#4) 원복 — 메커니즘=DA CONSULT 확정 후 (신규 라인레벨 boolean unflag 예정) ──
-- (플레이스홀더: update check_in_services set <exclusion_flag> = false where id in (...);)

-- ── C) 누락 INSERT(#3) 원복 — supervisor 원장접점 판정 후 (line + 동반 payment 삭제/void 예정) ──
-- (플레이스홀더: delete from check_in_services where id = '<신규 INSERT id>';  -- 멱등 태그로 식별)
