---
id: T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM
domain: foot
title: "배정화면 '출근 N명' 출근 정본을 구글시트 직접read → CRM 근무캘린더(DB) SSOT로 격상 (A안)"
priority: P2
status: ac1-ac3-authored / supervisor-ddldiff-pending
db_change: true
db_change_kind: additive
gate_go: MSG-20260703-080819-ur31 (planner GO — gate a=DA✅ / gate b=①field-confirm+②Vercel 양조건 CLEARED)
consult_reply: MSG-20260618-173142-dajh
source_msg: MSG-20260618-154847-fkv6
repo_path: "/Users/domas/GitHub/obliv-foot-crm"
related: [T-20260618-foot-AUTOASSIGN-SERVERSIDE-REVIEW, T-20260606-foot-HANDOVER-TODAY-ATTENDEES, T-20260502-foot-DUTY-ROSTER, T-AUTOASSIGN-BALANCE-TOSS]
serialization_guard: T-20260618-foot-AUTOASSIGN-SERVERSIDE-REVIEW (status=done, design-only — 충돌 없음, 해소)
migration_fwd: supabase/migrations/20260618200000_staff_attendance_ssot.sql
migration_rollback: supabase/migrations/20260618200000_staff_attendance_ssot.rollback.sql
sync_cron_fwd: supabase/migrations/20260618201000_attendance_sync_cron.sql
sync_cron_rollback: supabase/migrations/20260618201000_attendance_sync_cron.rollback.sql
sync_ef: supabase/functions/attendance-sync/index.ts
dryrun_script: scripts/T-20260618-foot-STAFF-ATTENDANCE-SSOT_dryrun.mjs
dbgate_evidence: db-gate/T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM_dbgate.md
e2e_spec_exempt_reason: db-only-additive (테이블 신설 DDL + sync cron/EF — 소비처 0, 배정화면 read 전환 전까지 런타임 동작 변경 0)
---

# AC-0 Read-only 진단 — 출근 산출 경로 + 근무캘린더 DB 모델

## 1. 현행 '출근 N명' 산출 경로 (전수 기술)

```
Assignments.tsx:141  load()
  └─ fetchTodayWorkingStaffIds(clinic.id, staffList)     [src/lib/autoAssign.ts:95]
       └─ fetchTodayAttendeeNames(today, DUTY_SHEET_GIDS, allNames)  [src/lib/dutySheet.ts:326]
            └─ fetchSheetCsv(gid)  →  EF `duty-sheet-read`  →  docs.google.com gviz CSV (런타임 직접 read)
            └─ parseDutyAttendees(csv, today, allNames)  →  출근자 "이름" 목록
       └─ 이름 → staff.id 매칭(name/display_name)  →  Set<string> workingIds
  └─ '출근 {workingIds.size}명'  [Assignments.tsx:442]
```

- **자동배정 엔진도 동일 소스 사용**: `autoAssign.ts:321`(단건 트리거), `autoAssign.ts:405`(일괄)에서 `fetchTodayWorkingStaffIds` 호출 → 출근 후보 풀. **출근 소스를 바꾸면 배정 후보 풀도 함께 바뀐다 (회귀 위험 핵심 지점).**
- 시트 장애 시 graceful: 빈 Set 반환 → '출근 0명'.

## 2. CRM 근무캘린더 DB 모델 현황

- **테이블**: `duty_roster` (migration `20260504000003_duty_roster.sql`)
  - 컬럼: `clinic_id, date, doctor_id(FK staff.id), roster_type(regular|part|resigned), notes`
  - UNIQUE(clinic_id, date, doctor_id) · RLS: select=clinic 전체, insert/update/delete=admin·manager
  - **모델링 의도 = "당일 근무 원장(doctor)"** (서류발행 자동세팅용, T-20260502).
- **UI**: `DutyRosterTab.tsx` (근무캘린더 탭, 주간 달력, 셀 토글 없음→근무→파트)
- **시트→DB 적재**: `DutyRosterImportDialog.tsx` — 구글시트 파싱 → `duty_roster` insert. **단, 수동 1회성 import (사람 게이트 "삽입 확정")**.
- **⚠ 자동 sync 부재**: `duty_roster`를 주기적으로 채우는 cron/EF 없음(grep 확인). 채움은 오직 수동 import.

## 3. 결정적 발견 — A안의 숨은 전제 = 자동 sync 신설

A안("CRM DB를 출근 SSOT, 구글시트는 동기화 수단")을 **배정화면 read를 duty_roster로 바꾸는 것만으로** 구현하면:
- duty_roster는 **수동 import 시점 스냅샷** → 매일 누군가 재import 안 하면 **'출근 N명'이 stale** → 현재 항상-최신 라이브 시트 read 대비 **정합성 회귀**. (회귀금지 위반 위험)
- 따라서 A안은 **자동 sheet→table sync (cron EF)** 신설을 필연 전제로 한다.

## 4. 직렬화 가드 분석 — SERVERSIDE-REVIEW와 의존관계 (단순 인접 아님)

`T-20260618-foot-AUTOASSIGN-SERVERSIDE-REVIEW` §53 옵션 B 원문:
> **B. Supabase DB trigger**: 구글시트 read를 어떻게 해결할지가 관건(trigger 내 외부 fetch 불가 → **working staff를 테이블에 동기화 선행 필요**).

→ 본 티켓이 만들려는 "출근 SSOT 테이블 + sheet sync"가 **SERVERSIDE-REVIEW 옵션 B/C의 선행조건(enabler)**.
두 티켓은 **동일한 sheet→table sync 메커니즘을 공유**한다. 본 티켓에서 sync를 독단 설계하면 SERVERSIDE-REVIEW 권고(아직 미확정 design-review)와 충돌·중복 가능.

## 5. 설계 옵션 (DA CONSULT 안건)

| 옵션 | SSOT 테이블 | 장점 | 단점 |
|------|------------|------|------|
| **S1. duty_roster 재사용** | 기존 duty_roster | 신규 스키마 0, UI/import 재사용 | 모델 의미가 'doctor'(roster_type)에 결박, 출근/휴무 의미 부정확, 시간대(in/out) 없음 |
| **S2. staff_attendance 신설(ADDITIVE)** | 신규 `staff_attendance(clinic_id,date,staff_id,source,synced_at)` | 출근 의미 명확, 다지점·sync 메타 보유, SERVERSIDE 옵션B trigger가 깨끗이 read | 신규 테이블 → DA CONSULT + supervisor DDL-diff + 롤백SQL 필수 |
| **sync** | (공통) sheet→table 자동 동기화 EF(cron) | freshness 보장 | SERVERSIDE-REVIEW와 메커니즘 공유 — 단독 설계 금지 |

## 6. 권고 (HOLD-코드, 게이트 선행)

1. **코드/DDL 미착수** — AC-0 진단·설계까지만 (본 커밋).
2. **DA CONSULT 발행**: SSOT 테이블 모델 결정(S1 vs S2) + sync 소유권을 SERVERSIDE-REVIEW와 정합.
3. **planner FOLLOWUP 발행**: 직렬화 가드 해소 = 본 티켓 sync 설계를 SERVERSIDE-REVIEW와 **시퀀싱/병합**할지 결정 요청. in-flight 배정작업(AUTOASSIGN-RUN-FAIL-TABSCROLL, deploy-ready/deployed) 안정화 확인됨.
4. 회귀금지 준수: 인수인계·배정로직·자동배정 무변경(현 read 경로 유지).

---

## 7. AC-1 — S2 staff_attendance 신설 마이그 (DA CONSULT-REPLY 반영, 2026-06-18 dev-foot)

DA CONSULT-REPLY (MSG-20260618-173142-dajh): **Q1=S2 신설 GO / S1 재사용 NO_GO**, **Q2=단일 sync 통합 GO**. ADDITIVE → 대표 게이트 면제.

### 산출
- forward: `supabase/migrations/20260618200000_staff_attendance_ssot.sql`
- rollback: `supabase/migrations/20260618200000_staff_attendance_ssot.rollback.sql`
- dry-run: `scripts/T-20260618-foot-STAFF-ATTENDANCE-SSOT_dryrun.mjs` (외부 TX ROLLBACK, 무커밋)
- db-gate 증거: `db-gate/T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM_dbgate.md`

### 모델 (DA 권고 컬럼 전수 반영)
`staff_attendance(id, clinic_id FK→clinics, date, staff_id FK→staff, source CHECK(google_sheet/manual/crm), status CHECK(present/off/leave), synced_at, created_at, updated_at)` · **UNIQUE(clinic_id,date,staff_id)** · INDEX(clinic_id,date) · RLS=duty_roster 동형(select clinic 전체 / write admin·manager).

### dry-run 실측 (prod, 무커밋 ROLLBACK)
충돌 가드 null(신설 성립) · FK 대상 전부 존재 · 컬럼9·CHECK2·FK2·PK·UNIQUE3키·RLS4·인덱스3 성립 · 멱등 재실행 무해 · ROLLBACK 후 prod 무변경. staff 마스터 54(active 35)=시트 매핑 모집단.

### 범위 한정 (직렬화 가드 준수)
본 AC-1 = 테이블 신설 DDL **만**. sheet→table sync EF + 배정화면 read 전환은 AUTOASSIGN-SERVERSIDE-REVIEW와 sync 메커니즘 공유 → 별 게이트(planner 시퀀싱 조율). 본 마이그 소비처 0 → 회귀 표면 없음(현 시트 직접 read 경로 무변경).

### 다음 게이트
supervisor DDL-diff QA → 통과 후 dev-foot 직접 pg 적용.

---

## 8. GATE GO — 착수 확정 (planner MSG-20260703-080819-ur31, 2026-07-03)

gate(a) DA=✅(S2 staff_attendance 신설 GO/ADDITIVE, S1 duty_roster확장 NO_GO) + gate(b) 양조건 CLEARED:
- **① AUTOASSIGN-RUN-FAIL-TABSCROLL field-confirm** ✅ (archive/2026-06 이관=done, block_resolved 06-20, 13일 무reopen 안정 → 배정 surface 안정 확정).
- **② Vercel foot 배포차단** ✅ (실측 드리프트 정정 — prod deployed_at 25건 07-02~03 정상, 07-01 acute cap ~24h 자연리셋, UNFREEZE closed).
- **직렬화 가드** AUTOASSIGN-SERVERSIDE-REVIEW=done(design-only, 코드·DB 변경 0) → 충돌 없음.

**ADDITIVE + DA GO → 대표게이트 불요(autonomy §3.1). 남은 배포 게이트 = supervisor DDL-diff 1건뿐.**

## 9. AC-3 — sheet→table 자동 sync 설계 (attendance-sync EF + pg_cron)

DA CONSULT-REPLY Q2=**단일 sync EF 통합 GO**. 본 티켓 배정화면 '출근 N명' + AUTOASSIGN-SERVERSIDE 옵션B/C trigger + BALANCE-TOSS #5 후보풀 — **셋 다 동일 staff_attendance 를 read**하는 단일 출근모델(§수렴 준수, 양 티켓 다른 출근모델 금지).

### 산출
- EF: `supabase/functions/attendance-sync/index.ts`
- cron 마이그(fwd): `supabase/migrations/20260618201000_attendance_sync_cron.sql`
- cron 마이그(rollback): `supabase/migrations/20260618201000_attendance_sync_cron.rollback.sql`

### EF 동작 (reconcile, 멱등)
1. 파서 = `src/lib/dutySheet.ts` 실측검증(2001c73) 순수함수 **그대로 이식**(재작성 아님) — 월 롤오버·특수토큰(전직원/총괄/휴진)·주간블록·월경계 교차주 가드 동일. 서버라 gviz CSV 직접 fetch(CORS 프록시 불요).
2. active staff 로드 `select id,name`(⚠ display_name 컬럼 미존재 HOTFIX 교훈 → name 매칭만).
3. 대상 창 `[today-1, today+14]`(KST). 날짜별 시트 출근자 이름 → staff_id 매핑.
4. **reconcile(google_sheet source만)**: desired에서 빠진 google_sheet 행 DELETE / 신규 INSERT(present) / 기존 UPDATE synced_at. **source IN (manual,crm) 행 무접촉**(현장 수기 override 보존).
5. graceful: gid·날짜 실패 시 부분 skip(throw 안 함), unmatched 이름 warn 로그(매핑 감사).

### cron (매일/변경시)
- `foot-attendance-sync` = `*/15 * * * *`(15분 주기) → `trigger_attendance_sync()` → net.http_post EF. 변경 반영 지연 ≤15분 + 매일 자동 보장. 풋 vault 컨벤션(app.supabase_url/app.cron_secret → vault) — dopamine outbox worker 동일.
- **⚠ 반드시 테이블 마이그(20260618200000) apply 후 적용**(sync worker가 채우는 테이블 선행).

### 범위 한정 (직렬화 가드 준수)
AC-3 = sync EF + cron **까지만**. 배정화면 read 전환(AC-2)은 sync 가동·freshness 검증 후 별 단계. 본 단계 소비처 0 → 현 시트 직접 read 경로 무변경 → 회귀 표면 0.

### 검증(build/typecheck)
- `deno check attendance-sync/index.ts` → clean.
- `npm run build` → ✓ (src/ 무변경, EF는 Deno 런타임).

## 10. 배포 게이트 순서 (planner 권고 반영)
1. **supervisor DDL-diff 5-check** — 대상: ① `20260618200000_staff_attendance_ssot.sql`(테이블) ② `20260618201000_attendance_sync_cron.sql`(worker). → **본 단계 요청 발행.**
2. 통과 후 dev-foot PROD apply(테이블 먼저 → cron) + attendance-sync EF 배포(+env 주입).
3. 수동 1틱 `SELECT trigger_attendance_sync();` → staff_attendance rows>0 + 시트 오늘 출근자 수 대조(AC-5 정합).
4. freshness 안정 확인 후 → **AC-2 배정화면 read-swap**(시트 직접 read → staff_attendance read).
5. AC-4 회귀금지(Handover·배정로직·자동배정 무변경) + AC-5 정합검증(근무캘린더 등록→배정화면 출근현황 반영).
