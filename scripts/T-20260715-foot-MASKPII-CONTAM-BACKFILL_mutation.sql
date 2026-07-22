-- T-20260715-foot-MASKPII-CONTAM-BACKFILL — data-correction 백필 (forward / DDL 0 데이터 정정)
-- 권위: DA CONDITIONAL GO MSG-20260723-055448-9j4x
--   · 트랙 A(7행) + 트랙 B(67ea1793, E.164 exact match FAIL → relink 보류) = 전 8행 sentinel disposition
--   · sentinel = '[재수집필요]' — 요건 ⓐ '*' 미포함(트리거 비트립) ⓑ machine-detectable(대괄호 토큰, 정당이름과 구분) ⓒ worklist 조회가능(name LIKE '[재수집필요]%')
--   · un-mask 소스 CRM 내부 부재(customers·check_ins 양측 마스킹 전파) → 원값 복원 구조적 불가 → sentinel terminal
--   · phone 온전 유지(미접촉), live check_ins 유지(실방문 텔레메트리 보존), reservations 0·ledger(closing_manual_payments) 0 = 원장 무접점
-- 안전(SOP §3 + 티켓 §게이트 6/8 + DA 실행 5게이트):
--   · 명시 PK 8개 freeze(단일 count 아님, 지문 교집합) + 멱등 WHERE(name LIKE '%*%') → 재실행 no-op
--   · pre-image 백업(네임스페이스 스키마 maskpii_bk_20260715, tracked schema 무접점, 보존 후 drop) → rollback 근거
--   · 양축 동시정정(customers.name + check_ins.customer_name) — NEW 최종값 sentinel = 트리거 비트립 보장
--   · check_ins 축 = 부작용 트리거(dopamine callback/resv sync/waiting board) 억제(session_replication_role=replica LOCAL) — 이름 스냅샷 정정은 업무 이벤트 아님
--   · customers 축 = 트리거 ACTIVE 유지(sentinel이 reject 트리거 통과함을 실증)
-- ⚠ 실행 = supervisor DB-GATE 하에서만(파괴적 PHI, CEO override로도 waive 아님). freeze 직전 재검증 ABORT + has_trigger 실행시점 재확인 선행.

BEGIN;

-- ── 0) pre-image 백업 (rollback 근거, 네임스페이스 스키마) ──
CREATE SCHEMA IF NOT EXISTS maskpii_bk_20260715;

CREATE TABLE IF NOT EXISTS maskpii_bk_20260715.customers_preimage AS
SELECT id, name AS old_name, updated_at AS old_updated_at, now() AS snapshot_at
FROM public.customers
WHERE id IN (
  '2dc21d1c-6e9f-4643-a733-dca92252d830','44a6a076-ca66-458a-bdc5-e0a3a12c2e67',
  '512998d0-d51a-42c4-947e-b0cb2cc69da4','67ea1793-05e5-4d4a-b5c1-1ec73486e317',
  '9f2bfc0f-66a3-43c0-9e02-7055b37a4cc5','b1b5f6f7-a3c3-4c94-b9de-c744a8695e41',
  'bd307dfe-79f0-4fea-86a6-0957cea492cd','e3216e83-3037-4921-9e26-76cd14b92b1e'
) AND created_by IS NULL AND name LIKE '%*%';

CREATE TABLE IF NOT EXISTS maskpii_bk_20260715.check_ins_preimage AS
SELECT id, customer_id, customer_name AS old_customer_name, now() AS snapshot_at
FROM public.check_ins
WHERE customer_id IN (
  '2dc21d1c-6e9f-4643-a733-dca92252d830','44a6a076-ca66-458a-bdc5-e0a3a12c2e67',
  '512998d0-d51a-42c4-947e-b0cb2cc69da4','67ea1793-05e5-4d4a-b5c1-1ec73486e317',
  '9f2bfc0f-66a3-43c0-9e02-7055b37a4cc5','b1b5f6f7-a3c3-4c94-b9de-c744a8695e41',
  'bd307dfe-79f0-4fea-86a6-0957cea492cd','e3216e83-3037-4921-9e26-76cd14b92b1e'
) AND customer_name LIKE '%*%';

-- ── 1) Axis 1: customers.name → sentinel (reject 트리거 ACTIVE = sentinel 검증) ──
UPDATE public.customers
SET name = '[재수집필요]', updated_at = now()
WHERE id IN (
  '2dc21d1c-6e9f-4643-a733-dca92252d830','44a6a076-ca66-458a-bdc5-e0a3a12c2e67',
  '512998d0-d51a-42c4-947e-b0cb2cc69da4','67ea1793-05e5-4d4a-b5c1-1ec73486e317',
  '9f2bfc0f-66a3-43c0-9e02-7055b37a4cc5','b1b5f6f7-a3c3-4c94-b9de-c744a8695e41',
  'bd307dfe-79f0-4fea-86a6-0957cea492cd','e3216e83-3037-4921-9e26-76cd14b92b1e'
) AND created_by IS NULL AND name LIKE '%*%';   -- 멱등(§3-3)

-- ── 2) Axis 2: check_ins/reservations.customer_name 스냅샷 → sentinel ──
-- ★ 자동 cascade: customers 의 trg_sync_customer_name(AFTER UPDATE OF name)→fn_sync_customer_name 이
--   NEW.name 을 check_ins.customer_name + reservations.customer_name 에 자동 전파(dual-axis 동시정정 자동 충족).
--   ∴ 위 (1) customers UPDATE 만으로 check_ins 11행 + reservations 0행 동기 완료.
-- 아래 UPDATE = 멱등 잔여 스윕(방어): sync 트리거가 이미 처리 → 정상 결과 0행. 트리거 비활성 상황 대비 belt-and-suspenders.
-- check_ins UPDATE 발화 트리거 안전성(실측): dopamine callback/resv sync/reservation_status=INSERT-ONLY 미발화;
--   UPDATE 발화분(set_completed_at·cancel_restore=상태전이 조건 no-op / name_nfc=NFC정규화 / sync_waiting_board=mask_display_name 재투영·예외격리) 전부 이름 스냅샷 정정에 무해.
UPDATE public.check_ins
SET customer_name = '[재수집필요]'
WHERE customer_id IN (
  '2dc21d1c-6e9f-4643-a733-dca92252d830','44a6a076-ca66-458a-bdc5-e0a3a12c2e67',
  '512998d0-d51a-42c4-947e-b0cb2cc69da4','67ea1793-05e5-4d4a-b5c1-1ec73486e317',
  '9f2bfc0f-66a3-43c0-9e02-7055b37a4cc5','b1b5f6f7-a3c3-4c94-b9de-c744a8695e41',
  'bd307dfe-79f0-4fea-86a6-0957cea492cd','e3216e83-3037-4921-9e26-76cd14b92b1e'
) AND customer_name LIKE '%*%';   -- 멱등 (sync 트리거 처리 후 기대 0행)

-- 기대: customers 8행 / check_ins 11행 (dry-run 실측). abort 임계 초과 시 supervisor 중단.
COMMIT;
