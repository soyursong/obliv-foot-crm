# T-20260717-foot-MIG-LEDGER-RECONCILE-ANONSWEEP — 3-way Ledger Reconcile Evidence

- **작성**: dev-foot / 2026-07-17
- **prod**: rxlomoozakkjesdqjtvd (Supabase Management API introspection, 읽기 전용)
- **표준**: Migration Ledger Reconciliation(정본=prod 실체) + Migration Dry-Run No-Persistence Protocol
- **스크립트**: `scripts/T-20260717-foot-MIG-LEDGER-RECONCILE-ANONSWEEP_introspect.mjs`
- **정본 원칙**: schema_migrations 원장 ≠ 파일선언 ≠ prod 실체 divergence → **prod 실체 기준**으로 수렴.

---

## Divergence A ⚠보안 — ANON-WRITE / RPC-EXEC SWEEP prod 미착지 (확증)

### 3자 대조
| 축 | 20260715130000 (ANON-WRITE-SWEEP) | 20260716180000 (RPC-EXEC batch1) |
|----|-----------------------------------|----------------------------------|
| 파일 선언 | 존재(up+rollback) | 존재(up+rollback) |
| schema_migrations 원장 | **부재 (NONE)** | **부재 (NONE)** |
| prod 실체(효과) | **미착지** — anon-write 테이블 117 | **미착지** — 4함수 anon EXEC=true |
| 티켓 선언(parent) | `deployed`+`qa pass` (R3 verify) | 커밋됨 |

→ **선언(deployed) ↔ prod 실체(미적용) = false-verify 확증. 정본=prod(미적용).**

### prod 실측 pre-state
- anon-writable base 테이블(INS/UPD/DEL) = **117** (sweep 성공 시 0)
- anon-TRUNCATE base 테이블 = **114** (sweep 성공 시 0 · RLS 미커버 실 gap)
- public base total = 125
- **admin_register_user** anon EXECUTE = **true**
- **admin_reset_user_password** anon EXECUTE = **true**
- **foot_stats_revenue** anon EXECUTE = **true**
- **get_vault_secret** anon EXECUTE = **true** ⚠ **보안심각 — anon 이 vault secret 리더 EXECUTE 가능 (라이브 노출)**

> 주의: get_vault_secret / admin_* / foot_stats_revenue 의 anon-EXEC 봉합은 **마이그 B(RPC-EXEC, 20260716180000)** 소관. 마이그 A(ANON-WRITE, table grant)는 테이블 write/TRUNCATE 봉합.

### Dry-run (No-Persistence Protocol)
| 마이그 | 결과 | 비고 |
|--------|------|------|
| A 20260715130000 | **PASS** | txn-control strip(BEGIN;/COMMIT;) · plpgsql exception-rollback · post-probe absent 4/4. PREFLIGHT+sweep+ALTER DEFAULT+AC-2+VERIFY 전부 rolled-back subtxn 내 통과 |
| B 20260716180000 | **PASS** (2026-07-17 재실행, DA GO 후) | expected count 93→94 정정 후 재실행 → sentinel 도달(harness resp `[]`, VERIFY 94 통과) · txn-control strip(BEGIN;/COMMIT;) · plpgsql exception-rollback · post-probe absent 4/4(anon foot_stats_revenue/admin_reset_user_password/get_vault_secret EXECUTE 여전히 grant=REVOKE 미영속 + postgres fn default_acl anon=X 잔존=ALTER DEFAULT 미영속). |
| ~~B 20260716180000 (구)~~ | ~~FAIL (blocker)~~ | ~~`VERIFY_FAIL: revoked count = 94 (expected 93)`. prod drift → VERIFY 가드 정상 abort. DA CONSULT-REPLY(MSG-20260717-181836-o8v8)로 93→94 정정 GO → 해제.~~ |

---

## ★ 마이그 B BLOCKER — prod drift +1 (✅ 해제: DA CONSULT-REPLY MSG-20260717-181836-o8v8, 93→94 정정 GO)

> **[해제 2026-07-17]** DA 판정: `resettle_insurance_grade(uuid,text,boolean,text)` anon EXECUTE = **REVOKE**(staff-only, **category A 확정** — dev 권고 승인). expected count 93→94 정정 GO. 근거: Layer2 MONEY 함수(SECDEF payments refund/추가징수 INSERT + service_charges copay re-persist), 저작 의도 이미 staff-only(REVOKE ALL FROM PUBLIC+GRANT authenticated), 내부게이트 is_approved_user()+clinic isolation, REVOKE=strictly-more-secure·비파괴. → 마이그 B VERIFY 가드 `<>93`→`<>94` 정정 + dryrun passNote 정정 → **dry-run 재실행 PASS**. 이하 원인 규명은 히스토리 보존.

### 원인 규명 (definitive)
- 마이그 B 저작 시점(2026-07-16 18:00) introspect: public 함수 **141** / anon-exec **125** (32 KEEP + **93** REVOKE).
- 현재 prod: public 함수 **142** / anon-exec **126** (32 KEEP + **94** REVOKE). KEEP anon-exec = 32/32 정상.
- delta = **+1 total / +1 anon-exec**.
- 추적: 마이그 `20260716220000_foot_insgrade_resettle_marker_and_rpc` (원장 APPLIED, 22:00 = B 저작 이후)이 **신규 함수 `resettle_insurance_grade(uuid,text,boolean,text)` 1개 생성**.
  - 그 마이그는 `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` (스태프 전용 의도)만 수행.
  - 그러나 `anon=X` 는 postgres **default_acl(anon=X)** 에서 상속 → PUBLIC 회수만으로는 anon explicit grant 잔존 → **anon EXECUTE=true 로 누출**.
  - = 마이그 B 의 `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE FROM anon` 가 봉합하려는 바로 그 re-drift 벡터의 신규 실례.

### 판정 / 권고 (DA 확인 요망 — dev 자체 재분류 금지)
- `resettle_insurance_grade` = **신규 스태프 전용 보험 재정산 RPC** (자체 마이그 의도 = authenticated-only).
- 분류규칙 category **(A) staff-only-in-repo → Batch1 REVOKE** 에 명백히 해당. KEEP(키오스크/anon 정상경로) 아님.
- → **expected count 93 → 94** 로 수렴 + `resettle_insurance_grade` 는 REVOKE 집합에 자연 편입(anon-exec ∧ ¬KEEP)이 정합.
- **성격**: benign drift. 재분류는 anon-exec 누출을 회수하는 방향 = strictly more secure.
- **게이트**: 함수 KEEP/REVOKE 분류 = DA 소유(§S2.4 + 마이그 자체 "재-CONSULT 필요"). dev-foot 는 정밀 근거·권고만 제출, 무단 count 조정/deploy-ready 금지.

---

## Divergence B — SELFCHECKIN RPC 원장 stale (forward-doc, 무해)

### 3자 대조
| 축 | 20260716230000 (phone_normalize 부모) | 20260717120000 (created_by_canon 자식) |
|----|--------------------------------------|----------------------------------------|
| schema_migrations 원장 | **APPLIED** | **APPLIED** |
| prod 실체(RPC) | 3종 실재·정상 | 3종 실재·정상 |
| 티켓 선언 | `applied_at:""` · `qa fail(dependency_parent_not_applied)` | — |

### prod 실측
- selfcheckin upsert RPC 3종 전부 실재 · secdef=true · 시그니처 정상:
  - `fn_selfcheckin_upsert_customer(uuid,text,text,text,boolean,text,text,text,text)` secdef=true
  - `fn_selfcheckin_upsert_customer_resolve_v2(...12 args)` secdef=true
  - `fn_selfcheckin_upsert_customer_resolve_v3(...15 args)` secdef=true
- 함수참조 깨짐 없음. 두 OOB 마이그는 3종 KEEP 함수의 CREATE OR REPLACE(ACL 보존)만 수행 = 신규 함수 0.

→ **역방향 divergence(선언 과소, prod 완비). 무해. forward-doc** — 티켓 frontmatter 를 prod 실체(deployed)로 정정 (planner 소관, dev 는 evidence 만 회신).

### ⚠ governance note (planner 3차 진단 재확증분)
- `feat/T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON` (commit b7fb40b1) = **main 미머지**인데 prod 원장 APPLIED = **OOB apply (머지≠prod-apply 게이트 우회)**.
- 무해(ADDITIVE·signature 보존·3종 valid)이나 R3 false-verify 와 동계열 배포 거버넌스 gap → supervisor 회신 시 경위 포함 요망. forward-doc 정정 시 OOB 적용 사실 원장에 명기.

---

## db_change evidence 4필드 (ticket frontmatter)
- `mig_files`: [20260715130000_foot_anon_write_grant_hygiene_sweep] (deploy scope=A 단독) · `deferred_mig`: [20260716180000_foot_rpc_anon_exec_hygiene_sweep_batch1] (B, 별도 track)
- `mig_dryrun`: A=PASS(no-persistence, post-probe absent 4/4) · **B=PASS(no-persistence, post-probe absent 4/4 — expected 93→94 정정 후 재실행, DA GO MSG-20260717-181836-o8v8)**
- `mig_ledger_check`: A 원장 부재(미착지, 정본=미적용) · B(SELFCHECKIN) 원장 APPLIED(부모+자식) — 본 문서
- `mig_rollback`: 두 마이그 rollback.sql 동봉(anon grant 복원 = fork 기본값)
- `applied_at`: "" (미적용 — A/B 모두 supervisor DDL-diff 게이트 → prod APPLY 후 POSTCHECK 기록)

## POSTCHECK 쿼리 (적용 후 supervisor 검증용)
```sql
-- A 완료: 0 이어야 함
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'
   AND (has_table_privilege('anon',c.oid,'INSERT') OR has_table_privilege('anon',c.oid,'UPDATE')
     OR has_table_privilege('anon',c.oid,'DELETE') OR has_table_privilege('anon',c.oid,'TRUNCATE'));
-- B 완료: 4함수 전부 false 이어야 함
SELECT p.proname, has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname IN ('admin_register_user','admin_reset_user_password','get_vault_secret','foot_stats_revenue');
```
