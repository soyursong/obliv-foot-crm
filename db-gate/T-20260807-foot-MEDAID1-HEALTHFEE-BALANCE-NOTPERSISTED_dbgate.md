# DB-GATE evidence — T-20260807-foot-MEDAID1-HEALTHFEE-BALANCE-NOTPERSISTED (supervisor)

- **verdict**: **DB-GATE GO** · qa_result **pass** · qa_grade **Yellow**. change-class = **ADDITIVE** (net-new satellite table `health_maintenance_balances` + updated_at trigger/fn + RLS auth_all + anon REVOKE). 기존 테이블/행/제약 mutation 0 · 파괴 0 · payments/customers 원장 무접점.
- **DA CONSULT-REPLY**: `MSG-20260807-101523-8kqu` — verdict=GO(조건부)·ADDITIVE → §3.1 CEO 게이트 **면제** · 잔여 = supervisor DDL-diff / MIG-GATE only · DA prod WRITE/DDL=0. SSOT=`da_decision_foot_medaid1_healthfee_balance_persist_20260807.md`.
- **deploy_commit(C24 pin)**: `abe6d6eabc94137950df5582bcefe1927ac0e1a2` (ticket FE commit). origin/main tip = `75ad2e88` (COVAN-500MAN serial merge, abe6d6ea = FF ancestor).
- **적용주체 note**: migration `20260807150000` prod-apply = **이미 실현됨(already-realized)** — dev-foot E2E 착지 경로에서 적용된 것으로 추정(foot 마이그 직접실행 규약). supervisor = 독립 재검증 + Ledger Reconciliation forward-doc + deploy lifecycle 종결.

## 배포세트 (net-new)
| 파일 | 역할 |
|------|------|
| `supabase/migrations/20260807150000_foot_health_maintenance_balances_satellite.sql` | up (satellite 1:1 테이블 + touch trigger/fn + RLS auth_all + anon REVOKE) |
| `..._.rollback.sql` | 대칭 역연산 (trigger→function→table DROP, payments/customers 무손상) |
| `..._.dryrun.mjs` | No-Persistence(dryrun_lib 위임: txn-strip + exception-rollback + post-probe absent) |
| `src/lib/healthMaintenanceBalance.ts` | satellite 로더/영속 — 현재잔액 DERIVED, satellite 부재 시 EMPTY(0) 폴백(회귀 안전) |
| `src/components/PaymentMiniWindow.tsx` | medical_aid_1 진입 prefill(이월) + [잔액 저장] upsert + 월전환 stale 배너(DoD#3) |

## supervisor 검증 매트릭스 (독립 재검증 2026-08-07 12:2x · prod ref rxlomoozakkjesdqjtvd)

### Phase 1 코드 QA (5항목) — PASS
1. **Build**: PASS — `.build-result` RESULT: BUILD OK exit 0 (12:16:47).
2. **기존기능 영향**: PASS — 전 변경 net-new/additive. 로더 satellite 부재/에러 시 EMPTY(잔액0·이월없음) 폴백 → 회귀 안전. 기존 payment 산정 로직(payableTotal/netPayableAfterHealthFee) 무접촉.
3. **DB 호환**: PASS — ADDITIVE net-new + CHECK(verified_balance>=0).
4. **권한/RLS**: PASS — `auth_all`(FOR ALL TO authenticated true/true) = foot customers/payments 동급 tier(20260419000001 관례 일치). **anon SELECT=false 실증**(REVOKE 유효).
5. **롤백 SQL**: PASS — 대칭 DROP(trigger→function→table) 실재.

### Phase 1.5 env 매트릭스 — N/A (변경 파일 `import.meta.env` 신규 0 · 기존 `@/lib/supabase` 재사용).

### Phase 2 브라우저 — PASS
- `.browser-result` RESULT: BROWSER OK (foot passed/failed=3|0, exit 0, 12:17:27).
- 라이브 CF Pages 번들 실증: `index-gdBtLty-.js`(main) → 동적 chunk `PaymentMiniWindow-53x67GO6.js` 에 `health_maintenance_balances` 참조 **PRESENT**(feature 라이브 확인).

### deploy-precheck 게이트
- **C13 ancestry**: PASS — `merge-base --is-ancestor abe6d6ea origin/main` = YES. origin/main==HEAD==75ad2e88 (FF-clean, stomp 0).
- **C18/§8 2.8 DA HOLD**: CLEAR — signals(+archive) 본 티켓 활성 HOLD/binding/RETRACT 0. CONSULT-REPLY(10:23)로 dependency 해제·approved. supervisor MQ inbox 미처리 DA 0(pending 1건=dev-meta 무관 NOTIFY).
- **C19 contract RPC body-drift**: N/A — 등록 계약 RPC 재정의 0(net-new 테이블/트리거만).
- **C24 sha-pin**: PASS — deploy_commit abe6d6ea ⊆ origin/main. 배포세트 = 직렬머지(abe6d6ea MEDAID1 + 75ad2e88 COVAN).
- **C25 APK**: N/A (web_fe).
- **C26 ON CONFLICT arbiter**: PASS — FE upsert `onConflict:'customer_id'` = 테이블 PRIMARY KEY(암묵 unique index, partial 아님) → 42P10 위험 0.

### DB-GATE — 이미실현 + Ledger Reconciliation forward-doc (Migration Ledger Reconciliation 표준, 비파괴)
prod 실측(Management API read-only, prod-mutation 0) — 커밋된 마이그 파일과 **구조 byte-exact 일치**:
- **table** `health_maintenance_balances` 실재 · **rowcount 0**(clean).
- **columns(7)**: customer_id uuid PK · clinic_id uuid NOT NULL · verified_balance integer NOT NULL · verified_at timestamptz NOT NULL default now() · verified_by uuid NULL · created_at/updated_at timestamptz NOT NULL default now() — 전건 일치.
- **constraints**: CHECK(verified_balance>=0) · FK customer_id→customers(id) ON DELETE CASCADE · FK clinic_id→clinics(id) · FK verified_by→staff(id) ON DELETE SET NULL · PK(customer_id) — 전건 일치.
- **policy**: `auth_all`(cmd=* using=true check=true) · **anon has_table_privilege SELECT=false** — 일치.
- **trigger**: `trg_health_maintenance_balances_touch` BEFORE UPDATE FOR EACH ROW enabled · fn body `NEW.updated_at:=now(); RETURN NEW;` — 일치.
- **ledger**: `supabase_migrations.schema_migrations` 에 **20260807150000 등재됨**(100000/120000/130000/150000 확인).
- **판정**: 구조 완전일치 + 원장 등재 + anon-deny + rowcount 0 → 정상 적용 완료(hostile stomp 아님). 재적용 불요(idempotent no-op). frontmatter `applied_at`/`mig_ledger_check` 만 stale → **forward-doc 정정**.

## Yellow 근거
- DoD#4 = "배포 후 실제 health_maintenance 결제 발생 across 방문 이월 = 최종 판정 기준". 현 `payments(method=health_maintenance,status=active)` = 0건(실사용 미발생) → field-soak 관측 대기.
- medical_aid_1 모수 = 5명(RCA 3명 대비 자연 증가).

## Field-Soak
- `field_soak_until` = 2026-08-08T12:24(+24h). DoD#4(실 결제+이월) 현장 관측 후 최종 done.
