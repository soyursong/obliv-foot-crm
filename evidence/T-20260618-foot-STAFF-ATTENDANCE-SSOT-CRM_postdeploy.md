# T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM — PROD 배포 evidence (POST-DEPLOY CHECKLIST)

- DEPLOY-GO: MSG-20260718-012818-3rbk (supervisor DDL-diff 5-check GO, Green/ADDITIVE, commit `eb59fe60`)
- 집행: dev-foot / 2026-07-18 04:07~04:12 KST (self-execution)
- ref: rxlomoozakkjesdqjtvd (obliv-foot-crm prod)
- 집행 순서 준수: 테이블(20260618200000) 先 → cron(20260618201000) 後 → EF 배포+env → 수동 1틱 → 정합

## 0. PREFLIGHT (read-only, apply 직전 실재 재확인) — PASS ✅
`scripts/..._preflight.log`
- staff_attendance = ABSENT (null) · trigger_attendance_sync = 0 · cron foot-attendance-sync = 0 (대상 미존재 확인)
- clinics/staff/user_profiles 200 · get_vault_secret/net.http_post/pg_cron/gen_random_uuid live
- user_profiles 참조컬럼 5종(id,clinic_id,active,approved,role) 실재
- vault: supabase_project_url ✅ / internal_cron_secret ✅
- **⚠ clinics=2 (jongno-foot origin `74967aea…` + songdo-foot) → FOOT_CLINIC_ID env 주입 필수** (EF 단일-clinic fallback 은 2건이면 500). origin(오리진점=시트 소스)로 확정.

## POST-DEPLOY CHECKLIST (마이그 하단 6항목)

### [x] 1. 선행 테이블 `to_regclass('public.staff_attendance')` → `staff_attendance` (not null)
- 컬럼 9 (id,clinic_id,date,staff_id,source,status,synced_at,created_at,updated_at)
- 제약: PK + UNIQUE(clinic_id,date,staff_id) + FK×2(clinics/staff ON DELETE CASCADE) + CHECK×2(source/status)
- 인덱스 3 (clinic_date_idx + unique + pkey) · RLS ON · 정책 4 (select/insert/update/delete)
- 원장 기록: schema_migrations 20260618200000 (applyMigration 단일경로)

### [x] 2. 함수 `trigger_attendance_sync` 생성 (prosecdef=true, SECURITY DEFINER)

### [x] 3. cron 등록 `foot-attendance-sync` schedule=`*/15 * * * *` active=true
- 원장 기록: schema_migrations 20260618201000

### [x] 4. EF 배포 + env 주입
- `scripts/ef_deploy.sh attendance-sync --no-verify-jwt` → Deployed (script 69kB)
- env(secrets) 주입 4종: CRON_SECRET(=vault internal_cron_secret, len64) / DUTY_SHEET_ID / DUTY_SHEET_GIDS(341864863) / FOOT_CLINIC_ID(74967aea-a60b-4da3-a0e7-9c997a930bc8)
- **⚠ 게이트웨이 verify_jwt 갭 발견·수정**: attendance-sync 는 config.toml 블록 부재 → gateway 기본 verify_jwt=true → cron worker(X-Internal-Cron header-only, JWT 없음) 호출이 EF 코드 도달 전 401(`UNAUTHORIZED_NO_AUTH_HEADER`, 실측 net._http_response id 114269). → `[functions.attendance-sync] verify_jwt=false` 추가 + 재배포. 인증은 EF 내부 X-Internal-Cron==CRON_SECRET 단일 관문에 위임(redpay-reconcile 동일 컨벤션, unauth hole 없음).

### [x] 5. 수동 1틱 → EF 200 + staff_attendance rows>0
- **직접 EF 호출**(X-Internal-Cron only): HTTP 200 · `{ok:true, clinic_id:74967aea…, window:{back:1,forward:14,dates:16}, staff_active:28, inserted:170, updated:0, deleted:0, unmatched:[], errors:[]}`
- **pg worker 경로** `SELECT public.trigger_attendance_sync()` → `{ok:true, run_at:2026-07-17 19:11:36 UTC}` → net._http_response id 114271 **status_code 200, ok=true**, inserted=0(멱등 재적재 무해). = pg_cron→net.http_post→EF 200 end-to-end 확인.

### [x] 6. 정합(AC-5) — 오늘 present 카운트 ↔ 시트 라이브
- staff_attendance total 170 (전부 source=google_sheet)
- **오늘(2026-07-18 KST) present = 9** (김규리·김지혜·박민석·서은정·송지현·엄경은·임별·최다혜·최민지)
- EF reconcile **unmatched=0 / errors=0** → 시트 매칭 출근자 = DB present (불변식). 시트 '오늘 출근자' ↔ DB present = 9 ↔ 9 정합.
- 창 [today-1, today+14] 16일 present 분포: 07-17=13 / 07-18=9 / 07-20=11 … 08-01=10 (2026-07-19·26 시트 미기재=휴무일 정상).

## AC-4 회귀금지 — PASS (현 단계)
- 배정화면 '출근 N명' + 자동배정 후보풀은 **여전히 시트 직접 read(`fetchTodayWorkingStaffIds`→`fetchTodayAttendeeNames`)** 유지. 본 배포는 테이블/EF/cron 신설(소비처 0) → **런타임 동작 변경 0**. Handover·배정로직·자동배정 무접촉.

## 잔여 — AC-2 배정화면 read-swap (HELD)
- 시트 직접 read → staff_attendance read 전환은 **미착수(HOLD)**. 근거:
  1. 티켓 §10.4 = "**freshness 안정 확인 후** AC-2" — sync 는 방금 live(1틱), 다틱 안정성 관측 전.
  2. AC-2 는 배정화면(자동배정 후보풀 = 회귀 핵심지점)의 **런타임 동작 변경** → DDL-diff 5-check 범위 밖 + `db-only-additive` E2E 면제 무효화(E2E spec 신규 필요) → supervisor QA 별도 게이트.
- → planner FOLLOWUP 발행(시퀀싱: freshness soak 후 AC-2 read-swap 별 티켓/단계 + E2E spec + supervisor QA).
