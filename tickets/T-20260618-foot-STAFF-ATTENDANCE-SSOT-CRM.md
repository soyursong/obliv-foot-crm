---
id: T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM
domain: foot
title: "배정화면 '출근 N명' 출근 정본을 구글시트 직접read → CRM 근무캘린더(DB) SSOT로 격상 (A안)"
priority: P2
status: ac0-diagnosis-done / consult-pending
db_change: maybe-additive
source_msg: MSG-20260618-154847-fkv6
repo_path: "/Users/domas/Documents/GitHub/obliv-foot-crm"
related: [T-20260618-foot-AUTOASSIGN-SERVERSIDE-REVIEW, T-20260606-foot-HANDOVER-TODAY-ATTENDEES, T-20260502-foot-DUTY-ROSTER]
serialization_guard: T-20260618-foot-AUTOASSIGN-SERVERSIDE-REVIEW (approved, design-review)
e2e_spec_exempt_reason: ac0-readonly-diagnosis (코드/DDL 미변경 — 진단·설계 산출만)
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
