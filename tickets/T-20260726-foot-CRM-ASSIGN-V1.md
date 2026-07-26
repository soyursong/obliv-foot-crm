---
id: T-20260726-foot-CRM-ASSIGN-V1
domain: foot
priority: P2
status: qa-pending
qa_result: pending (supervisor DDL-diff 게이트 대기 — 마이그 미적용, 무영속 dryrun 미실행: dev 세션 DB creds 부재)
deploy-ready: false
build-passed: true
db_change: true
da_consult: 면제 (DA CONSULT-REPLY MSG-gxcs = GO_WARN + ADDITIVE=YES → autonomy §3.1, 대표승인 불요·supervisor DDL-diff 게이트만)
mig_files: [supabase/migrations/20260726130000_foot_consult_autoassign_ranking_v1.sql]
mig_dryrun: pending (무영속 dryrun.sql 준비완료 — supabase/migrations/20260726130000_..._v1.dryrun.sql. dev 세션 SUPABASE_DB_PASSWORD 부재로 미실행 → supervisor DDL-diff 게이트에서 무영속 실행)
mig_dryrun_postprobe: pending (dryrun.sql POST-PROBE 절 내장 — 6객체 prod 부재 실측 supervisor 수행)
mig_ledger_check: pending (신규 20260726130000 > 현행 최신, n=0 미존재 예상 — supervisor 확정)
mig_rollback: supabase/migrations/20260726130000_foot_consult_autoassign_ranking_v1.rollback.sql
applied_at: pending (dev prod DML 미실행 — supervisor DDL-diff 통과 후 apply. 착수경로 순서 엄수)
e2e_spec: tests/e2e/T-20260726-foot-CRM-ASSIGN-V1.spec.ts (6종, 스키마 적용 후 통과 — 미적용 시 graceful skip)
created: 2026-07-26
reporter: planner
slack_thread_ts: ""
summary: "상담 자동배정 시스템(실행1~4·6). 기존 AUTOASSIGN 엔진(prod LIVE) 비파괴 확장 — 유입경로 정책 설정 시에만 랭킹·전략 레이어 활성(opt-in, 회귀0). 조건① assignment_actions 재사용(파생 카운트) / 조건② RED LINE INV-1(auto=check_ins.consultant_id만, assigned_consultant_id 무접촉) / 조건③ 컬럼명 정본 교정 / 조건④ ADDITIVE 6객체(staff 2컬럼+4테이블)+롤백pair / 조건⑤ W1~W4 준수. 실행5(Slack)=장쳰봇 초대 미완 = 범위 밖."
---

# T-20260726-foot-CRM-ASSIGN-V1 — 상담 자동 배정 시스템 (실행1~4·6)

## 착수 근거
planner NEW-TASK MSG-20260726-110631-jttj. DA CONSULT-REPLY MSG-gxcs = **GO_WARN + ADDITIVE=YES**
→ autonomy §3.1(대표승인 불요, supervisor DDL-diff 게이트만). repo=obliv-foot-crm. deadline 2026-08-07.

## ★ 핵심 설계 판단 — 기존 엔진 비파괴 확장
기존 `src/lib/autoAssign.ts`(T-20260617 AUTOASSIGN, **prod LIVE**)에 이미 트리거([상담대기] 진입 시
`maybeAutoAssign`), `assignment_actions`, `customers.assigned_consultant_id`, `staff_attendance`가 존재.
→ **재구축이 아닌 확장.** 유입경로 정책(`assignment_leadsource_policy`)이 설정된 경우에만 신규 랭킹·전략
레이어(`src/lib/assignmentStrategy.ts`)가 상담사 선택을 담당하고, **미설정 시 null 반환 → 기존 월균등
least-loaded 경로로 자연 fallback(회귀0, opt-in)**. 실행6 설정 UI 에서 관리자가 정책을 넣는 순간 활성화.

## ★ 반드시 지킬 5조건 준수 매핑
- **① Assignment Log = 기존 assignment_actions 재사용**: 신규 로그 테이블/카운터 컬럼 **0**. 수동배정=기존
  `manualAssign`(action_type='manual'). 일일 배정건수 = `fetchTodayConsultAssignCounts` = `count(*) WHERE
  to_staff_id AND action_type IN(auto_assign,manual) AND created_at::date=today` **파생 쿼리**(물리 카운터 없음).
- **② 매출귀속 RED LINE (INV-1)**: 신규 레이어·엔진 어디서도 `customers.assigned_consultant_id`를 write 하지
  않음. auto-assign 은 `check_ins.consultant_id`(방문 포인터)만 set. 매출접점 **0**. (엔진 조건부 UPDATE `.is(col,null)`
  가드도 consultant_id 대상 — assigned_consultant_id 무접촉.) 이중write 우선순위 = 수동 > 기존경로 > 신규전략(전략은
  else 분기에서만 개입, designated 0순위·manual 불변) = INV-3 정합.
- **③ 컬럼명 정본 교정**: `customers.assigned_consultant_id` / `check_ins` / `staff_attendance.status='present'`
  (enum present|off|leave) / `check_ins.consultant_id`·`payments` — 신규 코드 전부 정본 사용(플레이북 오탈자 미참조).
- **④ 신규 ADDITIVE 스키마** (마이그 20260726130000, 롤백 pair):
  - `staff.auto_assign_enabled` bool NOT NULL DEFAULT true / `staff.slack_user_id` text nullable
  - `assignment_ranking_weights`(clinic_id PK, 3 weight NUMERIC DEFAULT 1)
  - `assignment_daily_target_config`(clinic_id PK, top/bottom int, **CHECK top=bottom*2 = 2:1 DB강제**)
  - `assignment_leadsource_policy`(clinic_id, lead_source CHECK TM/INBOUND/WALK_IN, strategy CHECK daily_target/ranking_pointer)
  - `assignment_pointer_state`(clinic_id, lead_source, cursor_rank int DEFAULT 0, reset_date date) — cursor_rank≠배정건수
  - 랭킹 물리 테이블 **신설 0** = payments 온디맨드 재계산(app min-max 정규화 가중합).
- **⑤ WARN 처리**:
  - **W1**: 기존 `staff.assign_sort_order` **drop 안 함**(롤백에서도 무접촉). 역할 중복 = assign_sort_order 는
    월균등 fallback 경로의 round-robin tie-break(기존), 신규 랭킹은 유입경로 정책 활성 시 매출순위 — 경로 분리(공존).
  - **W2 확정(dev)**: 자정 잡(pg_cron/EF/앱) **없음**. 랭킹 = app 온디맨드(월/주 윈도우 KST 날짜상대 → 자정 자연
    롤오버). pointer 일일 리셋 = lazy(read 시 reset_date≠today → cursor←0). 실행주체 장애 위험 0.
  - **W3**: 2:1 = DB CHECK(top=bottom*2) + 앱(`AssignmentSettingsTab` bottom=top/2 파생·짝수 검증) **이중**.
  - **W4**: V1 = **상담실장(consult)만**. 치료사(therapy)=Phase2 범위 밖(엔진 therapy 경로 불변).

## 구현 산출물
- `supabase/migrations/20260726130000_foot_consult_autoassign_ranking_v1.sql` (+ .rollback.sql + .dryrun.sql)
- `src/lib/assignmentStrategy.ts` (신규) — 실행1 랭킹(fetchConsultantRevenueMetrics·computeRanking) /
  실행2 전략(selectByDailyTarget·pickByRankingPointer·interpolateDailyTargets) / 실행3 필터
  (fetchPresentEnabledConsultants) / 조건① 파생카운트(fetchTodayConsultAssignCounts) / 오케스트레이터
  (pickConsultantByStrategy).
- `src/lib/autoAssign.ts` — else 분기에 전략 레이어 위임(consult 한정, 미적용 시 기존 least-loaded fallback).
- `src/lib/types.ts` — Staff 2필드 + 4 config 타입.
- `src/components/AssignmentSettingsTab.tsx` (신규) — 실행6 설정 UI(가중치/DailyTarget2:1/유입경로전략/직원 ON·OFF/Slack매핑).
- `src/pages/Staff.tsx` — '배정 설정' 탭 추가(admin/manager/director).
- `tests/e2e/T-20260726-foot-CRM-ASSIGN-V1.spec.ts` — 6 시나리오.
- **실행4(수동배정)**: 기존 `manualAssign`(check_ins.consultant_id set + action_type='manual' 로그) **재사용**(신규 구현 0).

## 배정 발동 트리거
대시보드 슬롯 [접수중]→[상담대기](consult_waiting) 전환 시 `maybeAutoAssign` 발동(기존, 초진 기준). 재진 consult 는 기존대로 skip.

## ⚠ 실행5(Slack 알림) = 범위 밖
장쳰봇 `C0B4HEC9SHH` 초대 미완 = 실행5 블록. 본 티켓은 실행1~4·6. slack_user_id 매핑 등록 UI 만 선반영(발송 미배선).
봇 join 후 responder registry 등록 → 별 티켓으로 실행5 언블록(알림은 장쳰봇 명의).

## 게이트 상태 (supervisor 인계)
1. ✅ 마이그 작성(ADDITIVE·롤백 pair·무영속 dryrun.sql·INV-1 반영·컬럼명 교정)
2. ⏳ **supervisor DDL-diff** — 무영속 dryrun 실행 + ADDITIVE·롤백·`assigned_consultant_id` 비-NULL 덮어쓰기 없음 검증.
   (dev 세션 DB creds 부재로 dryrun 미실행 — dryrun.sql 준비완료.)
3. ⏳ DDL-diff 통과 후 prod apply → E2E 6종 실행 → applied_at 기입 → deploy-ready 전환.
- 빌드: `npm run build` PASS. 타입체크 PASS.
