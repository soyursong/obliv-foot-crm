# DB-GATE evidence — T-20260806-foot-PLANA-PKG-PAY-EXPAND (RE-SUBMIT#4)

- **verdict**: **DB-GATE GO** (supervisor MIG-GATE PASS). change-class = **ADDITIVE** (nullable 3컬럼 ADD + net-new FK + partial UNIQUE index). 파괴 0·기존행 mutation 0.
- **DA CONSULT**: DA-20260806-foot-PLANA-PKG-PAY-LANDING-MODEL (CONSULT-REPLY MSG-20260806-164140-y0ua, verdict **(b) canonical ADDITIVE GO**).
- **게이트**: supervisor MIG-GATE (CEO 게이트 면제 = §3.1 ADDITIVE + DA GO). C22 N/A (CEO 게이트 티켓 아님).
- **deploy_commit(C24 pin)**: `38b008e047c4c7b556b817101ff6c6c4f0de2161` (union tip).
- **⚠ 적용주체**: DB 적용 = **dev-foot 책임**(마이그 직접 실행 규약). supervisor = 사전 승인(본 GO) + 사후 검증(POSTCHECK).
- **⚠ GO-token lane**: foot 는 ed25519 GO-token lane 미배선(body/scalp2 만 wired, C20 "전 CRM 이식은 후속 티켓"). foot sanctioned DB-GATE GO = 본 `_dbgate.md` 메모 + supervisor 승인.

## 마이그 파일 (배포세트)
| 파일 | 역할 |
|------|------|
| `supabase/migrations/20260807130000_foot_package_payments_cband_cat_canon.sql` | up (ADD COLUMN IF NOT EXISTS ×3 + guarded FK + partial UNIQUE + COMMENT) |
| `..._.dryrun.mjs` | Migration Dry-Run No-Persistence (txn-control strip + plpgsql exception-rollback + post-probe) |
| `..._.rollback.sql` | net-new 대칭 제거 (payment_attempt_id·FK·partial UNIQUE). external_* 무접촉(20260523040000 소유) |

## DDL (ADDITIVE — 실측)
- `package_payments` ADD COLUMN IF NOT EXISTS: `external_approval_no text` · `external_tid text`(둘 다 20260523040000 기존 → no-op) · `payment_attempt_id uuid`(net-new)
- FK `package_payments_payment_attempt_id_fkey` → `cband_payment_attempts(id)` ON DELETE SET NULL (IF NOT EXISTS 가드)
- partial UNIQUE `ux_package_payments_payment_attempt_id` WHERE payment_attempt_id IS NOT NULL (이중결제 2차방어)
- COMMENT ×3 (CAT-origin 판별자·AUTHNO·TID 축 문서화)

## supervisor MIG-GATE 체크리스트 (전항 PASS, union tip 38b008e0 독립 재검증 2026-08-07T06:12)
1. **C13 ancestry**: `git merge-base --is-ancestor origin/main(90dd1579) 38b008e0` = **YES** — superset(90dd1579 ⊆ 38b008e0), LOST 커밋 0. cf_ancestry_guard `[PASS] 90dd15797 ⊆ 38b008e04`. NO-GO#3 blocker(deploy_ancestry_stomp) **해소 확인**. (branch-rule 미포함 = merge-前 정상상태, db_change=true deploy-order.)
2. **C24 pin**: safe_deploy_push --mode precheck = **PASS** (deploy_commit 38b008e0 명시 pin).
3. **mig version uniqueness**: `20260807130000` origin/main tree 부재 = unique(collision 0). CONSULTCONFIRM `20260807120000` 도 main 미착지.
4. **DDL-diff**: ADDITIVE-only(위). 롤백 대칭(net-new만 DROP, external_* 무접촉). SECDEF 0(C23 N/A). RLS 0(C3 N/A). 등록 계약 RPC 재정의 0(C19 N/A).
5. **C12 ref-column guard**: `verdict:PASS refs_total:0` (worktree 실행). FK-target `cband_payment_attempts` prod 실재 = dryrun DO$$ 무오류 실행으로 재확인.
6. **MIG Dry-Run No-Persistence**(union tip 실 재실행): `== DRY-RUN PASS ==` — txn-control strip ['BEGIN;','COMMIT;'] · harness [] · post-probe `package_payments.payment_attempt_id` ABSENT=true · index `ux_package_payments_payment_attempt_id` ABSENT=true (net-new 객체 prod 미영속 INV-3).
7. **빌드**(union tip): `npm run build`(tsc -b + vite) → `✓ built in 6.39s` exit 0.
8. **substance byte-identity**: `git diff 936d170c..38b008e0` branch파일(mig .sql) 비-주석 SQL 변경 = **0줄**. NO-GO#2 독립검증 GO급 그대로 유효.
9. **C18/C18-2/C21 HOLD·RETRACT**: signals+MQ+frontmatter fresh-read = 활성 HOLD/RETRACT/BINDING **0**. C18-2 holdcheck(go-ts 06:10) = CLEAR.

## 잔여 (post-GO)
- **prod-apply**: dev-foot 가 `20260807130000_*.sql` prod 적용 → **POSTCHECK**(information_schema: payment_attempt_id 컬럼 present + FK + partial UNIQUE 실재) → supervisor 사후 검증.
- **merge**: union tip 38b008e0 → main. ⚠ **red-main CI freeze**(GHA hosted-runner outage — main runs 16:38/18:19 queued 未pickup 실측). 형제 foot 선례(SMS-DUMMY/TESTTID/PKG-REGEN) → **CI_GATE_OVERRIDE(merge-bounded)** 또는 outage 해소까지 defer. 마이그 prod-apply 는 CI freeze 와 독립(먼저 진행).
- **field-soak**: 실단말 갤탭 CAT 패키지 결제+취소 confirm(현장).

*supervisor MIG-GATE GO · 2026-08-07T06:12:19+09:00 · union tip 38b008e047c4c7b556b817101ff6c6c4f0de2161*
