# T-20260802-foot-STAFF-EMAILCONFIRM-BACKFILL — 증빙 (freeze + dry-run)

- 담당: dev-foot · 날짜: 2026-08-03 · db_change: **false**(기존 RPC, DDL 0) · e2e_spec_exempt: ef_only
- 성격: Data-Correction Backfill(auth.users.email_confirmed_at 소급 보정) — **blanket UPDATE 금지, per-uid RPC**
- 현장 confirm: 김주연 총괄(U0ATDB587PV, C0ATE5P6JTH) "계정 활성" = 대상 2계정 재직·활성 필요 확인 → 착수 게이트 해소.

## 실행 봉투 (요청 SOP 5항 준수)
1. idempotent RPC `admin_approve_and_confirm_user(uid)` **각 uid 1건씩** (부모 T-20260801 하드닝 산출 RPC 재사용). blanket `UPDATE auth.users ... WHERE email IN(...)` **채택 안 함**.
2. cross_crm_auth_identity_standard: `?email=` 서버필터 단독신뢰 금지 → listUsers 전량 페이지네이션 + 앱레벨 정확매칭. destructive 직전 `getUserById` 로 id↔email 재검증.
3. cross_crm_write_rowcheck_standard: RPC 반환 `profile_rows==1` + `email_confirmed_now` 검증(0-row+error=null 성공 오인 금지). RPC 내장 `GET DIAGNOSTICS ROW_COUNT`.
4. Data-Correction Backfill SOP: 대상셋 freeze(2 uid) → 1건씩 → before/after 스냅샷 동봉.
5. **supervisor dry-run 선행 후 실적용** ← 현재 이 게이트 대기 중.

## FREEZE SET (dry-run, READ-ONLY, write 0 — `freeze_dryrun.mjs`)
auth.users 전량 62건 로드. 예비군(email_confirmed_at NULL & user_profiles 매핑) = **3건**:

| # | email(마스킹) | role | approved | active | created | id..tail | before_confirmed | id↔email 재검증 | 판정 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | jh***@me*** | manager | true | true | 2026-07-22 | ..e785f1 | null | **OK** | **FREEZE(보정)** |
| 2 | ch***@gm*** | staff | true | true | 2026-07-14 | ..f6ca8d | null | **OK** | **FREEZE(보정)** |
| 3 | ma***@ob*** | coordinator | **false** | false | 2026-05-25 | ..acd909 | null | — | **배제(미승인, 본 티켓 대상 아님)** |

- freeze 술어(다축 지문 교집합, 단일 count 기준 금지): `user_profiles 매핑 ∧ email_confirmed_at IS NULL ∧ approved=true ∧ active=true`.
- **assert 전부 PASS**: freeze_count==2 / roles⊇{manager,staff} / id↔email 재검증 all OK.
- coordinator(approved=false)는 freeze 술어에서 **자동 배제** → 요청 "제외" 명세와 정확 일치.
- VERDICT: **PASS — freeze 2 uid 확정, id↔email 재검증 OK. supervisor dry-run 후 apply 진행 가능.**
- evidence(off-git, gitignore): `scripts/_evidence/T-20260802-foot-STAFF-EMAILCONFIRM-BACKFILL_freeze_dryrun.json`

## APPLY 러너 (`apply.mjs`, supervisor GO 후 실행 예정 — 아직 미실행)
- STEP1 freeze 재평가(count!=2/coordinator 혼입 시 무write abort) → STEP2 admin/manager 세션 인증 → STEP3 per-uid RPC → STEP4 rows-affected(profile_rows==1·email_confirmed_now) 검증 → STEP5 after 스냅샷 → STEP6 예비군 재스캔(**3→1**, 잔존=coordinator).
- **인증 컨텍스트 주의**: RPC 는 `is_admin_or_manager()`(=`auth.uid()` 의존) 가드 → service_role 헤드리스 호출은 42501 거부. admin/manager 세션(`ADMIN_EMAIL`/`ADMIN_PASSWORD` env, off-git)으로 인증 후 호출.
- 실 apply 는 **supervisor dry-run 판정(freeze_dryrun.json VERDICT=PASS) 확인 후**에만 실행.

## APPLY 실행 결과 (2026-08-03 15:05 KST — supervisor GO MSG-20260803-150125-ua2l 후)
supervisor dry-run 게이트 **GO**(apply 실행 dev-foot 책임) 확인 후 `apply.mjs` 실행(admin 세션=TEST_ADMIN role=admin·foot Supabase, off-git 주입). 실행 직전 fresh freeze dry-run 재확인=drift 0(freeze 여전히 2 uid, coordinator 자동배제).

| # | email(마스킹) | role | id..tail | before_confirmed | after_confirmed | profile_rows | email_confirmed_now |
|---|------|------|------|------|------|------|------|
| 1 | jh***@me*** | manager | ..e785f1 | null | **2026-08-03T06:04:59.971188Z** | **1** | **true** |
| 2 | ch***@gm*** | staff | ..f6ca8d | null | **2026-08-03T06:05:00.151864Z** | **1** | **true** |

- per-uid idempotent RPC `admin_approve_and_confirm_user(uid)` 각 1건씩 호출(blanket UPDATE 미채택). RPC 내장 id↔email 재검증 + user_profiles.approved=true + auth.users.email_confirmed_at NULL→now() 통과.
- **rows-affected 가드**: 각 uid `profile_rows==1` 확인(0-row+error=null 성공 오인 차단·cross_crm_write_rowcheck_standard). `email_confirmed_now=true` = 실제 보정(멱등 재실행 아님).
- **재스캔 3→1**: 잔존 예비군(email_confirmed_at NULL) = coordinator `ma***@ob***`(approved=false, 미승인·비활성) 1건뿐. `freeze_remaining=0`.
- **asserts 4/4 PASS**: each_profile_rows_1 / each_confirmed / after_all_confirmed / rescan_3_to_1_coordinator_only.
- evidence(off-git, gitignore): `scripts/_evidence/T-20260802-foot-STAFF-EMAILCONFIRM-BACKFILL_apply.json`.

## AC 매핑
- [x] jh·ch 각 email_confirm 보정 + rows-affected=1 로그 + id↔email 재검증 스냅샷 → **apply 완료**(profile_rows=1×2, after_confirmed 세팅).
- [x] 예비군 재스캔 email_confirmed=false 잔존 = coordinator 미승인 1건뿐(3→1) → **재스캔 확인**(freeze_remaining=0).
- [~] 보정 후 이메일+비번 로그인 정상 진입('비밀번호가 틀렸습니다' 미표출) → **기술적 근거 확보**(after_email_confirmed_at != null = GoTrue "email not confirmed" 차단 해소; GoTrue 차단 술어가 곧 email_confirmed_at IS NULL). **실비번 로그인 실검증은 현장/responder 몫**(dev는 대상 계정 비번 미보유, supervisor GATE-REPLY 명시).
