# APPLY EVIDENCE — T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL

- **레포**: obliv-foot-crm (foot / clinics=2 LIVE) · **prod ref**: rxlomoozakkjesdqjtvd
- **change-class**: ADDITIVE (CREATE POLICY x2 RESTRICTIVE anon-deny · permissive DROP 0 · 데이터 mutation 0)
- **applied_at**: 2026-08-10 08:33 KST (2026-08-09T23:33Z)
- **applied_by**: dev-foot (gated apply runner)
- **migration**: `supabase/migrations/20260810180000_foot_rls_anon_permissive_seal.sql`
- **sha256**: `8f1f037599fd90b3efe0e55c7d1f249d32d33b26e760bb21858ae30d8fed51a5`

## 0. GO-token 게이트 (통과)
- token: `db-gate/T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL_GO.token.{json,sig}` (supervisor, key_id=supv-dbgate-2026a, nonce=7602dac7c54105b6)
- issued_at `2026-08-09T23:26:21.336Z` · expires_at `2026-08-10T00:11:21.336Z` (TTL 45m)
- **apply 시각(23:33Z) < 만료(00:11Z)** — TTL 준수. `sigVerify:pass` · content-binding sha256 일치 · targetRef=rxlomoozakkjesdqjtvd 일치.
- evidence log: `db-gate/_apply_evidence/runner_apply.log.jsonl` (guard=assertApplyGateForRunner, gated=true, lane=prod, sql_sha256 일치).

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

## 결론
ADDITIVE RESTRICTIVE anon-deny(SUBSET 2/4: services + package_tiers) prod apply 완료.
미인증(anon) READ 누수 봉쇄 실효 확인 + 비-anon principal superset 보존 + HOLD 2건 무접촉.
supervisor 사후검증 라운드 요청.
