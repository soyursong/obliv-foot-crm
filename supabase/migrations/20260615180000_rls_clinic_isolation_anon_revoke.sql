-- T-20260615-foot-RLS-CLINIC-ISOLATION — Phase 2b (AC2 완료: anon 직접 SELECT 제거 + REVOKE)
-- 표준: cross_crm_data_contract.md §16-3 / §15 (v1.12).
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ 파괴적(DESTRUCTIVE) 마이그 — dev 단독 apply 절대 금지.
--   UN-HELD 2026-07-23 (T-20260703-foot-JONGNO-ANON-PHI-LEAK-RLS-LOCKDOWN full 2b).
--   러너 자동적용 없음(apply=전용 *_prod_apply.mjs 명시 실행). 잔여 게이트: ↓
--   (1) supervisor DDL-diff GO  (2) DB-GATE  (3) 최종 apply confirm(파괴적) → 그 후에만 prod.
-- ════════════════════════════════════════════════════════════════════════════
-- GATE 선결(둘 다 충족 확인 — 2026-07-23 PRE-DROP 재실측):
--   ① [MET] 라이브 키오스크 `foot-checkin`(foot-checkin.pages.dev) READ-path anon 직접 SELECT
--      → SECDEF RPC 컷오버 완료(자식 T-20260723-...-KIOSK-READPATH-ANON-CUTOVER=done,
--      supervisor POSTCHECK 4/4 PASS). foot-checkin origin/main=2127bdc: anon 직접 READ SELECT=0
--      (잔존 .from() = check_ins INSERT / reservations UPDATE = write-path 2c 범위, SELECT 아님).
--   ② [MET] obliv-foot-crm src/pages/SelfCheckIn.tsx(native): anon SELECT=0 (전량 RPC 전환).
--   실증 근거: anon SELECT 정책 제거 시 anon INSERT...RETURNING 이 42501 → write 경로도 RPC 화 필수.
--     Phase 2a RPC 6·7(upsert_customer/create_check_in)이 그 대체(prod 존재·컷오버 완료).
--   §16-3 "무삭제 금지 / 선대체 후 제거" — '제거' 가 본 파일(2a '선대체' 후).
--   §16-7 INVARIANT: 본 파일 적용 후 셀프체크인 동선 회귀 0 (키오스크 실기기+admin+native) prod 검증 필수.
-- PRE-DROP DB 스냅샷(anon key, count-only, PHI 미덤프, 2026-07-23):
--   anon customers=401(旣차단) / check_ins=200 count=370(LEAK LIVE) /
--   reservations=200 count=22(Track1 today+confirmed scope) / payments=401(旣차단).
--   → 본 마이그가 닫는 실 잔존 = check_ins(370)+reservations(22). customers/payments 는
--     旣차단이라 DROP POLICY IF EXISTS + REVOKE(멱등) = no-op·무해.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- anon 직접 SELECT 정책 제거 (Phase 2a RPC 로 대체 완료 전제).
DROP POLICY IF EXISTS anon_select_customer_self_checkin ON customers;   -- USING(clinic_id IS NOT NULL)
DROP POLICY IF EXISTS anon_checkin_read                 ON check_ins;   -- USING(true)
DROP POLICY IF EXISTS anon_reservation_read             ON reservations;-- USING(true)

-- §15 백스톱: anon SELECT 권한만 회수. anon INSERT 정책/권한은 본 2b 에서 **보존**.
--   ── architect CONSULT-REPLY(DA-...-foot, Q4) 의무: anon INSERT→write RPC(2a #6 upsert_customer
--      / #7 create_check_in) 전환 + FE write 전환 확정 후에만 REVOKE = **별도 게이트 2c**로 분리.
--      INSERT 직접 잔존은 create_check_in RPC 의 status 화이트리스트·clinic 스코프 우회 구멍이라
--      반드시 제거 대상이나, read/write FE 전환 시점이 달라 2b(SELECT)와 2c(INSERT)를 분리한다.
--      2c 게이트 = foot-checkin 키오스크 + native SelfCheckIn.tsx 의 write 경로 RPC 전환 완료.
--      (body 횡전개도 동일: body anon_customer_create INSERT 정책에 2c 그대로 상속.)
REVOKE SELECT ON customers    FROM anon;
REVOKE SELECT ON check_ins    FROM anon;
REVOKE SELECT ON reservations FROM anon;
-- payments: anon 경로 의존 0(read/write 모두) → 전체 REVOKE 가능(§15-1 백스톱)
REVOKE ALL ON payments FROM anon;

COMMIT;
