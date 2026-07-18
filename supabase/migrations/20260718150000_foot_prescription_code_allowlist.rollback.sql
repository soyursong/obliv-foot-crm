-- ROLLBACK — T-20260615-foot-RX-WHITELIST-FOLDERTREE (Phase 1 overlay 테이블)
-- 20260718150000_foot_prescription_code_allowlist.sql 역연산.
--
-- ⚠⚠ 임상 안전 — 롤백 순서 강제:
--   ① FE enforcement feature-flag OFF (VITE_RX_ALLOWLIST_ENFORCEMENT 미설정/off) = fail-OPEN
--      → 약품폴더트리 전량 노출(현행 동작) 복귀. **먼저** 수행.
--   ② 그 다음 본 DROP TABLE (캐노니컬 무손실 — prescription_codes/folders 원본 무접촉).
--
--   fail-CLOSED 롤백(테이블만 남기고 enforcement ON, 또는 빈 테이블+enforcement ON) 절대 금지
--   = 전 처방 차단 = 임상 위해. 롤백은 반드시 fail-OPEN.
--
-- 무손실: 본 테이블은 overlay(정책 메타)일 뿐 — prescription_codes(카탈로그)·prescription_code_folders(폴더매핑)
--   원본 데이터 무접촉. DROP 해도 처방 카탈로그/폴더/기존 처방기록 손실 0.
-- 멱등: DROP ... IF EXISTS.

BEGIN;

DROP TABLE IF EXISTS public.prescription_code_allowlist;

COMMIT;

-- 검증: SELECT to_regclass('public.prescription_code_allowlist');  -- → NULL (제거됨)
