-- ============================================================
-- T-20260702-foot-CODY-PKG-CREATE-PERM — 계정 영구 삭제 (DESTRUCTIVE)
-- 대상: d4c83d20-e8d6-4918-97ce-2cce68d444ae / kyh3858@hanmail.net / 김연희 / coordinator / jongno-foot
-- 근거: 김주연 총괄 현장 삭제 지시 2026-07-10 (MSG-20260710-191908-wgic)
-- 상태(진단): approved=false AND active=false, last_sign_in_at=NULL (미로그인 ghost row)
-- ⚠ archive-first 필수: rollback/..._archive_20260710.json + rollback/..._rollback_20260710.sql 보존 선행
-- ⚠ 게이트: data-architect CONSULT GO + supervisor DB-gate 승인 후에만 실행
-- DDL 무변경 · schema_migrations 원장 미기입 (순수 데이터 DELETE)
--
-- FK 요약 (deldiag 26 FK 중 target 참조 3건, 모두 ON DELETE CASCADE):
--   public.user_profiles.id      → auth.users.id  [CASCADE]
--   auth.identities.user_id      → auth.users.id  [CASCADE]
--   auth.one_time_tokens.user_id → auth.users.id  [CASCADE]
--   그 외 23개 FK 참조 테이블(reservations/payments/PHI 등) = 0행
-- 삭제 순서: app 테이블 명시 삭제 → auth.users (나머지 auth 자식 CASCADE)
-- ============================================================
BEGIN;

-- pre-guard: target 정확히 1행 (아니면 예외로 롤백)
DO $$
DECLARE up int; au int;
BEGIN
  SELECT count(*) INTO up FROM public.user_profiles WHERE id = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
  SELECT count(*) INTO au FROM auth.users          WHERE id = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae'
    AND lower(trim(email)) = 'kyh3858@hanmail.net';
  IF up <> 1 OR au <> 1 THEN
    RAISE EXCEPTION 'PRE-GUARD FAIL: user_profiles=% auth.users(id+email)=% (기대 1/1) → ABORT', up, au;
  END IF;
END $$;

-- 1) app 테이블 명시 삭제
DELETE FROM public.user_profiles WHERE id = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';

-- 2) auth.users 삭제 (auth.identities · auth.one_time_tokens CASCADE)
DELETE FROM auth.users WHERE id = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';

-- post-guard: target 0행 검증 (아니면 예외로 롤백)
DO $$
DECLARE up int; au int; idc int; ott int;
BEGIN
  SELECT count(*) INTO up  FROM public.user_profiles      WHERE id      = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
  SELECT count(*) INTO au  FROM auth.users                WHERE id      = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
  SELECT count(*) INTO idc FROM auth.identities           WHERE user_id = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
  SELECT count(*) INTO ott FROM auth.one_time_tokens      WHERE user_id = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
  IF up <> 0 OR au <> 0 OR idc <> 0 OR ott <> 0 THEN
    RAISE EXCEPTION 'POST-GUARD FAIL: up=% au=% id=% ott=% (기대 0) → ROLLBACK', up, au, idc, ott;
  END IF;
END $$;

COMMIT;
