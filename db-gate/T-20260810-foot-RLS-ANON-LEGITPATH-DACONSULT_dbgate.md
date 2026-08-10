# DB-GATE 패키지 — T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT

- **레포**: obliv-foot-crm (foot / clinics LIVE) · **prod ref**: rxlomoozakkjesdqjtvd
- **db_change**: true · **change-class**: ADDITIVE (CREATE POLICY x2, permissive DROP 0, 데이터 mutation 0)
- **작성**: dev-foot / 2026-08-10 · **status**: GO-token 대기 (apply_before_go 금지, C20/C24)
- **DA CONSULT-REPLY**: MSG-20260810-091617-dnlg · **SSOT**: `agents/docs/da_replies/da_decision_foot_rls_anon_legitpath_wb_checklists_20260810.md`
- **자매**: T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL(services·package_tiers·deployed) — 본 티켓은 그 HOLD 2건 中 checklists 착수분.

## 0. 게이트 순서 (db_change=true — 하드)
`dry-run(무영속)` ✅ → `DDL-diff`(본 문서) → **supervisor DB-GATE GO-token** ⛔대기 → `apply(--apply)` → `POSTCHECK(anon 세션 실효 + SECDEF 회귀0 실측)`.
Gate-B(DA) GO ≠ apply 허가. GO-token(.json+.sig) 발행 후에만 prod DDL COMMIT.

## 1. DA 판정 요약 (2건 中 checklists 만 착수)
- **waiting_board = 봉쇄 NO-GO · action 0**: anon-read = CANONICAL(§16-3a zero-PII projection · mask_display_name write-time 마스킹 완비). 마이그/재설계 0, 현상유지. (soft non-blocking: mask_display_name 무회귀 유지 · PHI 컬럼 추가 시 재판정.)
- **checklists = 봉쇄 GO(조건부)**: 직접 anon 정책 2종(`anon_checklist_read`·`anon_checklist_write`) = 미인증 PHI read+write 누수. SECDEF `fn_complete_prescreen_checklist`(owner=postgres·prosecdef=true·relforcerowsecurity=false)가 RLS 전면 우회 → 직접정책 봉쇄 = RPC 경로 영향 0(수학적 독립·CONFIRMED). 셀프체크인 write 무회귀.

## 2. ★재-census (PRE-SEAL FE 증거 · DA C3 · 하드규율)

### 2-1. prod census (Management API, DA §1-B, 2026-08-10) — checklists 정책
| 정책 | cmd | permissive | roles | qual / with_check | 처리 |
|------|-----|-----------|-------|-------------------|------|
| anon_checklist_read | SELECT | PERMISSIVE | {anon} | USING true | **봉쇄 대상**(존치 + RESTRICTIVE AND-차단) |
| anon_checklist_write | INSERT | PERMISSIVE | {anon} | WITH CHECK true | **봉쇄 대상**(존치 + RESTRICTIVE AND-차단) |
| auth_users_all | ALL | PERMISSIVE | {authenticated} | true | **무접촉(C2)** |
| checklists_admin_all | ALL | PERMISSIVE | {authenticated} | — | **무접촉(C2)** |
| checklists_approved_read | SELECT | PERMISSIVE | {authenticated} | — | **무접촉(C2)** |
| checklists_consult_update | UPDATE | PERMISSIVE | {authenticated} | — | **무접촉(C2)** |
| checklists_coord_insert | INSERT | PERMISSIVE | {authenticated} | — | **무접촉(C2)** |
| checklists_coord_update | UPDATE | PERMISSIVE | {authenticated} | — | **무접촉(C2)** |

- SECDEF `fn_complete_prescreen_checklist`: owner=postgres · prosecdef=true · search_path="" · EXECUTE anon 보존. RLS enabled=true · force=false.

### 2-2. FE/prod 정당 anon 소비자 실측 (dev-foot 재확인 — grep + built bundle, 2026-08-10)
- **anon-client(anon-key) 참조처**: `TabletChecklistPage.tsx`(셀프체크인), `HealthQMobilePage.tsx`. 두 파일 공히 `anonClient.rpc(...)` 만 호출.
  - `grep 'anonClient\.\(from\|rpc\)('` 결과 = TabletChecklistPage(fn_prescreen_start / fn_complete_prescreen_checklist), HealthQMobilePage(fn_health_q_*). **`anonClient.from('checklists')` = 0건(read+write 공히).**
- **`.from('checklists')` 실참조 3건 = 전부 authed client(`supabase`)**: `Dashboard.tsx:4301`(select), `CustomerChartPage.tsx:3326`(select), `CustomerChartPage.tsx:10453`(select). → authenticated 정책 6종 소관(C2 무접촉).

| 대상 | 직접 anon 소비자 | 근거 | 판정 |
|------|------------------|------|------|
| **checklists (read)** | **0** | 전 anon-client 미 `.from('checklists').select`. 셀프체크인 완료 여부 확인도 SECDEF RPC 반환값 경유. | **SEAL** (read-back 부재 → SECDEF read RPC 전환 불요) |
| **checklists (write)** | **0 (via SECDEF)** | 셀프체크인 INSERT = 전량 `fn_complete_prescreen_checklist`(prosecdef=true·RLS-immune). | **SEAL** (SECDEF 독립·무회귀) |

**⇒ C3 충족**: 직접 anon `.from('checklists')` read+write 소비자 0. read-back 부재.

## 3. DDL-diff (net effect)
```
+ CREATE POLICY "checklists_anon_read_deny"  ON public.checklists AS RESTRICTIVE FOR SELECT TO anon USING(false);
+ CREATE POLICY "checklists_anon_write_deny" ON public.checklists AS RESTRICTIVE FOR INSERT TO anon WITH CHECK(false);
  (+ COMMENT ON POLICY x2)
```
- **DROP 0 · ALTER 0 · 데이터 write 0 · 신규 컬럼/타입/enum/테이블 0.** 순수 additive restrictive.
- **정책 shape = DA §3-B primary(RESTRICTIVE anon-deny · USING false / WITH CHECK false · roles={anon}) · 자매 SEAL mig 20260810180000 및 umbrella §A batch-uniform.**
- **rollback = DROP restrictive x2** (DA §3-B / line 59 명시): 두 permissive 직접정책(read=SELECT · write=INSERT)에 1:1 대응하는 per-verb 봉쇄로 分割 → C5 read+write 실효 검증이 정책과 1:1 매핑. anon 은 UPDATE/DELETE permissive 부재 → per-verb(SELECT+INSERT) 봉쇄로 현 누수 2종 완전 차단(잔여 verb 는 default-deny). rollback = `DROP POLICY checklists_anon_read_deny; DROP POLICY checklists_anon_write_deny;`.
- **의미**: anon SELECT = permissive(true) AND restrictive(false) = **false → read 차단**. anon INSERT = true AND false = **false → write 차단**. authenticated=TO anon 미포함→무영향(6종 존치). service_role=BYPASSRLS→무영향. SECDEF(owner=postgres)=definer 컨텍스트→무영향(셀프체크인 write 무회귀).

## 4. HARD 조건 이행 (DA C1~C5)
- **C1 SECDEF 독립 보존**: `fn_complete_prescreen_checklist` grant/owner/prosecdef **무접촉**(마이그 read-only 확인만). UP PREFLIGHT(prosecdef=true 전제) + VERIFY(prosecdef=true 무변형) + apply POST-PROBE(has_function_privilege anon EXECUTE=t · owner=postgres). ✅
- **C2 anon-only 스코프**: RESTRICTIVE 대상 = roles={anon} 전용(VERIFY: `roles::text='{anon}'`). authenticated 6종 무접촉(PREFLIGHT count=6 + VERIFY count=6). restrictive 롤 PUBLIC/ALL 금지 준수. ✅
- **C3 PRE-SEAL FE census**: §2-2 — 직접 anon `.from('checklists')` read+write 0(grep + bundle). read-back 부재. ✅
- **C4 멱등 PREFLIGHT + 대칭 rollback + dry-run 무영속**: PREFLIGHT(restrictive 기존재 abort) + rollback DROP x2(대칭) + dryrun.mjs(txn-control strip · post-probe a~f) — §5. ✅
- **C5 POSTCHECK(apply 후)**: `scripts/T-...-DACONSULT_postcheck.mjs` — anon-key REST: checklists read=0 + 직접 write 차단·미영속 + SECDEF RPC(비존재 check_in→check_in_not_found·zero-write) 회귀0 + waiting_board(HOLD) 무접촉.

## 5. dry-run (무영속) — [실행 결과 첨부]
`node supabase/migrations/20260810190000_foot_rls_anon_checklists_seal.dryrun.mjs`
- txn-control stripped: (none) · plpgsql exception-rollback 경유 실행.
- post-probe: (a)checklists_anon_read_deny 부재 (b)checklists_anon_write_deny 부재 (c)anon_checklist_read 존치 (d)anon_checklist_write 존치 (e)authed 6종 존치 (f)SECDEF prosecdef=true 무접촉 → **무영속 PASS**.
- PREFLIGHT(대상 실재·RLS ON·before-image 존치·authed 6·SECDEF 전제·restrictive 미존재) + VERIFY(restrictive 2·permissive 존치·authed 6·SECDEF 무변형) 무오류 실행.

## 6. supervisor 검증 요청 (DB-GATE)
1. DDL-diff 재확인(§3) — additive restrictive only, DROP/데이터 0, roles={anon} 전용.
2. effective-authz 확인: apply 후 authenticated read/write 정책 6종 · SECDEF RPC(anon EXECUTE) · waiting_board anon read **무영향**(apply POST-PROBE structural+behavioral + postcheck).
3. GO-token 발행 → `db-gate/T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT_GO.token.{json,sig}`.
4. dev-foot 가 `--apply` 실행 → POSTCHECK(anon-key REST 실효 + SECDEF 회귀0) 증적 첨부.

## 7. 산출물
- migration: `supabase/migrations/20260810190000_foot_rls_anon_checklists_seal.sql` (+.rollback.sql, +.dryrun.mjs)
- apply(GO-token 게이트): `scripts/apply_20260810190000_foot_rls_anon_checklists_seal.mjs`
- postcheck: `scripts/T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT_postcheck.mjs`
