---
ticket_id: T-20260523-foot-SPACE-DASH-SYNC
title: "공간배정 → 대시보드 슬롯 자동 연동 (마지막 저장 carry-over)"
domain: foot
status: deployed
priority: P2
created_at: 2026-05-23
updated_at: 2026-05-24
deploy_ready: true
build_ok: true
db_change: false
e2e_spec: tests/e2e/T-20260523-foot-SPACE-DASH-SYNC.spec.ts
affected_files:
  - src/pages/Dashboard.tsx
  - src/pages/Staff.tsx
  - tests/e2e/T-20260523-foot-SPACE-DASH-SYNC.spec.ts
qa_result: pass
qa_grade: Green
deployed_at: 2026-05-24T09:40:00+09:00
deploy_commit: c65bf0f32579faf48f39c9f1d539f7f359b32ff2
bundle_hash: Dashboard-CqIGSXMe
field_soak_until: 2026-05-25T09:40:00+09:00
precheck_pass: true
precheck_at: 2026-05-24T09:40:00+09:00
---

## 개요

공간배정(직원 > 공간배정) 저장 데이터를 대시보드 슬롯에 자동 연동.
당일 배정 없을 때 "마지막 저장된" 데이터를 carry-over.

## 정정 이력

- **2026-05-24**: 김주연 총괄 스펙 정정 (MSG-20260524-003349-f9qx)
  - "전날 데이터 carry-over" → "마지막 저장 데이터 carry-over" 전면 교체
  - fallback: MAX(created_at) 기준 (saved_at 프록시). "전날" 하드코딩 절대 금지.

## AC (정정 후 최종)

- **AC-1**: 대시보드 진입 시, **마지막 저장된** 공간배정 데이터가 당일 슬롯에 자동 반영됨
- **AC-2**: 새 날 첫 접속 시 **마지막 저장 상태 기반** 반영 (전날 한정 아님)
- **AC-3**: 당일 공간배정 없으면 **마지막 저장된 공간배정이 그대로** 표시됨
  - 예: 월요일 저장 → 화·수 미저장 → 수요일 대시보드에 월요일 저장 데이터 표시
- **AC-4**: 공간배정 페이지 [저장] → 대시보드 슬롯 즉각 반영
- **AC-5**: 새로고침 시 변경 배정 반영
- **AC-6**: SPACE-AUTOROUTE 회귀 없음
- **AC-7**: SPACE-ASSIGN-REVAMP 지속성 회귀 없음
- **AC-8**: 빌드 성공, E2E 회귀 없음

## 구현 포인트

### Dashboard.tsx `fetchAssignments`
- 당일 배정 없을 때 fallback: `MAX(created_at)` 기준 최신 레코드 조회
- `order('created_at', { ascending: false })` (이전: `order('date', ...)`)
- `select('date, created_at')` (이전: `select('date')`)
- "전날 하드코딩(date - 1 day)" 없음 확인

### Staff.tsx `assignments` query
- 동일 변경: `order('created_at', ...)` / `select('date, created_at')`

### room_assignments 테이블
- DB 마이그레이션 불필요: 기존 `created_at` 컬럼을 `saved_at` 프록시로 활용
- Staff.tsx 배치 저장 시 delete+insert → 모든 새 행 `created_at = NOW()` 자연 설정

## E2E 시나리오

| # | 내용 | AC |
|---|------|----|
| 1 | 대시보드 칸반 로드 후 슬롯 표시 확인 | AC-1, AC-3 |
| 2 | 공간배정 [저장] → 대시보드 새로고침 반영 | AC-4, AC-5 |
| 3 | 오늘 배정 없을 때 마지막 저장 carry-over (월~수 미저장 후 수요일 체크) | AC-2, AC-3 |
| 4 | SPACE-AUTOROUTE 회귀 없음 | AC-6 |
| 5 | handleStaffAssign date-guard 확인 | AC-8 |
