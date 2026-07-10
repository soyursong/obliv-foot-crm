# T-20260710-foot-PKGTRIPLE-LEDGER-DA-CONSULT — MIG-GATE evidence (AC2/AC3)

**분기**: migration_ledger_reconciliation §2 (F) forward-doc — 정본=prod 실재. prod DDL 0. 원장(schema_migrations)이 실재로 수렴.
**게이트**: DA CONSULT GO (DA-20260710-foot-PKGTRIPLE-LEDGER-RECONCILE / MSG-g52g) + 대표 게이트 면제(autonomy §3.1 ADDITIVE).
**prod**: rxlomoozakkjesdqjtvd (foot) · Management API `/database/query` (blanket `db push` 미사용)
**실행일**: 2026-07-10

---

## 1. content-parity 재현 (선행 게이트 — DA #2, 본문 일치)

두 함수 `pg_get_functiondef` 덤프(prod) vs 파일 본문 diff. BEGIN…END; 본문 **byte-equal**.

| 함수 | 파일 본문 | prod 본문 | body-parity |
|------|-----------|-----------|-------------|
| transfer_package_atomic | 3152B | 3152B | **EQUAL ✓** |
| consume_package_sessions_for_checkin | 1920B | 1920B | **EQUAL ✓** |

prod 덤프 원문 보존:
- `db-gate/T-20260710-foot-PKGTRIPLE-LEDGER_prod_transfer_package_atomic.sql` (sha1 ca61f80a7b55bbbc1d8a8706634cce4a4d8a59f6)
- `db-gate/T-20260710-foot-PKGTRIPLE-LEDGER_prod_consume_package_sessions_for_checkin.sql` (sha1 06c5fa348fd6b68699a00041c97ccce9e75a3200)

### 돈-불변식 A~E (prod == 파일, 명시확인)

| # | 불변식 | 파일 라인 | prod 확인 |
|---|--------|-----------|-----------|
| A | 승계 INSERT가 `packages`에만, `package_payments` INSERT 본문에 없음 (매출 재계상 0) | L90–114 | ✓ `INSERT INTO packages (` 존재 · `package_payments` 미등장 |
| B | 승계 단가 `v_unit=total_amount/total_sessions`, `v_carry=ROUND(v_unit*total_remaining)` (calc_refund_amount 동일) | L73–76 | ✓ 산식 라인 일치 |
| C | 원본 `status='transferred'` 전이 (환불/재양도 차단) | L79–86 | ✓ `UPDATE packages SET status='transferred'` |
| D | consume 멱등블록 `COUNT(*) … status='used'` 후 `v_short := v_desired - v_existing` | L159–166 | ✓ 일치 |
| E | 초과차감 방지 `FOR UPDATE OF p` + `IF v_pkg_id IS NULL THEN EXIT` | L168–196 | ✓ 일치 |

### 시그니처 / 보안 / GRANT

- 시그니처 정확 일치, **오버로드 잔재 0** (public 스키마 내 동명 함수 각 1건).
  - `transfer_package_atomic(p_package_id uuid, p_target_customer_id uuid)`
  - `consume_package_sessions_for_checkin(p_check_in_id uuid, p_customer_id uuid, p_clinic_id uuid, p_counts jsonb)`
- `SECURITY DEFINER` = **true** (양 함수), owner=postgres.
- GRANT: `authenticated=X` **존재**(파일 선언 충족).
  - proacl(양 함수 동일): `{=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X}`

> **anon=X 판정 = ambient Supabase 기본값 (파일-vs-prod divergence 아님)**
> public 스키마 함수 135건 중 **119건**이 `anon=X` 보유(= project-wide `ALTER DEFAULT PRIVILEGES`).
> 동일 계열 sibling 함수(`calc_refund_amount`, `get_package_remaining`, `refund_package_atomic`) 전부 동일 ACL.
> 파일은 anon에 대해 침묵(GRANT는 authenticated만) — 파일 적용 시 산출되는 ACL과 일치하므로 **content-parity 위반 아님**.
> ※ 별건 관측: SECURITY DEFINER 돈-함수에 anon EXECUTE가 systemic하게 부여됨은 광범위 보안 사안 → planner에 관측(observation) 분리 보고(본 forward-doc 무손실 범위 밖, REVOKE는 파괴변경으로 별도 DA+티켓 필요).

**content-parity 결론: PASS** (drift 0 → backfill 진행 요건 충족).

---

## 2. 단일 version repair-mark (backfill 실행)

- 경로: `recordLedger()` (Management API 단일 INSERT, `ON CONFLICT (version) DO NOTHING` idempotent) = `supabase migration repair --status applied` 동형.
- **blanket `db push` 미사용** (window 내 타 unrecorded 마이그 동반실행·rename 재실행 함정 회피 — mig289 §Q1 선례).
- 함수 재실행 **없음** (이미 prod 물화). `pg_proc` 무접촉.
- 기록 행: `version=20260703040000, name=foot_pkg_triple_defect_transfer_deduct, statements='{}', created_by='T-20260710-PKGTRIPLE-LEDGER-DA-CONSULT/forward-doc'`
- 스크립트: `scripts/T-20260710-foot-PKGTRIPLE-LEDGER_backfill.mjs` (로그: `..._backfill.log`)

---

## 3. MIG-GATE 3필드

- **mig_dryrun**: 파일선언 vs prod `pg_get_functiondef` diff 재현 — 양 함수 BEGIN…END; body byte-equal(3152B/1920B). 돈-불변식 A~E prod==파일 전건 ✓. 시그니처 정확·오버로드 0·SECURITY DEFINER 유지·authenticated GRANT 존재. anon=X는 ambient 기본값(119/135) = 파일 divergence 아님.
- **mig_ledger_check**: backfill 前 `[ledger=false prod=true(fns=2) file=true → divergence=1]` → 後 `[ledger=true prod=true file=true → divergence=0]`. schema_migrations↔파일↔prod 3자 정합 확정.
- **mig_rollback**: 원장행 제거 = `DELETE FROM supabase_migrations.schema_migrations WHERE version='20260703040000';` (함수 실체·GRANT 무접촉). 파일 rollback `.rollback.sql`(DROP FUNCTION 2종)은 함수 자체 제거용이며 forward-doc 성격상 미사용.

## 4. 무손실 준수

prod 함수 실체·GRANT·기존 packages/package_sessions/package_payments 데이터 **무변경**. DROP/재생성 0. 원장 1행 write만.

## 5. supervisor DDL-diff 게이트 (deploy-ready 후)
(a) prod pg_proc 시그니처·SECURITY DEFINER·GRANT (b) 파일↔prod 본문 diff 0(불변식 A~E) (c) repair 후 20260703040000 applied 반영 (d) FE 양도·선수금차감 smoke 1회.
