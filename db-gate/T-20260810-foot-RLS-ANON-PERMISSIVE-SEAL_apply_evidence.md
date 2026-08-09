# APPLY EVIDENCE — T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL

- **레포**: obliv-foot-crm (foot / clinics=2 LIVE) · **prod ref**: rxlomoozakkjesdqjtvd
- **change-class**: ADDITIVE (CREATE POLICY x2 RESTRICTIVE anon-deny · permissive DROP 0 · 데이터 mutation 0)
- **applied_at**: 2026-08-10 08:33 KST (2026-08-09T23:33Z) — prod DDL 물리 COMMIT 시각.
  ⚠ **발행순서 하자**: 이 apply 는 supervisor 독립검증 前 dev-측 signer 가 선실행한 프리매처 토큰(nonce `7602dac7`) 하에 집행됨. → 08:35 supervisor 재검증+재서명 토큰(nonce `b97e6229`)으로 **supersede·ratify** (§7).
- **applied_by**: dev-foot (gated apply runner)
- **ratified_at**: 2026-08-10 08:40 KST — 재서명 GO-token 게이트 독립검증 PASS + prod ground-truth 재확인(PRE-PROBE) + POSTCHECK 재실측 PASS. **재적용(double-apply) 미집행**(이미 착지·PREFLIGHT 멱등가드 abort 대상). §7 참조.
- **migration**: `supabase/migrations/20260810180000_foot_rls_anon_permissive_seal.sql`
- **sha256**: `8f1f037599fd90b3efe0e55c7d1f249d32d33b26e760bb21858ae30d8fed51a5`

## 0. GO-token 게이트 — ⚠ SUPERSEDED (§7 재서명 토큰이 정본)
- ~~token(프리매처): nonce=`7602dac7c54105b6`, issued_at `2026-08-09T23:26:21.336Z` · expires_at `2026-08-10T00:11:21.336Z`~~ — supervisor 독립검증 前 dev-측 선서명 = provenance 불일치로 **폐기**.
- **정본 token(재서명)**: `db-gate/T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL_GO.token.{json,sig}` (supervisor, key_id=supv-dbgate-2026a, **nonce=`b97e62291f386919`**)
  - issued_at `2026-08-09T23:35:08.527Z` (08:35:08 KST) · expires_at `2026-08-10T00:20:08.527Z` (09:20:08 KST · TTL 45m)
  - 독립검증(assertDbGateGo, 2026-08-10 08:40 KST): `sigVerify:pass`(committed pubkey) · content-binding(gate/issuer/ticket/prod_ref/sha256) 일치 · TTL 유효.
- apply 시각(23:33Z)은 프리매처 토큰 TTL(00:11Z) 및 재서명 토큰 TTL(00:20Z) 양쪽 창 이내.
- evidence log: `db-gate/_apply_evidence/runner_apply.log.jsonl` (guard=assertApplyGateForRunner, gated=true, lane=prod, sql_sha256 일치 — 단 go_issued_at 은 프리매처값 기록·§7 에서 재서명값으로 상신).

## 1. PRE-PROBE (apply 전, before-image 일치)
```
restrictive anon-deny count = 0
permissive anon-read residual = 2   (services.anon_service_read, package_tiers.anon_read_package_tiers 존치)
```
→ census 정본과 일치, drift 없음.

## 2. APPLY (prod COMMIT)
- `applyMigration` → `{applied:true, dryRun:false}` · ledger `supabase_migrations.schema_migrations` version=20260810180000 name=foot_rls_anon_permissive_seal 기록 확인.
- PREFLIGHT/VERIFY 내장 블록 무오류 통과(대상 실재·RLS ON·before-image 존치·restrictive 미존재 → 신설 후 restrictive=2 + permissive 존치).

## 3. POST-PROBE (structural)
```
restrictive anon-deny count = 2   (services_anon_deny, package_tiers_anon_deny · RESTRICTIVE · roles={anon} · USING/CHECK=false)
permissive anon-read residual = 2 (ADDITIVE 불변식 — DROP 0)
```

## 4. POST-PROBE (behavioral anon-role RLS · 무영속 rollback)
```
svc_total=141 ; pkg_total=6 (service_role BYPASSRLS 실 row — 빈테이블 아님 대조)
anon_svc=0 ; anon_pkg=0        (anon 롤 컨텍스트 SELECT → RESTRICTIVE 차단 실효)
→ 최종 RAISE(PROBE_ROLLBACK_OK) 로 트랜잭션 rollback (prod 무영속).
```

## 5. POSTCHECK (anon-key REST 실효 실측 — `scripts/T-20260810-...postcheck.mjs`)
```
[service_role totals] svc=141 pkg=6 wb=79 chk=0

── SEAL 대상 (anon count = 0 기대) ──
  services         status=200 anon_count=0 (range=*/0)      ← 141행 실재하나 anon 차단
  package_tiers    status=200 anon_count=0 (range=*/0)      ← 6행 실재하나 anon 차단

── HOLD 대상 (무접촉 회귀 가드) ──
  waiting_board    status=206 anon_count=79 (range=0-0/79)  ← 공개 대기현황판 보존(회귀 없음)
  checklists       status=200 anon_count=0 (range=*/0)      ← chk 총 0행(HOLD 무접촉·SECDEF RPC 소비자 무영향)

── 판정 ──
  SEAL anon-차단 실효 : PASS
  대조(빈테이블 아님)  : OK
  waiting_board 무접촉 : PASS
  ✅ POSTCHECK PASS
```

## 6. 무영향 재확인 (effective-authz superset 보존)
- authenticated read 정책(services_approved_read / package_tiers_approved_read/auth_read 등): POST-PROBE structural 상 전건 존치·무변경.
- service_role: BYPASSRLS → 무영향(svc=141/pkg=6 정상 read).
- SECURITY DEFINER RPC(fn_complete_prescreen_checklist 등): definer 컨텍스트 → 무영향.
- waiting_board anon read: anon_count=79 정상 → HOLD 무접촉 확인.

## 7. 재서명 GO-token 하 RATIFICATION 라운드 (2026-08-10 08:37~08:40 KST)
supervisor INFO(MSG-20260810-083605-8esa): 프리매처 토큰(08:26) provenance 불일치 → 08:35 재검증+재서명 supersede. dev-측 signer 선실행 금지 확인. 재서명 토큰 하 apply 지시(TTL 09:20 KST).

**상황 판정**: prod DDL 은 §2 에서 프리매처 토큰 하 **이미 물리 COMMIT 완료**(ledger 기록 + POSTCHECK PASS). up.sql PREFLIGHT 는 `restrictive anon-deny 이미 존재 시 재적용 abort`(멱등 가드) 이므로 재서명 토큰으로 `--apply` 재집행 = **불가능(abort)·불필요(이미 착지)**. → double-apply 대신 **재서명 토큰 하 ground-truth 재확인 + 게이트 재검증 + POSTCHECK 재실측으로 ratify**.

### 7-1. 재서명 GO-token 게이트 독립검증 (assertDbGateGo, 08:40 KST)
```
ok:true · sigVerify:pass (committed pubkey db-gate/keys/supervisor_dbgate_go_ed25519.pub.pem)
issued_at 2026-08-09T23:35:08.527Z · expires_at 2026-08-10T00:20:08.527Z (now<expires · TTL 유효)
migration_sha256 8f1f0375…d51a5 (적용된 up.sql 전문 == 토큰 바인딩 == 커밋 dc8af409 blob)
nonce b97e62291f386919 · key_id supv-dbgate-2026a
```
→ 재서명 토큰 = 정본 supervisor 서명 · 이미 착지한 prod DDL 과 동일 sha 바인딩 → prod end-state 를 **정당 인가로 ratify**.

### 7-2. prod ground-truth 재확인 (PRE-PROBE, read-only, 08:37 KST)
```
restrictive anon-deny count = 2   (services_anon_deny · package_tiers_anon_deny · RESTRICTIVE · roles={anon} · USING/CHECK=false)
permissive anon-read residual = 2 (anon_service_read · anon_read_package_tiers 존치 · ADDITIVE 불변식)
```
→ prod 실재 == supervisor 검증 DDL-diff end-state 정확 일치.

### 7-3. POSTCHECK 재실측 (anon-key REST 실효, 08:40:06 KST)
```
[service_role totals] svc=141 pkg=6 wb=79 chk=0
SEAL 대상 : services status=200 anon_count=0 · package_tiers status=200 anon_count=0   → 차단 실효(빈테이블 아님 대조 OK)
HOLD 대상 : waiting_board status=206 anon_count=79 (무접촉·회귀 없음) · checklists anon_count=0 (총 0행·HOLD 무접촉)
✅ POSTCHECK PASS
```

### 7-4. 잔여
- HOLD 2건(waiting_board·checklists) = 본 GO 범위 아님 → T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT (DA CONSULT) 대기 유지.
- 거버넌스 재발방지: 향후 GO-token 서명 실행은 supervisor 검증 완료 후 supervisor 단독 발행. dev 측 signer 선실행 금지(스크립트 준비/합의 sha 명시는 유효). 본 건 provenance 하자는 재서명 supersede + ratify 로 폐쇄.

## 결론
ADDITIVE RESTRICTIVE anon-deny(SUBSET 2/4: services + package_tiers) prod apply 완료(08:33) → **재서명(정본) GO-token 하 ratify 완료(08:40)**.
미인증(anon) READ 누수 봉쇄 실효 확인 + 비-anon principal superset 보존 + HOLD 2건 무접촉. double-apply 미집행(멱등).
supervisor 사후검증 라운드 요청 — 특히 발행순서 하자→재서명 supersede 경로의 provenance 폐쇄 확인.
