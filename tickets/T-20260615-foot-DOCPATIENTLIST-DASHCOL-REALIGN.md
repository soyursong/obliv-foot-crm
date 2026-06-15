---
id: T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN
title: "[진료환자목록] 컬럼 확정 순서 재배치 — 방→상태→초/재진→이름→차트번호→처방→예약메모 (오늘/이력 통일)"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 60a0413
impl_commit: 60a0413
created: 2026-06-15
assignee: dev-foot
reporter: 문지은(대표원장)
source_msg: MSG-20260615-182505-cfp3
needs_field_confirm: true
related_tickets:
  - T-20260615-foot-RXLIST-COLALIGN-DONE-READONLY      # 번들 취소+리버트(5b0eb3f). item2(컬럼정합)을 본건으로 재구현(현장 concrete confirm)
  - T-20260615-foot-DOCPATIENTLIST-DONE-CLINICAL-READONLY  # 同 파일(item3, 800be4d). 머지 COORDINATE
  - T-20260615-foot-RXLIST-RENAME-DOCFILTER            # 同 파일 행필터/탭 — 침범 0(헤더 영역)
  - T-20260613-foot-DOCPATIENTLIST-MIRROR-MONOTONE     # 대기순번 1.75rem 제거 회귀가드(grid 탐지 갱신)
  - T-20260612-foot-CHARTNO-COL-SPLIT-P1               # 차트번호 4.5rem 독립 컬럼
  - T-20260610-foot-DOCDASH-DIAGMGMT-6FIX              # 치료실(방) 4.75rem 컬럼 (stale grid assertion 갱신)
---

# T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN (REOPENED, P1)

## 배경
문지은 대표원장이 실화면을 보고 컬럼 순서를 확정(thread ts 1781514925.840609 "다 통일하자").
shipped ad88c41(이후 5b0eb3f revert됨)과 상이 → 새 구현.

## 확정 컬럼 순서 (오늘 모드)
방 → 상태 → 초진/재진(방문유형) → 이름 → 차트번호 → 처방 → 예약메모 → [버튼]

## shipped → 확정안 델타 (작업 핵심)
1. 방문유형(초진/재진)을 독립 컬럼으로 — 위치 = 상태와 이름 사이(이름 바로 왼쪽).
2. 예약메모 = 맨 오른쪽 버튼 바로 앞(기존 유지).
3. 오늘 + 지난 날짜(이력) 화면 모두 동일 순서로 통일(이력 모드 신규 포함).

## 가드
- 칸 너비·크기·폭/비율 변경 0 (현장 명시 "칸 너비·크기 현행 유지", 6/14 COLWIDTH 보존). 순서/배치만 이동.
- DoctorCallDashboard(B) 변경 0. 행필터/탭(RXLIST-RENAME-DOCFILTER, 同 파일) 침범 0.
- 실브라우저 확인: 오늘/이력 모드 각각 + 알림판 나란히 대조.

## 구현 (impl 60a0413)
- 파일: `src/components/doctor/DoctorPatientList.tsx`
- 오늘 모드 PatientRow grid 재배치:
  - grid-cols `3rem_5rem_4.5rem_5.5rem_3.75rem_4.75rem_minmax(0,1fr)_auto`
    → `4.75rem_3.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto`
  - JSX 셀 시퀀스: 방(patient-room) → 상태(StatusCell) → 방문유형(VisitTypeBadge) → 이름(patient-name)
    → 차트번호(patient-chartno) → 처방(PrescriptionStatusBadge) → 예약메모(booking-memo) → 액션.
  - 각 컬럼 폭값을 컬럼과 동반 이동(폭 집합 동일, 순서만) — 너비 무변경 가드 충족.
- 이력 모드: read-only 설계로 상태·방·예약메모·액션 컬럼 부재(DATEMODE-HISTORY AC-1/2).
  공유 컬럼(방문유형→이름→차트번호→처방)이 이미 확정 상대 순서와 동일 → 구조 변경 불요(주석으로 통일 근거 명시).

## AC 충족
- AC1(비교안 게이트): 현장 명시 확정으로 충족(별도 제출 불요).
- 델타1/2: DASHCOL-REALIGN.spec 「델타1」「델타2」로 회귀 고정.
- 델타3(오늘/이력 통일): 양 모드 셀 시퀀스 spec으로 고정.
- 너비 보존: 폭 집합 동일성 spec으로 고정.
- B 미변경 / 필터·탭 미침범: 가드 spec.

## 현장 클릭 시나리오 (E2E 변환 가이드 / scenario_missing 해소)
> spec: `tests/e2e/T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN.spec.ts` (9 PASS). 폭/비율 단언 없음(AC5 보존 — 순서만 검증).

### 시나리오 1: 오늘 화면 컬럼 순서 (정상 동선)
1. 로그인 → 진료 도구(DoctorTools) 진입 → "진료(처방) 환자 목록" 탭 클릭
2. 환자 목록 테이블 행 컬럼 순서가 좌→우 `방 → 상태 → 초진/재진 → 이름 → 차트번호 → 처방 → 예약메모 → [버튼]` 순으로 렌더되는지 확인
   → spec 「오늘 모드 JSX 셀 시퀀스」 / grid-template `4.75rem_3.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto` 검증
3. **초진/재진은 독립 컬럼**(이름 셀 prefix 아님) — 상태와 이름 사이 별도 셀(VisitTypeBadge)로 존재 확인
   → spec 「델타1: 방문유형이 상태와 이름 사이 독립 컬럼」
4. 예약메모(booking-memo) 컬럼이 맨 오른쪽 [버튼] 바로 앞에 위치 확인
   → spec 「델타2: 예약메모가 액션 버튼 바로 앞」

### 시나리오 2: 이력(과거 날짜) 화면도 동일 순서 (AC4)
1. 날짜 네비게이터로 과거 날짜(오늘 아님) 선택 → 이력(read-only) 모드 진입
2. 공유 컬럼 상대 순서(방문유형→이름→차트번호→처방)가 오늘 모드와 동일하게 렌더 확인
   (이력 모드는 read-only 설계로 상태·방·예약메모·액션 부재 — DATEMODE-HISTORY AC, 공유 컬럼 배치만 통일)
   → spec 「이력 모드 공유 컬럼 순서 = 방문유형→이름→차트번호→처방」

### 시나리오 3: 회귀 없음 (AC6)
1. 처방 셀 빠른처방 expandable(펼쳐보기) 클릭 → 정상 동작
2. 처방필터 탭 전환·정렬 토글 동작 유지 확인 (signdoctor-filter / patient-sort-toggle 진입점 잔존)
   → spec 「행필터/탭(RXLIST-RENAME-DOCFILTER) 진입점 미침범」
3. (대조) 진료 알림판(DoctorCallDashboard, B) 컬럼 순서·폭 변경 없음 확인 (B 불변)
   → spec 「DoctorCallDashboard(B) 미변경 가드」

## 검증
- build OK (vite 3.86s).
- 신규 E2E: tests/e2e/T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN.spec.ts — 9 PASS.
- 회귀: MIRROR-MONOTONE(grid 탐지 갱신)·DIAGMGMT-6FIX·QUICKRX-CHARTBTN(stale grid assertion 갱신) PASS.
  HEALER-MEMO-DISPLAY·EXPAND-COURSE-RXHISTORY·RENAME-DOCFILTER·DONE-CLINICAL-READONLY PASS.
- ⚠ 실브라우저 오늘/이력 모드 + 알림판 나란히 대조 = supervisor QA + 현장 confirm 게이트(needs_field_confirm).
- DB변경 없음.

## 잔여(스코프 밖, 사전 존재 실패)
- COLWIDTH-RATIO-TUNE / COLWIDTH-EXPAND-QUICKEDIT 6건 실패는 DoctorCallDashboard(B) colgroup 대상 stale —
  본 변경 stash 후에도 동일 실패(pre-existing). B 미변경 가드상 본 티켓 스코프 밖 → planner FOLLOWUP.
