---
ticket_id: T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-ADD
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-06-23
deploy_ready_at: 2026-06-23
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-ADD.spec.ts
db_changed: false
rollback_sql: none
risk_level: GO (1/5)
commit_sha: d14d3359
---

## 요청

원천: NEW-TASK MSG-20260623-180852-63rk (planner, P1). 김주연 총괄 신규 기능 요청.
선행 T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-MISSING(closed=의도설계, B) 후속.

예약관리 '내 예약' 모드에 담당자(예약등록자) 선택 드롭다운 신규 추가 — 타 담당자 예약 조회.

## 진단 (착수 전 게이트 — A/B)

- **(B) 확정**: 현 코드에 담당자 드롭 없음. `filterMine`은 `registrar_name === myDisplayName` NAME-MATCH 단일 필터(제거된 조건부 렌더 없음 = 회귀 아님). responder 현장조사도 동일 결론(MISSING close).
- 따라서 이 작업 = 회귀 복원이 아니라 **신규 기능 추가**(ADD 티켓).
- OVERHAUL-2-PLAN 겹침 확인: 개편 2탄은 신규 인바운드 분리(W1/W2/W3) 위주 — 본 '내예약 담당자 필터'와 직접 충돌 없음. 동일 화면(Reservations.tsx)이나 수정 지점 분리(상단 기간/내예약 토글 영역 vs 캘린더 슬롯/인바운드).

## 구현

- '내 예약' 선택 시에만 `data-testid="myresv-assignee-filter"` 드롭 노출. 기본값=''(본인, 현행 유지).
- 옵션 소스 = `reservation_registrars`(active, clinic) 이름 추출·중복제거 — registrar_name 스냅샷과 동일 master, DB 변경 0.
- 필터 기준 = `mineTarget = filterAssignee || myDisplayName` → `registrar_name === mineTarget` (NAME-MATCH 확장).
- '전체 예약' 복귀 시 `filterAssignee` 초기화 + 드롭 숨김.
- 본인 옵션 중복 제거(`n !== myDisplayName`).

## 잔여/확인 필요 (FOLLOWUP)

- ⚠ 권한 정책(시나리오2): 1차는 **전체 staff(예약등록자) 선택 허용** 가정으로 구현. 일반 staff가 타 담당자 예약을 조회 가능하게 둘지 vs admin/manager 한정 → responder 경유 reporter(김주연 총괄) 확인 필요.

## 테스트

- 소스 무결성 12/12 PASS (ADD 5 + MYRESV-DEF 회귀 갱신 7).
- 라이브 렌더(전체=숨김 / 내예약=노출·기본본인 / 복귀=재숨김) = supervisor field-soak 대상.
