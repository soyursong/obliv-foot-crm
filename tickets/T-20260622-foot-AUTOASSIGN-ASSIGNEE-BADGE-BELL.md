---
id: T-20260622-foot-AUTOASSIGN-ASSIGNEE-BADGE-BELL
domain: foot
status: deploy-ready
deploy-ready: true
db_change: false
build_ok: true
spec_added: tests/e2e/T-20260622-foot-AUTOASSIGN-ASSIGNEE-BADGE-BELL.spec.ts
summary: "자동배정 담당자 표기 A안(내 담당 배지)+B안(벨 알림 🔔) — 선행 BADGE-NOTIFY와 동일기능 dedup"
dedup_of: T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY
implementation_commit: 035afea6
priority: P2
created_at: 2026-06-22
deployed_at: ""
---

# T-20260622-foot-AUTOASSIGN-ASSIGNEE-BADGE-BELL

## ⚠ 중복 티켓 (dedup)

본 티켓(MSG-20260622-180518-eetx)은 직전 발행된 **T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY**
(MSG-20260622-180423-fpmb, 55초 간격)와 **동일 기능**이다. 동일 채널(C0ATE5P6JTH=풋센터)·
동일 reporter(김주연 총괄)·동일 요구(A안 내담당 배지 + B안 벨 알림 동시적용).

→ 기능 구현은 commit **035afea6** 으로 이미 완료·deploy-ready 마킹됨. 재구현하지 않고
   본 티켓의 AC1~5 + 현장 클릭 시나리오 3종 프레이밍으로 **재검증 spec**만 신규 추가.
   두 티켓을 하나로 collapse 하도록 planner FOLLOWUP 발행.

도메인: MQ body 가 "도메인:body"로 오기되었으나 채널/reporter/예시(정명희·임별=foot
IMBYEOL-SKEW 페르소나)로 **foot 확정**. 도수치료센터(body) 건 아님.

## 요약

자동배정 시 누가 담당인지 현장에서 즉시 인지하도록 두 표기 레이어를 동시에 제공한다.
순수 FE 표시/알림 레이어 — 배정 알고리즘·대시보드 동작 불변, add-only, 회귀0, 신규 스키마 0.

- **A안 (내 담당 배지)**: 로그인 사용자 본인이 담당인 대기 카드에 "내 담당" 파랑 배지.
- **B안 (벨 알림 🔔)**: 상단 종 아이콘에 자동배정 미읽음 건수 + 클릭 시 "{고객명} → {담당자명} 배정됨" 피드.

## 수용 기준

- **AC-1** ✅ (A안): 로그인 staff_id == 대기카드 배정 staff_id(`consultant_id`/`therapist_id`) → "내 담당" 배지. 본인 한정, FE-only. role 무관(`staff.user_id = profile.id` 매칭)으로 상담사/치료사 전 역할 커버. → `Dashboard.tsx` `MyStaffIdCtx` / `my-assignment-badge`.
- **AC-2** ✅ (B안): 자동배정 이벤트는 **기존 `assignment_actions`(action_type='auto_assign') SSOT** 에 이미 기록됨을 1차 확인 — 별도 알림 테이블 신설 0. (기록 지점: `autoAssign.ts:370`, `NewCheckInDialog.tsx:353`. `assign_consultant_atomic` 은 selector RPC 로 staff_id 반환만, INSERT 는 FE 성공 경로에서 auto_assign 로그.)
- **AC-3** ✅ (B안): 🔔 클릭 → 최근순(`created_at desc`) "{고객명} → {담당자명} 배정됨" 피드. 고객명=`check_ins.customer_name`, 담당명=`staff.display_name ?? name`. → `AssignmentNotifyBell.tsx`.
- **AC-4** ✅ (B안): 읽음상태 = **per-user localStorage**(`foot-assign-notif-read-{userId}`) — DB 불요. per-item 읽음 + "모두 읽음" + 미읽음 카운트.
- **AC-5** ✅: 배정 알고리즘/대시보드 동작 불변. 벨은 read-only(insert/update/delete/rpc 없음), 배지는 기존 카드 컬럼 비교만 — 표기/알림 add-only.

## 현장 클릭 시나리오 3종

- **S1** ✅: 종 클릭 → 패널 열림 / 다시 클릭 → 닫힘.
- **S2** ✅: 알림 1건 클릭 → 그 건만 읽음(미읽음 1 감소, per-item).
- **S3** ✅: "모두 읽음" → 미읽음 0.

## 구현/검증

- 구현 commit: **035afea6** (선행 BADGE-NOTIFY). 본 티켓은 소스 무변경.
- 신규 산출물: `tests/e2e/T-20260622-foot-AUTOASSIGN-ASSIGNEE-BADGE-BELL.spec.ts` (AC1~5 + S1~S3).
- DB변경: **없음** — 신규 컬럼/테이블/enum 0, 기존 데이터 재사용 → data-architect CONSULT 불요.
- 읽음상태 localStorage 채택으로 DB 영속 불요(티켓 §"per-user localStorage 우선" 충족).

## FOLLOWUP

- planner: 본 티켓 ↔ AUTOASSIGN-BADGE-NOTIFY dedup collapse (동일 기능 2티켓).
