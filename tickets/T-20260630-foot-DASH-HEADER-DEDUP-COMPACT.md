---
id: T-20260630-foot-DASH-HEADER-DEDUP-COMPACT
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: c587b65301
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
db_change: false
summary: "풋 대시보드 상단 헤더/툴바 정리 4건(첨부 F0BEVJG4SLQ로 위치 특정). AC-1 종(알림)아이콘 제거=AssignmentNotifyBell에 showBell prop(default true) 추가→대시보드 showBell={false}로 종 버튼+미읽음 배지 숨김, 마키 스트립(클릭=드롭다운) 유지로 알림 무손실, 예약관리는 prop 미전달=기본 true 종 유지(스코프 격리). AC-2 탭 N건=전체 {신규+재진}건/신규 {statusNewCount}건/재진 {statusReturningCount}건, 기존 화면 보유 카운트 재사용(신규 fetch·집계 0), 0건도 정상표기(NaN 방지). AC-3 좌측 중복 제거=dashboard-statusbar-4item(초진·재진·수납대기·완료) 블록 제거, 초진/재진은 탭 건수로 통합, 미사용된 statusDoneCount/statusPaymentWaitingCount 정의 제거(doneCumulativeIds는 activeNonTerminal 계산 필수라 유지), 수납대기/완료는 칸반 컬럼 헤더 잔존. AC-4 1줄화=슬롯편집/배치편집/당일검색 버튼에 whitespace-nowrap+shrink-0로 2줄 줄바꿈 방지. 영역경계(REDEFINITION_RISK) 준수: 헤더/툴바만, 사이드바·인수인계 박스 무수정. FE-only·DB 무변경. build OK(5.25s). spec 6/6 PASS(S1 결정론 5 + S2 live 1: 종버튼 미노출·상태바 미노출·탭 N건 실렌더·pageerror 0)."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260630-foot-DASH-HEADER-DEDUP-COMPACT.spec.ts
medical_confirm_gate: n/a (접수/칸반 헤더 화면 — 진료대시보드/진료관리 비대상)
---

## 요청 (현장 — 김주연 총괄)
풋 대시보드 상단 헤더/툴바 정리 4건:
1. 종(알림) 아이콘 삭제
2. '전체/신규/재진' 회색 박스에 N건 표기
3. 좌측 중복 내용 제거
4. '슬롯편집/배치편집/당일검색' 2줄 → 1줄

## 구현 (HEAD c587b65301)
- **AC-1 종 아이콘 제거**: `src/components/AssignmentNotifyBell.tsx`에 `showBell?: boolean`(default true) prop 추가.
  종 버튼(`assign-notify-bell`)+미읽음 배지를 `{showBell && (…)}`로 게이트. 대시보드(`src/pages/Dashboard.tsx`)는
  `<AssignmentNotifyBell showBell={false} />`. 마키 스트립(`assign-notify-marquee`, 클릭=드롭다운)·드롭다운 패널 유지 → 알림 기능 무손실.
  예약관리(`Reservations.tsx`)는 prop 미전달=기본 true → 종 유지(인접 코드 동작 불변, 스코프 격리).
- **AC-2 탭 N건**: Tabs 라벨을 `전체 {statusNewCount + statusReturningCount}건` / `신규 {statusNewCount}건` /
  `재진 {statusReturningCount}건`으로. 기존 카운트 재사용 — 신규 fetch·집계 0. 숫자 변수는 항상 정의되어 0건도 정상 표기(NaN 방지).
- **AC-3 좌측 중복 제거**: `dashboard-statusbar-4item`(초진·재진·수납대기·완료) 블록 삭제. 초진/재진은 탭 건수로 통합.
  표기 소비처가 사라진 `statusDoneCount`/`statusPaymentWaitingCount` 정의 제거(unused 방지). `doneCumulativeIds`는
  `activeNonTerminal` 계산에 필수라 유지. 수납대기/완료 수치는 각 칸반 컬럼 헤더에 잔존(정보 손실 없음).
- **AC-4 1줄화**: 슬롯편집(`slot-batch-edit-btn`)·배치편집·당일검색 버튼에 `whitespace-nowrap shrink-0` 추가 →
  좁은 폭(태블릿 80% 줌)에서도 버튼 텍스트 줄바꿈 방지(1줄 유지).

## 검증
- `npm run build` OK (5.25s).
- `tests/e2e/T-20260630-foot-DASH-HEADER-DEDUP-COMPACT.spec.ts` 6/6 PASS.
  - S1(결정론) 5: showBell 게이트+대시보드 false, 예약관리 종 유지(격리), 탭 N건 배선, 상태바+미사용카운트 제거, nowrap.
  - S2(live) 1: 대시보드 헤더 — 종 버튼 미노출 + 상태바 4item 미노출 + 탭 '전체/신규/재진 N건' 실렌더 + NaN/undefined 0 + pageerror 0.

## 경계 / 게이트
- 영역 경계(REDEFINITION_RISK): 헤더/툴바만. 좌측 사이드바(SIDEBAR-DAYLOG)·인수인계 박스(HANDOVER-BOX) 무수정.
- 데이터 정책 자문 게이트: 비대상(신규 컬럼·테이블·enum 0, DB 무변경).
- 의료 컨펌 게이트(§11): 비대상(접수/칸반 헤더 — 진료대시보드/진료관리 아님).

## 비고
- 봉인된 supervisor QA(갤탭 field-soak)에서 80% 줌·태블릿 폭 1줄 유지 최종 확인 권장.
