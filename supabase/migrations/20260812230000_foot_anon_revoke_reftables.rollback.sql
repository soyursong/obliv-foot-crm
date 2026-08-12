-- ============================================================================
-- T-20260812-foot-ANON-REVOKE-REFTABLES · ROLLBACK (재-GRANT anon relacl parity)
--   UP(20260812230000_foot_anon_revoke_reftables.sql) 의 REVOKE ALL(5표) 을 역전한다.
--
--   before-image relacl (anon, 5 target 공통·2026-08-12 실측): {SELECT, REFERENCES, TRIGGER, MAINTAIN}
--   → 롤백 = 그 4 권한 재부여(relacl parity 원복). anon 은 여전히 RLS-deny(INERT) 로 0-row.
--     (REFERENCES/TRIGGER/MAINTAIN 은 anon 이 실사용 불가한 vestigial 이나, before-image 정확
--      복원을 위해 그대로 재부여 — supervisor DDL-diff parity 대조 용이.)
--   ⚠ 이 롤백은 defense-in-depth REVOKE 를 되돌려 INERT(grant 존치·RLS deny) 상태로 복귀.
--     실제 PHI 노출 없음(RLS deny)·예방 정비 이전 상태로 복귀함을 명시.
--   멱등: GRANT 재실행=no-op(이미 보유 시). 데이터 mutation 0.
-- 작성: dev-foot / 2026-08-12
-- ============================================================================

BEGIN;

GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON public.call_type_codes    TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON public.check_in_services  TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON public.clinic_holidays    TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON public.clinic_schedules   TO anon;
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON public.prescription_codes TO anon;

COMMIT;
