---
ticket_id: T-20260624-foot-ASSIGN-STAFF-TEMP-OFF
status: consult-pending
priority: P2
domain: foot
created_at: 2026-06-24
build_ok: false
spec_added: pending
db_changed: investigate
consult_gate: data-architect (DB 신설 — CONSULT 1차 게이트 선행)
---

## 요청

원천: NEW-TASK MSG-20260624-161812-hydy (planner, P2). 김주연 총괄 요청.

배정화면(상담/치료사 배정) 직원별 누적 녹색동그라미 옆에 '임시 off' 토글 추가.
담당자가 화장실 등으로 잠시 자리 비울 때 **자동배정에서만 임시 제외**. 출근 유지(녹색 동그라미 유지), 복귀 가능.

## 착수 전 그라운딩 (코드 실측)

- 자동배정 엔진 = `maybeAutoAssign`(src/lib/autoAssign.ts L272~). **함수 내부에서** 후보 풀 산출:
  L319-325 `staff.filter(s => s.role===targetRole && workingIds.has(s.id))`.
- maybeAutoAssign 발화 지점이 **여러 클라이언트/태블릿**: Dashboard 슬롯진입(L5119/5485/5869), 셀프접수 Realtime(L4426/4440), NewCheckInDialog(L325), Assignments 일괄버튼(L524).
- 녹색 동그라미 = Assignments.tsx L837-839 (`workingIds.has(st.staff.id)` → emerald dot).
- UI 수동배정 후보 = `poolFor()` L544-548.
- workingIds = `fetchTodayWorkingStaffIds`(구글시트 read, autoAssign.ts L95-115).

## 설계 결정 (1줄)

**임시 off ≠ 휴무.** 녹색 동그라미(workingIds=출근)는 그대로 두고, 자동배정 후보 풀에서만 제외.
maybeAutoAssign이 다른 태블릿에서도 발화하므로 **클라이언트 로컬 state로는 불충분** →
독립 ADDITIVE 공유영속 테이블 `staff_temp_off`(clinic+staff+work_date) 신설.
maybeAutoAssign이 당일 제외셋을 read해 pool에서 빼고, poolFor()도 동일 제외. workingIds 렌더 미변경.
⚠ staff_attendance(blocked T-20260618-...-SSOT-CRM)와 무관 — 완전 독립 격리.

## 게이트

- DB 신설 → data-architect CONSULT 1차 게이트 선행 (grounding #3 / collab §S2.4). ADDITIVE이므로 대표게이트 불요(autonomy §3.1).
- CONSULT GO 후 → 마이그 적용(up/down/dryrun) → supervisor DDL-diff QA.
