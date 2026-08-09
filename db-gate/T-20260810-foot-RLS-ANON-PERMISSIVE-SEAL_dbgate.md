# DB-GATE 패키지 — T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL

- **레포**: obliv-foot-crm (foot / clinics=2 LIVE) · **prod ref**: rxlomoozakkjesdqjtvd
- **db_change**: true · **change-class**: ADDITIVE (CREATE POLICY x2, permissive DROP 0, 데이터 mutation 0)
- **작성**: dev-foot / 2026-08-10 · **status**: APPLIED + RATIFIED (재서명 GO-token 정본 하)
- **apply evidence**: `applied_at`=2026-08-10 08:33 KST · `ratified_at`=08:40 KST · `go_token_path`=`db-gate/T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL_GO.token.{json,sig}` (재서명 정본, nonce `b97e62291f386919`) · `go_issued_at`=`2026-08-09T23:35:08.527Z` · `apply_ts`=`2026-08-09T23:33Z` · `sql_sha256`=`8f1f037599fd90b3efe0e55c7d1f249d32d33b26e760bb21858ae30d8fed51a5` · 상세=`_apply_evidence.md` §7. ⚠ 프리매처 토큰(nonce `7602dac7`) provenance 하자 → 재서명 supersede.
- **배경**: umbrella FORKINHERIT-SWEEP Stage-3 fan-out(anon 서브셋). DA INFO(tkv8): anon-도달 노출 = 미인증 누수 → 즉시 봉쇄.

## 0. 게이트 순서 (db_change=true — 하드)
`dry-run(무영속)` ✅ → `DDL-diff`(본 문서) → **supervisor DB-GATE GO-token** ⛔대기 → `apply(--apply)` → `POSTCHECK(anon 세션 실효 실측)`.
Gate-B(DA) GO ≠ apply 허가. GO-token(.json+.sig) 발행 후에만 prod DDL COMMIT.

## 1. ★재-census + 정당 anon 경로 검증 (하드규율 · 파괴위험 높음 · 본 티켓 make-or-break)

### 1-1. prod census (Management API, 2026-08-10) — anon-도달 READ 정책 4테이블
| 테이블 | anon 정책 | cmd | roles | qual |
|--------|-----------|-----|-------|------|
| services | anon_service_read | SELECT | {anon} | true |
| package_tiers | anon_read_package_tiers | SELECT | {anon} | true |
| waiting_board | waiting_board_select | SELECT | {anon,authenticated} | true |
| checklists | anon_checklist_read (+anon_checklist_write INSERT) | SELECT | {anon} | true |

table-level grants: 4테이블 모두 anon=`REFERENCES,SELECT,TRIGGER`, authenticated=full. RLS = 4테이블 전부 ENABLE.

### 1-2. FE/prod 정당 anon 소비자 실측 (전수 census — 전 anon-client + 전 public route)
- **anon-client 파일**: `src/lib/supabase.ts`(authed·persistSession), `TabletChecklistPage.tsx`, `Waiting.tsx`, `HealthQMobilePage.tsx`.
- **public(비가드) route**: `/checklist/:checkInId`, `/waiting/:clinicSlug`, `/health-q/:token`, `/attendance/punch`, `/attendance/kiosk/:slug`.

| 테이블 | 정당 anon 소비자 | 근거 | 판정 |
|--------|------------------|------|------|
| **services** | **0** | 전 public route 미read. `.from('services')`=전량 /admin authed. | **SEAL** (미인증 누수 확정) |
| **package_tiers** | **0** | `src/` 전체 참조 0건 (dead grant). | **SEAL** (미인증 누수 확정·dead) |
| **waiting_board** | **1 (READ)** | `Waiting.tsx:120` `anonClient.from('waiting_board').select` + `:152` realtime — 공개 대기현황판 `/waiting/:slug` (PII는 DB projection 선-마스킹). | **HOLD + DA CONSULT** |
| **checklists** | **1 (WRITE via SECDEF)** | `TabletChecklistPage.tsx:418` `anonClient.rpc('fn_complete_prescreen_checklist')` — **prosecdef=true**(RLS-immune). 직접 `.from('checklists')` read/write 소비자 **0**. `.from()`=`documents`(storage)뿐. PHI 테이블. | **HOLD + DA CONSULT** |

**⇒ 봉쇄 SUBSET(본 티켓) = services + package_tiers.** waiting_board + checklists = HOLD (FOLLOWUP → planner/DA CONSULT).

> ⚠ 재-census 가 티켓 가설을 **역전**: 티켓은 services/package_tiers 를 "공개 예약/랜딩 정당 anon read 개연 높음"으로 예측했으나, foot 은 공개 예약/랜딩 부재 → 오히려 이 둘이 소비자 0 확정 누수. 정당 anon 경로는 waiting_board(read)·checklists(SECDEF write) 였음. → 하드규율 재-census 가 정확히 파괴 회피.

## 2. DDL-diff (net effect)
```
+ CREATE POLICY "services_anon_deny"      ON public.services      AS RESTRICTIVE FOR ALL TO anon USING(false) WITH CHECK(false);
+ CREATE POLICY "package_tiers_anon_deny" ON public.package_tiers AS RESTRICTIVE FOR ALL TO anon USING(false) WITH CHECK(false);
  (+ COMMENT ON POLICY x2)
```
- **DROP 0 · ALTER 0 · 데이터 write 0 · 신규 컬럼/타입/enum/테이블 0.** 순수 additive restrictive.
- **의미**: anon SELECT = permissive(true) AND restrictive(false) = **false → 차단**. authenticated=TO anon 미포함→무영향. service_role=BYPASSRLS→무영향. SECURITY DEFINER 함수=definer 컨텍스트→무영향.
- **rollback**: `DROP POLICY ... services_anon_deny; DROP POLICY ... package_tiers_anon_deny;` (1줄/테이블, before-image 완전 복귀).

## 3. dry-run (무영속) — PASS
`node supabase/migrations/20260810180000_foot_rls_anon_permissive_seal.dryrun.mjs`
- txn-control stripped: (none) · plpgsql exception-rollback 경유 실행.
- post-probe: (a)services_anon_deny 부재 ✅ (b)package_tiers_anon_deny 부재 ✅ (c)anon_service_read 존치 ✅ (d)anon_read_package_tiers 존치 ✅ → **무영속 PASS**.
- PREFLIGHT(대상 실재·RLS ON·before-image 존치·restrictive 미존재) + VERIFY(restrictive 2 + permissive 존치) 블록 무오류 실행.

## 4. PRE-PROBE (현재 prod 상태, 무변경)
`node scripts/apply_20260810180000_foot_rls_anon_permissive_seal.mjs` → restrictive anon-deny=0, permissive anon-read=2 (before-image 일치).

## 5. supervisor 검증 요청 (DB-GATE)
1. DDL-diff 재확인(§2) — additive restrictive only, DROP/데이터 0.
2. effective-authz superset 확인: apply 후 authenticated read 정책(services_approved_read 등)·SECDEF RPC·waiting_board anon read **무영향** 이어야 함(behavioral probe = apply 스크립트 POST-PROBE + postcheck).
3. GO-token 발행 → `db-gate/T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL_GO.token.{json,sig}`.
4. dev-foot 가 `--apply` 실행 → POSTCHECK(anon-key REST 실효) 증적 첨부.

## 6. 산출물
- migration: `supabase/migrations/20260810180000_foot_rls_anon_permissive_seal.sql` (+.rollback.sql, +.dryrun.mjs)
- apply(GO-token 게이트): `scripts/apply_20260810180000_foot_rls_anon_permissive_seal.mjs`
- postcheck: `scripts/T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL_postcheck.mjs`
