# T-20260822-foot-HERALD-PHANTOM-CENSUS — 근인 census 결과

- 도메인: foot (obliv-foot-crm) · P0 · db_change=false · e2e_exempt(feasibility_inquiry)
- 근거: CEO 갭분석 cause A, MSG-20260822-160222-v7pe
- GATE: **Phase A(본 문서·census)=READ-ONLY**. Phase B(정정 재발행)=supervisor 게이트(CEO 명시).
- auth-context: prod 실측 leg(census 스크립트)는 **Supabase Management API = postgres 슈퍼유저(RLS 미적용)** 로 실행. 이 코드리포 세션에는 PAT/service_role 미보유 → 실측 leg 는 supervisor/DB-gate 컨텍스트에서 `scripts/T-20260822-foot-HERALD-PHANTOM-CENSUS_readonly.mjs` 로 실행.

---

## AC-1 — 근인(진원) 규명: E2E/테스트 write 의 prod 마감 outbox 유입 (코드 확정)

### 팬텀 메커니즘 (코드 트레이스로 확정)
1. `daily_closings` 에 `status='closed'` INSERT/UPDATE(open→closed) 시 AFTER 트리거
   `trg_enqueue_closing_confirmed` → `enqueue_closing_confirmed()`(SECURITY DEFINER) 발화.
   (정의: `supabase/migrations/20260804200000_foot_closing_reemit_supersede_fix.sql`)
2. 트리거가 `closing_confirmed_outbox` 에 `(clinic_id, close_date, revision)` 행 INSERT,
   `ON CONFLICT (clinic_id, close_date, revision) DO NOTHING` (= **정당 멱등, 결함 아님**).
3. `tests/e2e/critical-flow/CF-5-daily-closing.spec.ts` 가 **prod 로 write** 하면:
   - `payments.amount=80000, method='card'` (L39-48)
   - `daily_closings` INSERT: `single_card_total=80000, actual_card_total=80000, status='closed', memo='CF-5 자동 마감 spec'` (L51-72)
   - → rev0 outbox 슬롯을 **선점**.
4. 실 EOD 마감(같은 날, rev0)이 도착해도 `ON CONFLICT DO NOTHING` 으로 **silent-drop**
   → 리더 RPC `read_closing_confirmed_events`(`WHERE dlq=false AND COALESCE(superseded,false)=false`)가
   팬텀 rev0(card=80,000)를 **가시본으로 노출** → 마감전령이 '수납 80,000원' 확정 발송.

### 진원 = 테스트(E2E)의 prod-write (auth context = service_role)
- CF-5 는 `SUPABASE_SERVICE_ROLE_KEY`(L23)로 client 생성 → **service_role = RLS 무관**하게 write.
  즉 anon RLS 로는 막히지 않는 축. 진원은 "누가 RLS 를 뚫었나"가 아니라 "테스트가 prod DB 를
  타겟했나"의 문제.
- 시그니처: `card=80000 · rev0 · memo='CF-5 자동 마감 spec'` = **scalp2 CF-5 phantom 과 동형**.
  ticket 배경의 "card=80000·rev0" 시그니처와 정확히 일치.
- 08-09 발생 시점(2026-08-09)은 CF-5 write-ban(T-20260812-meta, 08-12 적용)의 **선행 사고**.
  즉 08-09 팬텀은 write-ban 이 봉인하기 전 마지막 유출로 정합. (실측 확정 = census 스크립트 §AC-1)

### 실측 확정 절차 (supervisor/DB-gate)
`SUPABASE_ACCESS_TOKEN=<PAT> node scripts/T-20260822-foot-HERALD-PHANTOM-CENSUS_readonly.mjs`
- §AC-1: 08-08~08-10 `daily_closings` + `closing_confirmed_outbox` 실측 → 08-09 rev0 card=80,000
  memo='CF-5 자동 마감 spec' 존재 여부 + 전후일(08-08/08-10) 30M+ 대비 발산 확정.

---

## AC-2 — CF-5 write-ban(T-20260812-meta) 의 foot outbox emit 경로 커버리지

### 결론: **foot 은 이미 커버됨** (dev-meta 티켓 spin 불요 — 1차 벡터 기준)
- `tests/e2e/critical-flow/_prodWriteGuard.ts` 가 **foot 리포에 정본 이식 완료**:
  - `KNOWN_PROD_REFS` 에 foot prod ref(`rxlomoozakkjesdqjtvd`) 포함 + 형제 CRM prod ref 전건 포함
    (cross-wired secret 오배선까지 fail-closed).
  - `assertCriticalFlowDbSafe()` = **UNCONDITIONAL** fail-closed (EXPECT_DEV_DB_REF opt-in 과 무관).
  - 가드된 `createClient` drop-in 팩토리 = client 생성 이전 PROD-target 차단.
- `CF-5-daily-closing.spec.ts` 가 가드 모듈에서 import + `test.beforeAll(assertCriticalFlowDbSafe)`
  primary 게이트 보유(어떤 시더보다 먼저 발화).
- `_prod-write-ban-invariant.spec.ts` 가 **정적 불변식**으로 강제: critical-flow 의 어떤 spec 도
  `@supabase/supabase-js` 에서 `createClient` 직접 import 금지 + CF DB-write spec 은 가드 import +
  primary beforeAll 게이트 보유. → 미래 신규 CF spec 의 우회 재발을 정적 차단.
- **08-09 팬텀의 정확한 벡터(memo='CF-5 자동 마감 spec' = CF-5 = critical-flow)는 이 UNCONDITIONAL
  가드로 완전 봉인됨.** = AC-2 primary 커버리지 GO.

### 잔존 커버리지 격차 (census honesty — silent cap 금지)
write-ban 불변식은 **`tests/e2e/critical-flow/` 디렉터리로 스코프**된다. 루트(`tests/e2e/`)의 마감
계열 spec 들은 `daily_closings`/`closing_confirmed_outbox` 를 write 하지만 UNCONDITIONAL 가드가 아니라
**fixtures 의 opt-in `PRODREF-HARDGUARD`**(`tests/fixtures/index.ts` L106-132, `EXPECT_DEV_DB_REF`
주입 시에만 활성)에 의존한다. 해당 spec:
- `tests/e2e/T-20260718-foot-CLOSING-HERALD-PORT-GOLDEN.spec.ts` (outbox write)
- `tests/e2e/T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE.spec.ts` (outbox write)
- 그 외 daily_closings write: `T-20260530-CLOSING-TRANSFER-ROW`, `T-20260611-DAILY-CLOSINGS-READ-OVEROPEN`,
  `T-20260805-DAYCLOSE-PAYHIST-PACKAGE-MISSING`, `T-2026082x-CLOSING-*` 계열.

**함의**: dev-DB 컷오버가 CI/로컬에 `EXPECT_DEV_DB_REF` 를 주입하기 전까지는, 위 루트 spec 들이
이론상 팬텀을 재유입할 수 있는 경로가 남아있음(단, 08-09 실사고 벡터 CF-5 는 이미 봉인).

**권고(FOLLOWUP, 본 census 의 블로커 아님)**: planner 경유 dev-meta 확인 —
(a) dev-DB 컷오버(`EXPECT_DEV_DB_REF` 주입) 진행 상태, 또는
(b) UNCONDITIONAL 가드(`assertCriticalFlowDbSafe` 동형)를 `tests/fixtures/index.ts` svc() 경로로
    확장해 루트 마감 spec 까지 무조건 봉인. → 미커버 판정 시 dev-meta 티켓 spin.

---

## AC-3 — 08-01~08-22 foot 마감전령 팬텀 잔존 전수 census

- 코드 술어는 확정(스크립트 §AC-3 3쿼리):
  1. `daily_closings` 팬텀 시그니처(memo CF-5/spec/자동마감 OR card=80000·단독) 전수.
  2. 리더-가시본(`superseded=false`) outbox 中 소액(<1,000,000) = 전후일 30M+ 대비 발산 = 팬텀 의심.
  3. 08-09 시그니처 직접 매칭(card=80000·rev0).
- **실측(행 열거)은 prod PAT 필요** → supervisor/DB-gate 실행. 본 세션(코드리포)은 자격 미보유.
  실측 결과는 이 문서 §AC-3 실측표로 첨부(supervisor).

---

## AC-4 — 정정 재발행 (supervisor 게이트 · dev 는 payload 준비까지)

### 정정 경로 (기존 자산 재사용, 신규 파괴 write 0)
팬텀 rev0 을 **직접 UPDATE/DELETE 하지 않는다**(우회 금지). 정당 경로:
1. 실 08-09 마감 `daily_closings` 행을 `closing_confirmed_edit` RPC(`20260802160001`)로 재확정
   → `revision`+1 → `daily_closing_confirm_guard` 가 rev 확정 → AFTER 트리거 `enqueue_closing_confirmed`
   가 **정정 rev1** outbox 행 INSERT(정상 총액) + `revision < NEW.revision` 구 rev0(팬텀) 을
   `superseded=true` 로 UPDATE(supersede 방향 정상화, 20260804200000 fix 반영본).
   → 리더가 정정 rev1 을 가시본으로 읽음, 팬텀 rev0 은 superseded 로 은닉.
2. 재emit 배치는 기존 `scripts/reemit_20260804200000_rev2_jongno.mjs` 패턴 재사용 가능.
- **실발송 GO = supervisor**(CEO 명시). dev 산출물 = 정정 payload/절차 준비까지.
- 전제: 실 08-09 마감 총액(정상 30M+대)이 daily_closings 에 존재해야 함(census 스크립트 §AC-1 확정).
  존재하지 않으면(테스트가 실 마감 자체를 대체) → 실 마감 재입력 필요 = 현장/supervisor 판단 대상.

---

## 산출물
- `scripts/T-20260822-foot-HERALD-PHANTOM-CENSUS_readonly.mjs` — READ-ONLY prod census (AC-1/AC-3).
- 본 문서 — 코드-레벨 근인 확정 + AC-2 커버리지 판정 + AC-4 정정 경로.
- 코드/DB 변경 0건 (feasibility_inquiry).
