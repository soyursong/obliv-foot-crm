# DB-GATE — T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE

**per-CRM 실행 leg** of xcrm 우산 `T-20260813-xcrm-DEFAULTACL-ANON-FORWARD-HARDEN`
**DA CONSULT**: GO(CONDITIONAL) — `MSG-20260813-010554-o1w6` → approved
**artifact-class**: `db_only` · **db_change**: `true` · **change-class**: RESTRICTIVE(exposure-reducing)·가역
**author**: dev-foot · 2026-08-13

---

## 1. introspect-first — prod pg_default_acl 실측 (정본 소스, DA 재-probe 안 함)

evidence: `db-gate/T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE_introspect_BEFORE.log`
probe: `scripts/T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE_introspect.mjs` (SELECT-only, 무영속)

### [1] TARGET — grantor=postgres · schema=public · TABLES(objtype='r') · grantee=anon
**PRESENT** — 잔존 default-grant 4종:

| grantor | schema | objtype | grantee | privilege |
|---|---|---|---|---|
| postgres | public | TABLE | anon | MAINTAIN |
| postgres | public | TABLE | anon | REFERENCES |
| postgres | public | TABLE | anon | SELECT |
| postgres | public | TABLE | anon | TRIGGER |

→ **분기 = present → REVOKE 경로.**

### [2] 경로(b) — grantor=supabase_admin · TABLES · grantee=anon = ADP FULL
public/graphql/graphql_public 3스키마에 anon FULL(DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE).
→ **DA Q3 §15-6-7 accepted-residual REAFFIRM → 무액션.** (42501 ceiling — postgres 롤로 supabase_admin default 회수 불가 · app 테이블 무발현 · support NOT-NOW). introspection 결과만 evidence.

### [ctx] 정당 anon consumer 부재 확인
- `ALTER DEFAULT PRIVILEGES` 는 **앞으로 생성될** 오브젝트에만 적용 — 기존 테이블 explicit grant 무영향.
- 현재 public base 테이블 201개 中 anon-SELECT 가능 178개 = **기존 explicit grant**(default-ACL 상속 아님) → REVOKE 후에도 불변.
- 라이브 anon 동선(self-checkin / health-q)은 명시적 grant + SECDEF RPC + RLS 로 동작 → "신규 테이블 default-grant 자동상속"에 의존하는 정당 consumer = **0**.
- storage 스키마 postgres→anon default = Supabase 관리영역 · 스코프 밖 · 무접촉.

---

## 2. 변경 SQL (supervisor DDL-diff 대상)

**up** — `supabase/migrations/20260813000000_foot_default_acl_anon_forward_revoke.sql`
```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
```
DDL 1문 · 데이터 mutation 0 · 멱등(미보유분 no-op).

**rollback** — `...rollback.sql`
```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon;
```
(실측 prior state 4-priv 정확 원복 — ALL 아님)

---

## 3. dry-run 무영속 (표준 3요소)

runner: `supabase/migrations/20260813000000_foot_default_acl_anon_forward_revoke.dryrun.mjs`
log: `db-gate/T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE_dryrun.log`

```
stripped top-level txn-control (INV-5): ["BEGIN;","COMMIT;"]
harness response: []   ← ALTER DEFAULT PRIVILEGES REVOKE 실행 무오류(semantic valid)
post-probe [anon public TABLES default SELECT still present] absent? -> [{"absent":true}]
post-probe [anon public TABLES default 4-priv still present]  absent? -> [{"absent":true}]
== DRY-RUN PASS == (txn-control stripped · plpgsql exception-rollback · post-probe absent)
```
REVOKE 마이그 post-probe 의미 = 롤백 후 anon default-grant 4-priv 여전히 present → **prod 미변경 실증**.

---

## 4. ★ apply 순서 — GO-token 대기 (apply_before_go 금지)

- **Gate-B(DA) GO ≠ apply 허가.** dev prod apply 는 supervisor DB-GATE **GO-token 발행 후에만**.
- apply chokepoint: `scripts/db_apply_guard.sh T-20260813-foot-DEFAULTACL-ANON-FORWARD-REVOKE supabase/migrations/20260813000000_foot_default_acl_anon_forward_revoke.sql`
- GO-token 前 prod DDL 선집행 **금지**(apply_before_go 클래스). 현재 **미적용(HOLD)**.
- §3.1 CEO 파괴게이트 **면제**(exposure-reducing·가역) · CEO NOTIFY 불요 — supervisor DDL-diff + GO-token 만 선행.

## 5. DoD 잔여
- [x] introspection BEFORE (anon 잔존 4-priv 확인)
- [x] mig up + rollback + dry-run PASS (present 분기)
- [ ] supervisor DB-GATE GO-token 발행
- [ ] prod apply (GO-token 후) → introspection AFTER (anon 잔존 **0**) → deploy-ready 마킹
