-- T-20260627-foot-ANON-RLS-PHASE2B — payments-portion 단독 선차단 (안전 조기 컷)
-- ════════════════════════════════════════════════════════════════════════════
-- ⛔ 적용 보류(.PHASE2B_HOLD) — 마이그 러너 SKIP. supervisor DDL-diff 게이트 후에만 prod 적용.
-- ════════════════════════════════════════════════════════════════════════════
-- 근거: 본 P0 티켓의 anon read 차단(2b)은 customers/check_ins/reservations 에 대해
--   FE 컷오버(Gate A architect CONSULT → Gate B native → Gate C cross-repo kiosk) 완료
--   전까지 적용 불가(라이브 회귀). 그러나 **payments 만은 anon FE 의존이 0** 이다:
--     · 전 코드베이스 grep: anonClient → payments 직접 접근 경로 0건.
--     · payments 는 이미 RLS canonical 로 anon row 0건(티켓 risk_reason "payments만 보호됨").
--   → payments REVOKE 는 FE 컷오버와 **독립**이며, 금융·PHI 표면을 즉시 축소하는
--      defense-in-depth 백스톱(20260616010000 하드닝과 동일 패턴: RLS 1차 + anon REVOKE 2차).
--
-- 회귀 위험 0 입증:
--   - payments anon SELECT/INSERT/UPDATE 의존 FE 0건(grep) → 화면 깨짐 0.
--   - RLS 는 본 마이그가 만지지 않음(권한 회수만). authenticated 경로 무영향.
--
-- 주의: 본 파일은 번들 2b(20260615180000_*.PHASE2B_HOLD) 의 `REVOKE ALL ON payments`
--   라인과 **중복 의도**다. 번들 2b 가 먼저 적용되면 본 파일은 불요(no-op, REVOKE 멱등).
--   조기 컷을 위해 번들과 분리한 독립 단위 — 둘 중 하나만 적용되면 충분.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- payments: anon 경로 의존 0 → 전체 REVOKE (RLS 1차 + REVOKE 2차 백스톱).
REVOKE ALL ON public.payments FROM anon;

COMMIT;
