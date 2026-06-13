---
id: T-20260614-foot-HEALER-LASER-WAIT-PAIR-LAYOUT
title: "[대시보드] 레이저대기·힐러대기 상하 한 쌍 그룹화 + 레이저실 좌측 인접"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 94c58e1
created: 2026-06-14
assignee: dev-foot
reporter: planner
source_msg: MSG-20260614-005523-z3l3
risk_verdict: GO
---

# T-20260614-foot-HEALER-LASER-WAIT-PAIR-LAYOUT

## 요청
힐러대기/레이저대기를 진료·진료대기처럼 상하(위아래) 한 쌍으로 그룹화 +
레이저실 컬럼 좌측 인접 배치. 순수 FE 레이아웃. DB·status 무변경.

## AC
- **AC-1**: 레이저대기·힐러대기가 한 컬럼 안에 상하(위=레이저대기 / 아래=힐러대기) 한 쌍으로 묶임.
- **AC-2**: 그 쌍 컬럼이 레이저실(RoomSection) 좌측에 인접 배치.
- **AC-3**: 기존 쌍(exam_section 진료/진료대기) 동일 패턴 — 두 대기열 모두 drop 타깃 보존.

## 구현 (순수 FE, Dashboard.tsx)
1. `renderWaitingPair()` useCallback 신설 — exam_section 패턴 재사용.
   한 컬럼(`w-40 self-stretch flex flex-col gap-2`) 안에 레이저대기 / 힐러대기
   DroppableColumn 2개를 위아래로 스택. `data-testid="laser-healer-wait-pair"`.
2. 일반(운영) 모드 groupOrder.map 인터셉트:
   - `healer_waiting_col` → 항상 null (쌍으로 병합).
   - `laser_waiting_col` → 레이저실 있으면 클러스터 내부 렌더(skip), 없으면 fallback 쌍 렌더.
   - treatment_laser_cluster 안에 `치료실 | [레이저대기/힐러대기 쌍] | 레이저실` 순서로 배치
     → 쌍이 레이저실 좌측에 인접.

## 충돌 점검 (planner note: 배치편집 개별이동 Dashboard.tsx:217 ↔ 그룹화)
**충돌 아님 — FOLLOWUP 불요.**
기존 선례(`laser_rooms`)가 이미 동일 패턴으로 동작:
- 일반 모드 = treatment_laser_cluster 안에 강제 배치(groupOrder 위치 무시).
- 편집 모드 = `renderKanbanGroup` 케이스로 개별 SortableGroupItem(개별 드래그 보존).

본 작업도 동일하게 **일반 모드 렌더(6643 map)만 수정**하고
`renderKanbanGroup`의 laser_waiting_col / healer_waiting_col 케이스는 **불변** →
편집 모드 개별이동 그대로 보존. 두 뷰는 기존 laser_rooms와 같은 방식으로 decoupled.

## 검증
- `npm run build` OK (DB·status 변경 없음).
- E2E: tests/e2e/T-20260614-foot-HEALER-LASER-WAIT-PAIR-LAYOUT.spec.ts (2 시나리오)
  - 시나리오1: AC-1/AC-2 — 쌍 컨테이너 + 상하 스택(y비교) + 레이저실 좌측(x비교).
  - 시나리오2: AC-3 + 충돌점검 — 일반모드 drop타깃 2개 보존 / 편집모드 개별항목 보존.

## 롤백
순수 FE 추가(59줄, 순수 insertion). revert 커밋으로 즉시 복구. DB 롤백 불요.
