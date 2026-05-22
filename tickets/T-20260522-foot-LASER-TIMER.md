---
ticket_id: T-20260522-foot-LASER-TIMER
title: 비가열 레이저 타이머
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
build_passed: true
e2e_spec: tests/e2e/T-20260522-foot-LASER-TIMER.spec.ts
db_migration: supabase/migrations/20260522110000_timer_records.sql
regression_risk: low
reporter: 김주연 총괄
created_at: 2026-05-22
deployed_at: null
---

# T-20260522-foot-LASER-TIMER — 비가열 레이저 타이머

## 개요

레이저 시술 중 치료사가 치료메모 상단에서 타이머를 설정하면, 카운트다운이 표시되고
종료 1분 전 대시보드 고객 카드가 깜빡인다.

## 수용기준

| # | AC | 상태 |
|---|-----|------|
| 1 | 치료메모 상단 [5분][15분][20분] 버튼 + 카운트다운 | ✅ |
| 2 | ends_at 기준 카운트다운 (탭 비활성 대응) | ✅ |
| 3 | 종료 1분 전 대시보드 카드 깜빡임 (laser-timer-blink) | ✅ |
| 4 | timer_records 신규 테이블 (supervisor 리뷰 대기) | ✅ SQL ready |
| 5 | Supabase Realtime 구독 (timer_records INSERT/UPDATE) | ✅ |
| 6 | 회귀 없음 (빌드 통과) | ✅ |

## 구현 내용

### DB (AC-4)
- `supabase/migrations/20260522110000_timer_records.sql`
- `timer_records(id, check_in_id, clinic_id, duration_minutes, started_at, ends_at, stopped_at, created_by, created_at)`
- RLS: authenticated 전체 select/insert/update
- rollback: `20260522110000_timer_records.down.sql`
- **supervisor 리뷰 후 prod DB 적용 필요**

### FE

#### MedicalChartPanel.tsx
- `checkInId` prop 추가 (optional — 없으면 타이머 미표시, 기존 caller 무변경)
- `laser-timer-panel` 섹션: [5분][15분][20분] 버튼 + 카운트다운 + 진행바 + 종료 버튼
- `loadActiveTimer()`: 패널 열릴 때 활성 타이머 로드
- AC-2 구현: `setInterval(() => ends_at - Date.now())` — 탭 복귀 시 자동 보정

#### Dashboard.tsx
- `medicalChartCheckInId` state 추가
- `handleOpenMedicalChart()`: `ci.id` → `medicalChartCheckInId` 전달
- `TimerAlertCtx`: Set<checkInId> (1분 이하 남은 타이머)
- `timerAlertSet` useMemo: 매 tick마다 재계산
- `activeTimersMap`: Map<checkInId, Date(endsAt)> — Realtime 동기화
- timer_records Realtime 구독 (INSERT/UPDATE 처리)
- DraggableCard(compact/non-compact): `laser-timer-blink` 클래스 적용

#### index.css
- `@keyframes laser-timer-alert` + `.laser-timer-blink` 추가

### E2E
- `tests/e2e/T-20260522-foot-LASER-TIMER.spec.ts` — S-1~S-4 (4 scenarios)

## 리스크

- GO_WARN (1/5) — DB 신규 테이블. 기존 테이블 무변경.
- supervisor DB 마이그레이션 prod 적용 필요

## 회귀 검증

```
✓ npm run build → success (3.21s)
```
