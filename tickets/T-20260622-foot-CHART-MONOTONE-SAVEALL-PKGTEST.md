---
ticket_id: T-20260622-foot-CHART-MONOTONE-SAVEALL-PKGTEST
domain: foot
priority: P2
status: deploy-ready
block_reason: ''
requester: 김주연 총괄
thread: C0ATE5P6JTH
risk: GO
owner: agent-fdd-dev-foot
approved_by: planner NEW-TASK MSG-20260622-105341-aje7
deploy-ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-22
db-change: false
build: pass
spec: tests/e2e/T-20260622-foot-CHART-MONOTONE-SAVEALL-PKGTEST.spec.ts (20 pass)
qa_result: self-pass-pending-supervisor
commit: d124f885
stage_done: [AC1-residual-color-mono, AC2-saveinput-btn-mono, AC3-chart-save-all, AC4-bloodtest-gate-hasCheckIn, build, spec-20pass, AC1-screenshot-position-confirm]
stage_pending: [supervisor-QA, 갤탭-실기기-confirm]
medical_gate: not-applicable
medical_gate_rationale: >
  surface = src/pages/CustomerChartPage.tsx (SMART DOCTOR 고객정보 = 2번차트/고객차트).
  §11 게이트 대상(진료대시보드/진료관리)은 src/components/doctor/* (DoctorDashboard·MEDREC·
  OpinionDocTab·KohReportTab 등). 본 티켓은 고객차트 표현 폴리시 + 패키지 탭 게이트로
  진료대시보드/진료관리 코드 미접촉. 선례 T-20260615 item2(동일 CustomerChartPage 모노톤)
  risk=GO 무게이트 배포와 정합.
---

# T-20260622-foot-CHART-MONOTONE-SAVEALL-PKGTEST

김주연 총괄 차트 UI 폴리시 4건 묶음. 순수 FE (DB/EF/스키마 변경 0, risk=GO).

## AC-1 — 2번차트 잔여 유채색 모노톤화 (색상 정합 보정)
- 어르신용 chip/card: emerald → teal (일반 형제 정합)
- 환불/비급여 chip/card: rose → neutral
- 양식선택 dialog 카드 emerald/rose 제거
- src/components/PenChartTab.tsx + 양식 chip/card
- ⚠ 참고 스크린샷 4장 MQ 지연전달(planner MSG-200026) → **위치 정합 검증 완료(2026-06-22, 정합 OK·누락 0건)**.
  SS3(110000 양식선택 dialog)·SS4(110001 상단툴바 chip) 어르신용 emerald→teal + 환불/비급여 rose→neutral 전부 d124f885 커버.
  SS2(105959)=AC-2 black버튼·SS1(105958)=AC-4 피검사 게이트로 동일커밋 커버. 추가 보정 패치 불필요.
  잔여 관찰(스코프外): L2889/2896 선택/이동 드로잉툴 active emerald = 4장 미지목·드로잉캔버스 affordance → 별건 인지.

## AC-2 — 2구역·3구역 완전검정 저장·기입 버튼 → 모노톤
- 저장 = primary 차콜 #333
- 새차트작성·링크생성·메모추가 = secondary 미드그레이 #666
- 하드코딩 pure-black(#000) 제거. THEME 중성그레이 범위(#333~#666) 준수.

## AC-3 — 2번차트 상단 [예약하기] 좌측 [저장] 전체저장 버튼 신설
- handleInfoPanelSave("저장 후 닫기"가 쓰는 통합 저장) 1:1 재사용 → **신규 write-path/스키마 없음**.
- 항상 클릭 가능(저장 중 disabled), 성공/실패 토스트 내장.
- data-testid=btn-chart-save-all, [예약하기] 좌측 배치.
- src/pages/CustomerChartPage.tsx L4505~4515.

## AC-4 (RC) — 패키지 '피검사' 항목 표시 불안정("있다 없다 함") 근인 수정
- **RC**: 노출 게이트가 구(舊) `svcs.length===0` 단독 → svcs 쿼리 로딩 타이밍 의존 → 깜빡임.
- **FIX**: KohRequestToggle 과 동형 `useHasCheckIn`(check_ins 직접 조회) 게이트로 전환.
  KOH가 NOTRENDER + ALL-CH 두 차례 교정한 게이트를 피검사만 미적용했던 것이 근인.
- svcs 비었을 때 ON 시도 → 안내 토스트(무행위 silent 방지).
- src/components/BloodTestRequestToggle.tsx

## 검증
- npm run build PASS
- E2E spec 20 PASS (AC-1 ×3 / AC-2 ×6 / AC-3 ×3 / AC-4 ×8)
- db_change: false (순수 FE + 기존 save 핸들러/기존 컬럼 재사용)

## 파일 중첩 인지
- AC-3 = 2번차트 상단툴바 = blocked T-20260606-CHART2-FOOTQ-VIEWER /
  T-20260611-CHART2-MEDREC-LAYOUT-REVERT 동일영역. 둘 다 blocked라 동시충돌 없음(인지 후 진행).

## supervisor QA
- 2번차트(고객차트): 어르신/환불·비급여 chip 유채색 없이 teal/neutral, 저장 #333·기입 #666 모노톤, 완전검정 0.
- 상단 [예약하기] 좌측 [저장] 클릭 → 차트 전체 저장(토스트).
- 패키지 탭 '피검사' = 체크인 내원 있을 때 일관 노출(깜빡임 없음), 내원 없으면 미노출.
- 갤탭 실기기 확인 후 done. AC-1 위치 정합은 스크린샷 회수 후 추가 확인.
