# Migration Ledger Forward-Doc — DAYCLOSE version-collision disentangle (record-only)

- **ticket**: T-20260802-foot-DAYCLOSE-VERSION-COLLISION-RENUMBER (approved, P2, 1회성 인스턴스 정리)
- **작성**: dev-foot · 2026-08-02
- **SSOT/게이트**: `da_decision_foot_pmw_oob_rejectedbody_migledger_reconcile_20260802.md` §7 (DA Ledger Reconciliation CONSULT GO, MSG-20260802-115534-r93z)
- **분기 판정**: **(F) forward-doc = record-only** — objects 이미 prod-LIVE(supervisor 2026-08-02 11:16 직접 apply) → 재-apply 금지, ledger row 등재만.

---

## 1. 문제 (version 교차점유)

단일 ledger version `20260802160000` 을 **두 distinct 마이그가 동시 대표**했다:

| 마이그 | 파일 | prod 상태 | 소유 |
|--------|------|-----------|------|
| PMW autopromote forwardfix | `20260802160000_foot_pmw_reconcile_autopromote_forwardfix.{sql,rollback.sql}` | LIVE(승인 body, iy3f Leg1~3) | **정당점유** (10:33 최초 생성, DA §7-1) |
| DAYCLOSE confirmed-edit | `20260802160000_foot_closing_confirmed_edit.{sql,rollback.sql,dryrun.sql}` | objects LIVE(`closing_edit_log`·`closing_confirmed_edit`, 11:16 apply) | 차용(11:16 오귀속) |

→ DA §7-1: **PMW row `20260802160000` KEEP · 무접촉**. disentangle 은 **전적으로 DAYCLOSE 측 액션**.

## 2. dev-foot 액션 (본 커밋 — 파일 lane)

DA §7-2(a) + §7 처분 line 148 + ★refinement(line 151): dev-foot lane = **파일 renumber + down 대칭 + content-parity**.

- [x] **mig 파일 renumber** `20260802160000` → **`20260802160001`**(next-available, 충돌 0 확인):
  - `20260802160001_foot_closing_confirmed_edit.sql`
  - `20260802160001_foot_closing_confirmed_edit.rollback.sql` (down 대칭 유지)
  - `20260802160001_foot_closing_confirmed_edit.dryrun.sql`
- [x] **내부 version 참조 정합** — up.sql rollback/dryrun cross-ref + rollback.sql 헤더 원복 참조 = `..160001` 로 갱신 + renumber lineage 주석 추가.
- [x] **PMW 파일 무접촉** — `..160000_foot_pmw_reconcile_autopromote_forwardfix.*` 원본 그대로.
- [x] **content-parity**: up.sql body(closing_edit_log DDL + closing_confirmed_edit RPC) = origin/main `20260802160000` 원본과 **동일**(version 헤더 주석만 변경, DDL/함수 body 무변). ∴ renumbered 파일 ↔ prod-LIVE objects 정합.

## 3. supervisor 액션 (exec-lane — 물리 ledger INSERT)

DA §7 처분 line 149 + ★refinement(line 151): **물리 ledger INSERT = supervisor exec-lane 전속**(dev/DA 수기 INSERT 금지, §1.5 원장 write lane).

record-step 아티팩트 = `T-20260802-foot-DAYCLOSE-VERSION-COLLISION-RENUMBER_ledger_forwarddoc_apply.sql`:
- 역-divergence 가드: `closing_edit_log`(table) ∧ `closing_confirmed_edit`(function) **prod-LIVE 단언** — 부재 시 RAISE(record-only 전제 위반 fail-closed).
- `INSERT ... ON CONFLICT (version) DO NOTHING` — record-only, DDL 재-apply 0.
- **prod 재-apply 금지**: up.sql 은 멱등(CREATE IF NOT EXISTS / OR REPLACE)이나 db-push 재-apply 혼동 회피 위해 forward-doc(ledger row 등재)만 수행.

```
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260802160001', 'foot_closing_confirmed_edit')
ON CONFLICT (version) DO NOTHING;
```

## 4. 검증 (supervisor POSTCHECK — DA §7-4)

두 마이그 각 객체 + ledger 정합:
- **PMW row** `20260802160000`(PMW objects `promote_reconciled_payment_waiting` md5=`3f8da66b…` · `count_stuck…` md5=`9035…` + 승인 body) — **불변**(§6 canonical).
- **DAYCLOSE row** `20260802160001`(`closing_edit_log` table LIVE · `closing_confirmed_edit` function LIVE) — 등재 후 정합.
- 3자 대조(ledger ↔ 파일 ↔ prod) divergence 0.

## 5. HARD 가드 준수 (dev-foot)

- [x] PMW row/파일/함수 **무접촉** (DA §7-1).
- [x] schema_migrations 원장 **물리 write 안 함** — record-step SQL 준비만, exec = supervisor exec-lane(§1.5).
- [x] prod objects 재-apply/DDL 재실행 **0** — objects 이미 LIVE, forward-doc record-only.
- [x] renumbered version `20260802160001` = repo/ledger 충돌 0 확인 (next-available).
