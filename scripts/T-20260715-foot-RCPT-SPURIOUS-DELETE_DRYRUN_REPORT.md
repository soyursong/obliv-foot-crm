# T-20260715-foot-RCPT-SPURIOUS-DELETE — DB-GATE Evidence Report

**FIX-REQUEST**: MSG-20260715-114712-fcrm (supervisor, P1, phase1 / `mig_dryrun_missing`)
**Protocol**: `agents/docs/migration_dryrun_no_persistence_standard.md` v1.0
**Runner**: `scripts/T-20260715-foot-RCPT-SPURIOUS-DELETE_dryrun_run.mjs` (uses canonical `scripts/dryrun_lib.mjs`)
**Transport**: Supabase Management API (foot canonical; `rxlomoozakkjesdqjtvd`)
**Date**: 2026-07-15

---

## ⚠ 0. 재갱신 사유 — dry-run 이 실 RC 를 노출함 (evidence gap 이 아니라 correctness bug)

무영속 dry-run 을 프로토콜대로 실행하자 **마이그가 항상 ABORT** 하는 실버그가 드러났다:

```
ERROR: P0001: ABORT remove: customers 삭제 0건 (기대 4) — 롤백
```

**RC**: `aicc_crm_phone_match` 는 **독립 테이블이 아니라 customers 투영 auto-updatable VIEW** 다
(`relkind='v'`, viewdef = `SELECT id AS customer_id, clinic_id, name, phone, created_at FROM customers`).
따라서 REMOVE 단계의 선행문 `DELETE FROM aicc_crm_phone_match WHERE customer_id = ANY(tgt)` 는
auto-rewrite 로 **customers 를 먼저 삭제**한다. 그 뒤의 `DELETE FROM customers ...` 는 이미 사라진
행을 찾지 못해 `del_c = 0` → `IF del_c <> 4 THEN RAISE ... 'ABORT remove 0건'`. 마이그 원안은
결코 성공할 수 없었다(구조 리뷰만으로는 안 잡히는 런타임 RC — dry-run 필수성 실증).

**FIX (surgical)**: view-DELETE 선행문 제거 → `customers` 단일 DELETE 로 정정. view 행은 customers
삭제로 동반 소멸하므로 `del_a` 는 `n_aicc_live − (사후 view 잔존)` 로 산출. archive 는 감사용 투영
사본으로만 보존(순소실0 은 full-fidelity customers archive 가 담보). commit 참조: 하단.
DA/data-model 함의: 신규 컬럼·테이블·enum 추가 0 (§S2.4 consult gate 비발동) — DELETE 문 1개 제거 + 주석 정정뿐.
`rollback.sql` 무수정(supervisor 확인대로): customers 우선 복원 → aicc 복원문은 view 재populate 로 no-op(멱등).

---

## 1. Dry-Run No-Persistence 실행 로그 (정정 후, PASS)

```
== LEDGER 3-WAY 대조 (파일명 ↔ 레저 ↔ prod) ==
    파일선언 : 20260715150000_foot_rcpt_spurious_delete_archive_first (git, diag 브랜치)
    prod 레저: 매칭행 0건 [] (기대=0, 미존재)
    레저 컨텍스트: total_rows=142, max_version=20260715140000 (본 마이그 20260715150000 부재·미적용)
    ⇒ 3자 일치: 파일=선언만 / 레저=미기재 / prod=미물화(archive 2테이블 부재 = post-probe). 아직 apply 전.

== GUARD-MIRROR (live prod read-only 재평가) ==
    {"g1_freeze_overlap":0,"live_customers":4,"g2_fingerprint":4,"g3_ledger_contact":0,"aicc_live":4}
    G5 chart_number: above_count=17 max=F-4781 => INTERIOR-GAP (재발번 상위 → 재사용 원천 없음, 무해)
    판정: g1_freeze_overlap=0·live_customers=4·g2_fingerprint=4·g3_ledger_contact=0·aicc_live=4
          ⇒ up.sql G1~G4 통과 예정, DONE 예상 = archived customers=4 aicc=4, removed customers=4 aicc=4

== CANONICAL DRY-RUN (dryrun_lib: strip + exception-handler + post-probe) ==
== dry-run 20260715150000_foot_rcpt_spurious_delete_archive_first.sql ==
   stripped top-level txn-control (INV-5): ["BEGIN;","COMMIT;"]
   harness response: []
   post-probe [relation public._archive_rcpt_spurious_customers_20260715] absent? -> [{"absent":true}]
   post-probe [relation public._archive_rcpt_spurious_aicc_20260715] absent? -> [{"absent":true}]
   post-probe [target 4 customers NOT deleted (still present=4)] absent? -> [{"absent":true}]
   post-probe [target aicc rows NOT deleted (still present=4)] absent? -> [{"absent":true}]

== DRY-RUN PASS == (txn-control stripped · plpgsql exception-rollback · post-probe absent)
```

### 1-1. "기대 로그(G1~G4 + G5 + DONE + sentinel)" 어떻게 담보되나 — NOTICE 관측 한계와 동치 증거

foot canonical transport(Management API `/database/query`)는 서버 `RAISE NOTICE` 를 응답에
싣지 않는다(빈 `[]` 반환, 실측). up.sql 내부 NOTICE 문자열('DONE: archived customers=4 ...')
원문은 이 경로로 캡처 불가. 대신 **동치이자 더 강한 증거**:

- **CLEAN PASS 자체가 전 가드 성립의 증명이다.** up.sql 은 count 불일치 시 sentinel 이 아닌
  일반 EXCEPTION 을 RAISE 한다(G1 overlap≠0 / G2 fp≠4 / G3 ledger≠0 / G4 child≠0 /
  archive≠4 / del_c≠4 / final≠0). `dryrun_lib` 의 exception-handler 는 sentinel
  (`DRYRUN_OK_ABORT`)만 PASS 후보로 흡수하고 그 외 전부 **re-raise(INV-4)** → q() throw → FAIL.
  ⇒ **PASS 되었다 = 모든 가드(G1~G4)와 DONE assertion(archived 4/4, removed 4/4)이 전부 성립**했다는 함의.
  (실증: 정정 전에는 del_c=0 로 'ABORT remove' 가 re-raise 되어 정확히 FAIL 로 잡혔다.)
- **post-probe(INV-3)**: dry-run 후 생성 대상 archive 2테이블 **prod 부재** + 대상 4행/aicc 4행
  **미삭제(잔존)** 실측 → sentinel rollback 무영속 확증.
- **guard-mirror**: 각 가드 술어를 live prod 에서 read-only 재평가 → 숫자로 G1~G4 통과·G5=INTERIOR-GAP·DONE 예상치 확인.

---

## 2. Ledger 3-자 대조 (파일명 ↔ 레저 ↔ prod)

| 축 | 값 | 판정 |
|----|----|------|
| **파일선언** | `20260715150000_foot_rcpt_spurious_delete_archive_first.sql` (git, diag 브랜치) | 선언 존재 |
| **prod 레저** | `supabase_migrations.schema_migrations` 내 `version LIKE '20260715150000%' OR name ILIKE '%rcpt_spurious%'` → **0건** | **미기재** ✓ |
| **prod 실재** | archive 2테이블(`_archive_rcpt_spurious_customers_20260715`, `_archive_rcpt_spurious_aicc_20260715`) `to_regclass` → NULL/NULL | **미물화** ✓ |

레저 컨텍스트: `total_rows=142`, `max_version=20260715140000`. 본 마이그(`20260715150000`) 는 레저 최상단보다 위 = **아직 apply 전, 정상 3자 정합**(파일=선언만 / 레저=미기재 / prod=미물화). apply-time divergence 없음.

---

## 3. MIG-2 (FK-ADD) — **N/A**

본 마이그는 파괴적 archive-first DELETE 전용. `ADD CONSTRAINT` / `FOREIGN KEY` / `REFERENCES` 신설 **0건**
(grep 확인). DDL 은 archive TABLE 2건 `CREATE TABLE IF NOT EXISTS ... (LIKE ...)` + 메타컬럼
`ADD COLUMN IF NOT EXISTS`(2 테이블 × `_archived_at`,`_ticket`)뿐. FK 무결성 가드는 SOP §FK-Integrity
상 **DELETE 대상의 자식 접점 재검증(G3 원장 / G4 자식)** 으로 이행됨(신규 FK 생성 아님). ⇒ MIG-2 해당 없음.

---

## 4. 재현 (reproducibility)

```
cd ~/GitHub/obliv-foot-crm
node scripts/T-20260715-foot-RCPT-SPURIOUS-DELETE_dryrun_run.mjs   # exit 0 = PASS
```
