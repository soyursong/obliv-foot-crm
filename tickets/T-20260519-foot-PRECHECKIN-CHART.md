---
id: T-20260519-foot-PRECHECKIN-CHART
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260519-foot-PRECHECKIN-CHART.spec.ts
created: 2026-05-19
---

# T-20260519-foot-PRECHECKIN-CHART — 초진 접수 전 차트 열람·기입 가능화

## 배경

현장 재보고: "초진도 체크인(접수) 전에 차트가 기본적으로 열려야. 기본 고객정보 확인 및 내원콜 후 방문 여부 체크 후 기입 필요."

기존 FIRSTVISIT-CHECKIN(deployed) AC-3으로 Box1Card `onSelect` → 차트조회는 이미 구현됨.

## 문제 분석 결과

`CustomerChartPage`는 `customers` 테이블 기반 렌더 → `check_in` 없이도 완전 동작.
`latestCheckIn === null` 시에도 고객정보 폼, 방문확인 UI 모두 정상 표시.

**버그 발견**: `handleVisitConfirm`의 `nextResv` 탐색 로직.
- `reservations`는 `reservation_date DESC`로 로드됨.
- `find((r) => r.status === 'confirmed')`가 가장 먼 미래 예약 반환.
- 오늘 예약 + 미래 예약 동시 존재 시 잘못된 예약에 방문확인 메모 기록.
- → 날짜+시간 오름차순 정렬 후 첫 번째(가장 가까운) confirmed 예약 선택으로 수정.

## AC 검증

- AC-1: Box1Card `onSelect` → `ctxOpenChart` → `CustomerChartSheet` → `CustomerChartPage` ✅ 기존 구현
- AC-2: `check_in` 없이도 `customers`+`reservations` 기반 고객정보 표시 ✅ 기존 구현
- AC-3: 접수 전 기입 가능 (`handleVisitConfirm` + 방문확인 UI) ✅ 기존 구현 + 정렬 버그 수정
- AC-4: 기존 `onCheckIn`(접수 버튼) 동작 유지 ✅ 무변경
- AC-5: 회귀 0 ✅ E2E spec 추가

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/pages/CustomerChartPage.tsx` | `handleVisitConfirm` + UI `nextResv` 정렬 버그 수정 (DESC→ASC, 가장 가까운 confirmed 예약) |
| `tests/e2e/T-20260519-foot-PRECHECKIN-CHART.spec.ts` | E2E spec 신규 |
| `tickets/T-20260519-foot-PRECHECKIN-CHART.md` | 티켓 생성 |

## DB 변경

없음

## 롤백

`CustomerChartPage.tsx` revert: `handleVisitConfirm` + UI `nextResv` 탐색 1줄씩 복원
