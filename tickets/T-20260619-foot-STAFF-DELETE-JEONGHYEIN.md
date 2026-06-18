---
ticket_id: T-20260619-foot-STAFF-DELETE-JEONGHYEIN
id: T-20260619-foot-STAFF-DELETE-JEONGHYEIN
status: blocked
priority: P2
domain: foot
created_at: 2026-06-19
owner: agent-fdd-dev-foot
requester: 김주연 총괄 (입사 이력 없는 인원 명시적 실삭제 요청)
approved_by: planner NEW-TASK MSG-20260619-080120-m9ao
build_ok: n/a (DB DML 단건, FE 코드 변경 없음)
spec_added: n/a
db_changed: false (hard-delete 보류 — 마이그 .FK_PRECHECK_HOLD 미배포 유지)
data_architect_consult: 불요 — staff 단건 DELETE(DML). 신규 컬럼·테이블·enum 0.
blocked_reason: FK precheck 3건 잔존 → hard-delete 게이트 step4 보류
followup: planner FOLLOWUP (reporter 처리방식 확정 요청)
risk_level: HOLD (hard-delete 차단. CASCADE 금지)
---

# T-20260619-foot-STAFF-DELETE-JEONGHYEIN — 정혜인 staff 실삭제 (보류)

## 요청
풋 CRM `staff` 테이블 '정혜인 실장' 레코드 hard-delete (reporter=김주연 총괄, 미입사 인원).

## hard-delete 게이트 선조사 (2026-06-19, READ-ONLY 라이브 재확인)

### (1) 단건 특정 — OK (동명이인 없음)
- name='정혜인' staff 후보 **1건**
- `id=5f141f76-7f72-4560-8a67-bbcdf4938cad` · clinic=74967aea(풋 종로) · role=consultant · active=false · created=2026-04-23

### (2) FK 전수 조사 — staff 참조 FK 19개 동적 순회
**참조 총 3건 잔존 → 게이트 step4 (귀속 >0건) 해당:**

| child | col | del_action | count | 비고 |
|-------|-----|-----------|-------|------|
| customers | assigned_staff_id | SET NULL | 1 | 설연우(+821027749571) 담당 실장 귀속 |
| room_assignments | staff_id | NO ACTION | 2 | 2026-04-28 상담실"1", 2026-05-07 "상담실5"(staff_name='정혜인') |

- room_assignments는 **NO ACTION(RESTRICT)** → DELETE 자체가 하드 실패. CASCADE 금지(게이트).
- "미입사/perf 0" 전제와 달리 실제 배정 흔적 + 고객 귀속 존재.

### (3) 판정 — hard-delete **보류**
- 형제티켓 STATS dry-run의 "전기간 실적 0건"은 실적(perf) 한정. 실적 외 FK(배정·고객귀속)는 잔존 확정.
- 강제 삭제·CASCADE 금지 → planner FOLLOWUP으로 reporter(김주연 총괄) 처리방식 확정 요청.

## 처리방식 옵션 (reporter 결정 대상)
1. **참조 정리 후 삭제**: room_assignments 2건 정리(삭제/재배정) + customers.assigned_staff_id NULL or 재배정 → 이후 hard-delete 재실행.
2. **soft-delete 유지**: active=false 상태 유지(이미 false). 통계는 형제티켓 STATS active-filter로 비노출. 명단 비노출은 별도.
3. **명단만 숨김**: 직원관리 명단에서만 비활성 숨김(FK 보존).

## 산출물
- 마이그(보류): `supabase/migrations/20260619030000_foot_staff_delete_jeonghyein_misentry.sql.FK_PRECHECK_HOLD` — 인라인 가드(단건보장+FK precheck+행수검증)로 어떤 경로로 실행돼도 자기-차단.
- rollback: `supabase/migrations/20260619030000_foot_staff_delete_jeonghyein_misentry.rollback.sql`
- precheck 증거: `scripts/T-20260619-foot-STAFF-DELETE-JEONGHYEIN_fk_precheck.mjs`, `..._fk_detail.mjs` (READ-ONLY)

> 참조 3건이 정리되면 `.FK_PRECHECK_HOLD` 제거 → 010000/020000 뒤 합류. 인라인 가드가 0건일 때만 실삭제 통과.
