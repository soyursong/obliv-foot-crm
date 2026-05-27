---
ticket_id: T-20260527-foot-TREATMENT-CYCLE-ALERT
title: 치료회차 기반 경과체크 + 6배수 진료 알림
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
created_at: 2026-05-27
completed_at: 2026-05-27
assigned_to: dev-foot
reviewed_by: ""
build_ok: true
db_changed: true
spec_added: tests/e2e/T-20260527-foot-TREATMENT-CYCLE-ALERT.spec.ts
migration: supabase/migrations/20260527220000_treatment_cycle_fn.sql
rollback: supabase/migrations/20260527220000_treatment_cycle_fn.rollback.sql
---

## 요약

패키지 없는 환자도 n번째 치료 회차를 추적하고, 6배수(6, 12, 18...) 회차에 '진료 필요' 배지를 예약 대시보드에 표시.

## AC 구현 현황

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | 환자별 치료 회차 카운팅 (completed only, 패키지 무관) | ✅ DB RPC `get_treatment_cycle_counts` |
| AC-2 | 6배수 회차 자동 플래깅 ('진료 필요' 배지) | ✅ FE `nextCycle % 6 === 0` |
| AC-3 | 예약 대시보드 UI — 회차 표시 + 진료 필요 배지 | ✅ Reservations.tsx 카드 내 배지 |
| AC-4 | 성능 (N+1 방지) | ✅ 단일 RPC + partial index |

## 변경 파일

### DB
- `supabase/migrations/20260527220000_treatment_cycle_fn.sql`
  - `idx_check_ins_done_customer` partial index (status='done')
  - `get_treatment_cycle_counts(p_clinic_id, p_customer_ids)` DB 함수 (SECURITY INVOKER, STABLE)
  - `authenticated` 역할에 EXECUTE 권한 부여
- `supabase/migrations/20260527220000_treatment_cycle_fn.rollback.sql`

### FE
- `src/pages/Reservations.tsx`
  - `treatmentCycleMap: Map<string, number>` state 추가
  - `fetchWeek()`: `supabase.rpc('get_treatment_cycle_counts', ...)` 배치 호출 추가
  - 카드 렌더링: `{nextCycle}회` + `진료필요` 배지 (purple) 조건부 표시

### E2E
- `tests/e2e/T-20260527-foot-TREATMENT-CYCLE-ALERT.spec.ts` (4 spec)
  - AC-3: 회차 배지 렌더링 + 텍스트 형식 검증
  - AC-2: 진료필요 배지 = 6배수 회차 검증
  - AC-3: purple 색상 + 취소 예약 배지 없음
  - AC-4: RPC 호출 횟수 ≤ 1 (N+1 확인)

## 기술 결정

- **FE 집계 vs DB 집계**: DB 함수 방식 채택. `GROUP BY customer_id` 집계를 DB에서 처리 → 응답 row 수 최소화.
- **partial index**: `WHERE status = 'done'` partial index로 집계 스캔 최적화.
- **SECURITY INVOKER**: RLS가 그대로 적용됨 (clinic_id 필터로 교차 클리닉 접근 원천 차단).
- **`nextCycle = completed + 1`**: 현재 예약이 아직 'done'이 아닌 시점(confirmed/checked_in) 기준 — 이번 방문이 몇 번째가 될지 표시.

## 비고

- `progress_check_required` (T-PROGRESS-CHECKPOINT, 패키지 기반)와 독립. 이 티켓은 패키지 무관 전체 완료 회차 기반.
- 취소(cancelled) 예약에는 배지 표시 안 함 (r.status !== 'cancelled' 조건).
- deadline: 2026-06-09
