# POSTCHECK evidence — T-20260806-foot-PLANA-PKG-PAY-EXPAND (prod-apply by dev-foot)

- **적용주체**: dev-foot (마이그 직접 실행 규약). DB-GATE GO = supervisor MSG-20260807-061430-z0n8 (union tip 38b008e0).
- **적용파일(단일)**: `supabase/migrations/20260807130000_foot_package_payments_cband_cat_canon.sql` — **단일 파일만 적용** (db push 백로그 금지 준수, applyMigration() 단일 version 경로).
- **경로**: worktree `_wt-plana-pkg-pay` @ `38b008e047c4c7b556b817101ff6c6c4f0de2161` (C24 pin, 미변경 — feat tip 무이동).
- **project ref**: rxlomoozakkjesdqjtvd (obliv-foot-crm prod).

## PRE-STATE (apply 전, 베이스라인 — dryrun 무영속 INV-3 정합)
- column payment_attempt_id: ABSENT []
- FK package_payments_payment_attempt_id_fkey: ABSENT []
- partial UNIQUE ux_package_payments_payment_attempt_id: ABSENT []
- ledger 20260807130000: ABSENT []

## APPLY
- `applyMigration({version:'20260807130000', dryRun:false, createdBy:'T-20260806-foot-PLANA-PKG-PAY-EXPAND'})` → `applied:true`

## POSTCHECK (information_schema 실측 — 전항 PASS)
- **(a) column present**: `package_payments.payment_attempt_id` — data_type=`uuid`, is_nullable=`YES` ✅
- **(b) FK 실재**: `package_payments_payment_attempt_id_fkey` FOREIGN KEY → `cband_payment_attempts(id)`, delete_rule=`SET NULL` ✅
- **(c) partial UNIQUE 실재**: `ux_package_payments_payment_attempt_id` = `CREATE UNIQUE INDEX ... ON public.package_payments USING btree (payment_attempt_id) WHERE (payment_attempt_id IS NOT NULL)` ✅
- **(d) 원장 등재**: schema_migrations `20260807130000` name=`foot_package_payments_cband_cat_canon` created_by=`T-20260806-foot-PLANA-PKG-PAY-EXPAND` ✅

**== POSTCHECK PASS (4/4 present) ==**

## RE-VERIFY (canonical DB-GATE-REPLY GO 수신 후 live 재검증 — MSG-20260807-061524-2dmh, union tip 38b008e0)
> RE-SUBMIT#4 canonical GO(DB-GATE-REPLY) 수신 직후 dev-foot 가 prod(rxlomoozakkjesdqjtvd) `information_schema`/`pg_indexes`/`supabase_migrations.schema_migrations` **live 독립 재조회**. NO-GO#3=deploy_ancestry_stomp(git ancestry) 는 DB 롤백 아님 → ADDITIVE·IF-NOT-EXISTS 멱등 마이그 prod 잔존. 재적용 불요(멱등 no-op), 4/4 객체 실재 재확인:

- **(a) column present**: `package_payments.payment_attempt_id` data_type=`uuid` is_nullable=`YES` ✅ (+ `external_approval_no` text, `external_tid` text 실재 — 20260523040000 기존 IF NOT EXISTS no-op 정합)
- **(b) FK 실재**: `package_payments_payment_attempt_id_fkey` FOREIGN KEY → `cband_payment_attempts(id)`, delete_rule=`SET NULL` ✅
- **(c) partial UNIQUE 실재**: `ux_package_payments_payment_attempt_id` = `CREATE UNIQUE INDEX ux_package_payments_payment_attempt_id ON public.package_payments USING btree (payment_attempt_id) WHERE (payment_attempt_id IS NOT NULL)` ✅
- **(d) 원장 등재**: schema_migrations `20260807130000` name=`foot_package_payments_cband_cat_canon` created_by=`T-20260806-foot-PLANA-PKG-PAY-EXPAND` ✅

**== RE-VERIFY POSTCHECK PASS (4/4 live-present) ==**

## 잔여 (supervisor)
- 사후 검증 → merge (union tip 38b008e0 → main). ⚠ red-main CI freeze 독립 — 마이그 prod-apply 는 선행 완료.
- 다음 형제 foot 티켓 main 전진 前 즉시 merge 로 ancestry race 종료 (supervisor 판단: CI_GATE_OVERRIDE merge-bounded / defer).
- field-soak: 실단말 갤탭 CAT 패키지 결제+취소 confirm (현장).

*prod-apply + POSTCHECK PASS · dev-foot · 2026-08-07 (canonical GO re-verify)*
