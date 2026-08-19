# T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE — DB-GATE / MIG-GATE evidence (dev-foot 구현 leg)

**leg**: Phase2 forward-fix 구현. mig 저작·dry-run·deploy-ready 마킹까지(write0/DDL0).
**★물리 apply = supervisor DB-GATE GO-token 선행** (apply_before_go 금지). 본 leg 은 prod DDL/RPC 0.
**날짜**: 2026-08-19 · author: dev-foot
**DA doctrine SSOT**: da_decision_foot_pkgsession_forwardsource_wiring_doctrine_20260819
  (Q1 GO/bless · Q2 (A) single server-side choke = CANONICAL · Q3 CONFIRM forward-fix ⊥ 316 backfill 직교)
**planner NEW-TASK**: MSG-20260819-155415-ahn3 (구현 leg 수용기준 1~4)

---

## 변경 요약 (single server-side choke + CIS-marking sub-routine 공유)

| # | object | 종류 | 내용 |
|---|--------|------|------|
| ① | `fn_mark_cis_for_consumed_session(uuid,uuid,text,jsonb)` | **신규** | CIS(flag∧FK) co-set 단일 writer(AC-SW). widened §128-150 matched-derivation 동형 추출. SECURITY DEFINER · PUBLIC REVOKE · authenticated GRANT. |
| ② | `consume_one_session(uuid,text,uuid,date,uuid,timestamptz,timestamptz,int,text,jsonb)` | **신규** | canonical consumption primitive. (i)package_sessions used INSERT(원자 MAX+1) (ii)헬퍼 CIS co-set. rich 필드 superset. SECURITY DEFINER · PUBLIC REVOKE · authenticated GRANT. |
| ③ | `consume_package_sessions_for_checkin(...5-arg)` | **body-drift(C19)** | 인라인 CIS 블록(§128-150) → 헬퍼 호출로 치환. 시그니처·소비루프·멱등·shortfall 가드 불변. |
| ④ | `deduct_session_atomic(uuid,uuid)` | **body-drift(C19)** | 인라인 package_sessions INSERT → consume_one_session 위임(single-writer). 잠금·중복가드·잔여체크·session_type fuzzy·반환 shape 불변. |

FE 라우팅(단일 writer): 6개 client 直insert(CustomerChartPage saveUseSession/saveC22Deduct/handleDupAddSession/
handleHealerDeduct · CheckInDetailSheet SessionUseInSheetDialog · Packages) → `consumeOneSession()`(src/lib/consumeSession.ts).
autoDeductSession(session.ts→deduct_session_atomic)은 ④ body-drift 로 자동 라우팅(FE 무변).

---

## supervisor MIG-GATE 검증 포인트

- **C19 계약자산 RPC body-drift**: ③ consume_package_sessions_for_checkin · ④ deduct_session_atomic 2종.
  body-drift 전 원형 = supabase/migrations/20260723190000_..._widened.sql(consume) / 20260420000013_race_condition_fixes.sql(deduct).
  rollback.sql 이 두 원형을 정확 복원(재대조 가능).
- **§15-5-10 caller-tier seal**: 신규 함수 2종 = SECURITY DEFINER + `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.
  anon 도달 차단(widened §167-173 파리티). consume/deduct 는 기존 seal 유지(GRANT 재확인).
- **A12 md5 re-seal**: 신규/변경 함수 4종 body 확정 → supervisor A12 재봉인 대상.
- **P-floor 불변식 §686-690**: flag∧FK co-set 강제. 헬퍼는 두 컬럼 동시 SET 또는 no-op. p_service_sessions=NULL →
  마킹 skip(회차만 소진) = orphan(flag=true∩FK-null) 신규 fabricate HARD 금지 준수. matched-derivation determinism
  (ORDER created_at ASC,id ASC LIMIT1)·idempotent(WHERE package_session_id IS NULL)·double-link-0(LIMIT1).
- **forward-only**: retro mutation 0. 316 backfill(과거정정)=별건 직교 무접촉.

---

## dry-run (무영속, INV-1~5)

- runner: `scripts/T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE_dryrun.mjs` (dryrun_lib.mjs 3요소).
- 결과: **PASS**. txn-control stripped=(none) · plpgsql exception-handler 서브트랜잭션 강제 롤백 ·
  post-probe absent: `proc public.consume_one_session` → absent=true / `proc public.fn_mark_cis_for_consumed_session` → absent=true.
- 무영속 실증: 신규 함수 2종 dry-run 후 prod 부재 = DDL 영속 0. body-drift 2종은 CREATE OR REPLACE 롤백으로 원형 복원.

## mig_ledger_check (3자 대조 · pre-apply 정합)

```
version 20260819170000 : schema_migrations=absent · file=present · prod(new fns)=absent
body-drift 대상 prod 실재 : consume_package_sessions_for_checkin=present · deduct_session_atomic=present
```
= "미적용" 정합 상태(drift 0). CREATE OR REPLACE 는 기존 함수 교체(신규 생성 아님) 전제 충족.

## build
- `npm run build` exit 0 (✓ built in ~6s). FE 라우팅(consumeSession + 6 site) 컴파일 통과. 순환 import 0.

---

## apply 게이트 (dev-foot 준수)

- **write0/DDL0**: 본 leg prod DDL/RPC apply 0. dry-run(롤백)·introspection·build 만 수행.
- **GO-token 선행**: 물리 apply(step 5) = supervisor MIG-GATE + 물리 GO-token(db_apply_guard.sh lane) 후.
  apply 러너는 dryrun_lib applyPreflight(blob==approved-commit) 경유.
- **POST-VERIFY(step 6)**: apply 후 신규 소비경로가 CIS(flag∧FK) co-set 마킹하는지 실측(재진 no-payment 포함).
  FE 라우팅 behavioral 검증은 RPC prod 착지 후에만 가능 → POST-VERIFY 로 이관.
- **매출-인접(planner 소관)**: ⑨ alreadyPaid + Closing 제외 going-forward semantics → fix 착지 時 dev-sales
  awareness + FM3 통지(316 동형·retro 아님·planner 경유). 현시점 미발행.
