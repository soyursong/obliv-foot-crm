# db-gate — T-20260714-foot-MIG-VERSION-COLLISION-COPAYMENT-LEDGER-RECONCILE

**gate**: C2 content-parity (Case C2) — **PASS**
**ball**: dev-foot(rename + content-parity) ✅ → **supervisor**(원장 forward-doc write + DDL-diff) → close
**lane 경계**: dev-foot = 코드 lane(파일 rename + content-parity 재현). schema_migrations forward-doc row write = **supervisor exec lane 전속** (DA §1-1 method 정정, dev-body mig262 OOB revert 선례). dev-foot 는 원장에 INSERT 하지 않음.

## 1. version 재부여 (DA §1 승인) — 완료·push됨
- `20260714120000_… → 20260714120500_calc_copayment_hira_governed_elderly_tiers.sql` (+ `.rollback.sql` 짝) rename.
- commit `d8cabaeb` (R100, DDL 무변경, 0 insertions/0 deletions).
- ⚠ 이 rename 파일·rollback 짝은 **prod 이미 물화됨 → push/replay 금지** (lineage 기록용).
  - 충돌 원인: `20260714120000` 을 selfcheckin(apply 10:32)이 원장 선점 → copayment(commit 42d6af9f, 05:49 apply) 원장 미기록.

## 2. content-parity 재현 (§3, Case C2) — PASS
증거: `db-gate/…_content_parity.json` (스크립트 `scripts/…_content_parity.mjs`, READ-ONLY 재실행 가능).

| 항목 | 결과 |
|------|------|
| pg_get_functiondef body byte-identical (mig ↔ prod) | **true** (3477 = 3477 bytes) |
| 89.4 has_894 오탐 반증 (출현 전부 주석) | **true** — 유일 출현 line 52 `-- …(89.4 fallback 제거…)` |
| COALESCE(...,89.4) 계산로직 부재 | **true** |
| hira_unit_value NULL → data_incomplete BLOCK | **true** |
| 노인 외래 4구간 (≤15k=1500 / ≤20k=10% / ≤25k=20% / >25k=30%) | **true** |
| COMMENT v1.3 (obj_description) | **true** |

> 주의: 기존 probe 의 `comment_v13:false` 는 오탐 — `pg_get_functiondef` 는 COMMENT 를 emit 하지 않음. `obj_description(oid,'pg_proc')` 로 별도 조회 시 v1.3 COMMENT 실재 확인됨.

## 3. supervisor 집행 대상 — forward-doc 원장 1행 (statements=NULL)
현재 `schema_migrations` 에 `20260714120500` **부재**(`ledger_120500_present:false`). 아래 1행만 write (provenance 기록, replay 대상 아님):

```
version    = 20260714120500
name       = calc_copayment_hira_governed_elderly_tiers
statements = NULL   -- DA full-fidelity 반려: replay 대상 아님(provenance). statements 채우면 이중패치 유발.
```
- write 방식: `INSERT … ON CONFLICT DO NOTHING` (supervisor exec lane).
- prod calc_copayment v1.3 함수 정의 **무접촉** (byte-identical 이미 확증 — DDL 재적용 불필요).

## 4. accept (DA D1 재정의)
- 기존 "dry-run push-path pending 0" 전역기준 **폐기**. 255 pending(Case L) 앞 blanket `db push`/`repair-all` **금지**.
- 본 티켓 accept = **copayment 단일 forward-doc scope-lock**: 20260714120500 원장 1행 + prod v1.3 무접촉 + NEW divergence 0.
- 255 pending sweep 는 별건 P2 (본 P1 의 인질 아님).
