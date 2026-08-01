# T-20260725-foot-DESIGNPT-THERAPIST-ROLE-WRITEBLOCK — prod apply + 침투테스트 evidence

- **supervisor GO**: MSG-20260802-074725-cbc5 (DB-GATE SQL-review PASS + DEV dry-run PASS + §8 2.8 DA HOLD clear + prod apply 승인)
- **prod ref**: rxlomoozakkjesdqjtvd (obliv-foot-crm)
- **실행 시각**: 2026-08-02 08:15 KST
- **runner**: `scripts/T-20260725-foot-DESIGNPT-THERAPIST-ROLE-WRITEBLOCK_apply.mjs --apply`
- **migration**: `supabase/migrations/20260802120000_customers_designated_therapist_writeguard.sql`

## apply前 prod introspection (read-only)
- `current_user_role()` present = 1 ✅
- `customers.designated_therapist_id` = uuid (FK→staff.id) ✅
- trigger `trg_designated_therapist_writeguard` **pre = 1** → 이미 prod live 상태였음(선 out-of-band apply). live def = 마이그 파일과 **완전 일치**(BEFORE UPDATE OF designated_therapist_id / allowed {admin,manager,consultant,coordinator} / IS DISTINCT 가드 / 42501). 단, `schema_migrations` 원장 미기록(drift).

## apply (idempotent 재확인 + 원장 drift 수렴)
- 마이그 재적용(CREATE OR REPLACE FN + DROP TRIGGER IF EXISTS + CREATE, BEGIN..COMMIT 원자) → 현재 파일 == prod live 재확정.
- function `fn_designated_therapist_writeguard()` present = 1 ✅
- trigger `trg_designated_therapist_writeguard` live = 1 ✅
- triggerdef: `CREATE TRIGGER trg_designated_therapist_writeguard BEFORE UPDATE OF designated_therapist_id ON public.customers FOR EACH ROW EXECUTE FUNCTION fn_designated_therapist_writeguard()`
- **ledger recorded = true** (version 20260802120000) → 원장 drift 수렴(forward-doc, foot manual-apply 관례).

## 침투테스트 ①~⑤ (전부 무영속 — 각 DO 블록 끝 RAISE EXCEPTION 으로 자기 트랜잭션 abort)
역할 시뮬레이션 = `set_config('request.jwt.claims', {sub:<role별 실존 활성 user_profile id>})` → `current_user_role()` 실해석. designated 값 = 실존 staff.id(FK 충족, 대상 고객 현재값과 상이).

| # | 시나리오 | role | 결과 | 기대 | 판정 |
|---|---------|------|------|------|------|
| ① | designated UPDATE(값변경) | therapist | **DENY_42501** (요청 role=therapist) | DENY 42501 | ✅ |
| ② | designated UPDATE | admin | OK rows=1 | OK | ✅ |
| ② | designated UPDATE | manager | OK rows=1 | OK | ✅ |
| ② | designated UPDATE | consultant | OK rows=1 | OK | ✅ |
| ② | designated UPDATE | coordinator | OK rows=1 | OK | ✅ |
| ③ | phone UPDATE(designated 미포함) | therapist | OK rows=1 (트리거 미발화) | OK | ✅ |
| ④ | designated UPDATE(동일값) | therapist | OK rows=1 (no-op, IS DISTINCT=false) | OK | ✅ |
| ⑤ | designated UPDATE | service_role(auth.uid()=NULL) | OK rows=1 (무저촉) | OK | ✅ |

**결과: ①~⑤ ALL PASS ✅**

## 무영속 검증 (침투테스트 후)
- 대상 customer `designated_therapist_id` 불변 = true ✅ (침투테스트 무영속)
- trigger `trg_designated_therapist_writeguard` 여전히 live = 1 ✅

## 종결
- prod pg_trigger 에 `trg_designated_therapist_writeguard` **live 확정** + 침투 evidence ①~⑤ PASS.
- 코드결함 아님 — DB-GATE apply(원장 drift 수렴 포함) 완료. deploy-ready 유지.
