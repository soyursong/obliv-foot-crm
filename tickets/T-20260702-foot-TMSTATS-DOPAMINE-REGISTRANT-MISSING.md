---
id: T-20260702-foot-TMSTATS-DOPAMINE-REGISTRANT-MISSING
domain: foot
domain_routing: "channel C0ATE5P6JTH 정본 (slack_channel_registry §5) — override 불가. responder [ROUTING] domain=foot 강제 수용."
title: "[P1·운영버그·DIAGNOSE-FIRST] 통계대시보드>TM집계 페이지에서 도파민 연동(source_system=TM) 예약건의 등록자 이름 공란 표시. 같은 예약이 예약관리 페이지에서는 등록자 '진운선' 정상 노출 → 데이터(staff)는 존재. TM집계 페이지의 등록자 조회 쿼리가 도파민 경로 예약의 staff 정보를 조인/매핑 못하는 표시측 버그로 추정. FE/read-only 쿼리 fix 추정."
priority: P1
status: deploy-ready
deploy_ready: true
qa_result: pending
qa_fail_reason: null
qa_fail_phase: null
fix_note: "RE-VERIFY 2026-07-03 — 구현/커밋 실재 확인. origin/main(remote SHA eba452ee)에 fix commit fe70613c(코드) + d60430be(signals docs) 포함(git merge-base --is-ancestor fe70613c origin/main = YES). supervisor 前 QA 는 fetch 전 stale checkout 기준이라 --grep 미검출. 재검증: npm run build ✓(5.17s), spec 존재, registrar_name=예약관리 SSOT 축 정합 확인. supervisor 는 git fetch origin && git checkout origin/main 후 재QA 요망."
hotfix: false
created: 2026-07-02 17:54
deadline: 2026-07-04
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1782981993.239489"
reporter: 박민지 팀장
reporter_slack_id: U05L44C5P50
assignee: agent-fdd-dev-foot
source_msg: MSG-20260702-174749-xqb8
db_change: no
db_change_reason: "예약관리 페이지에서 동일 예약의 등록자('진운선')가 정상 노출되므로 staff 데이터·스키마는 무결. TM집계 페이지의 등록자 조회 쿼리(도파민 경로=source_system TM 예약)에서 staff 조인/매핑 누락으로 추정. dev-foot 진단에서 데이터 조인 이슈로 판명돼도 read-only 쿼리 조정이며 스키마 무변. DB 무관 확정 시 db_change=no."
e2e_spec_exempt_reason: null
risk_verdict: GO
risk_reason: >
  (1/5) DB스키마: 없음(추정) — 등록자(staff) 데이터는 예약관리 페이지에 정상 노출되므로 데이터·스키마 무결. TM집계 페이지의 등록자 조회 쿼리 조인/매핑 수정으로 판단. 데이터 조인 이슈로 판명돼도 read-only 쿼리 조정(스키마 무변). DA CONSULT·대표게이트 불요(autonomy §3.1).
  (2/5) 외부의존: 없음 — 풋CRM 내 표시 쿼리. (도파민 push 경로는 이미 예약관리에 정상 반영됨 = 수신 정상)
  (3/5) 비즈로직: 없음 — 통계 표시(등록자명 렌더)만. 예약 생성·배정·상태전이 무접촉.
  (4/5) 대량데이터: 없음 — read-only 집계 조회.
  (5/5) 신규패키지: 없음.
  → GO. 파괴/RLS/스키마/대량 0. 표시측 조회 버그 1건.
conflict_detail:
  scan_sources: "board 진행티켓 / cross_crm_data_contract / 의존성 §7 / dev_ops_policy 환경매트릭스 대조"
  same_subject_open_tickets:
    - "T-20260702-foot-DOPAINGEST-PHONE-HOVER-MISSING [P1/foot/approved] — 같은 root 클러스터(도파민→풋 TM예약의 파생 필드가 풋 표시측 쿼리에 미탑재). 그쪽은 캘린더 호버의 phone, 본 건은 TM집계의 등록자(staff). 충돌 아님(상보 버그). dev-foot는 두 건이 동일 조인/매핑 결함에서 파생하는지 함께 진단 권장."
  redefinition_risk: false
  verdict: "clean — 파괴적 충돌 없음. 별개 페이지·필드(TM집계>등록자 vs 캘린더 호버>전화번호). 즉시 approved."
---

# T-20260702-foot-TMSTATS-DOPAMINE-REGISTRANT-MISSING

## 배경 (현장 요청)
- 요청자: 박민지 팀장 (C0ATE5P6JTH, thread 1782981993.239489)
- 화면: 통계대시보드 > TM집계 페이지 (obliv-foot-crm)
- 현상: **도파민을 통해 예약이 등록된 경우 등록자 이름이 TM집계 페이지에서 공란**으로 표시됨
- 대조: 동일 예약이 **예약관리 페이지에서는 등록자 '진운선'으로 정상 표시**됨
- 의심 원인: TM집계 페이지의 예약 등록자 조회 시, 도파민 연동 경로(cross-system 예약, source_system=TM)의 staff 정보를 가져오지 못함

## 진단 우선 (DIAGNOSE-FIRST)
데이터는 존재(예약관리 정상 노출)하므로, 원인은 **TM집계 페이지의 등록자 조회 경로**에 있음. 착수 전 실측:
1. 예약관리 페이지가 등록자('진운선')를 어떤 필드/조인으로 표시하는지 확인 (SSOT 경로)
2. TM집계 페이지가 등록자를 조회하는 쿼리/조인 확인 — 도파민 경로 예약(source_system=TM)에서 staff_id/created_by 가 NULL인지, 아니면 조인 대상이 다른지
3. 두 페이지의 staff 참조 경로 차이(예: 예약관리는 reservations.staff_id → staff 조인, TM집계는 별도 집계 뷰에서 staff 미탑재) 규명
4. sibling 티켓 DOPAINGEST-PHONE-HOVER-MISSING 과 동일 조인 결함 파생 여부 교차 확인

## AC (수용 기준)
- [ ] TM집계 페이지에서 **도파민 연동 예약건도 등록자 이름이 정상 표시**됨 (예: '진운선')
- [ ] 기존 풋CRM 직접등록 예약의 TM집계 등록자 표시 회귀 없음
- [ ] read-only 조회 변경만 — 예약 데이터 생성/수정 무접촉

## 현장 클릭 시나리오 (E2E 변환 가이드)
### 시나리오 1: 정상 동선
1. 로그인 → obliv-foot-crm 어드민
2. "통계대시보드" > "TM집계" 페이지 진입
3. 도파민 경로로 등록된 예약건(source_system=TM) 행 확인
4. 해당 행의 등록자 컬럼에 담당자 이름(예: '진운선')이 표시됨을 확인
5. 같은 예약을 "예약관리" 페이지에서 열어 등록자가 동일함을 대조 확인
### 시나리오 2: 회귀 방지
1. 풋CRM에서 직접 등록한 예약(source_system≠TM) 행 확인
2. TM집계 페이지 등록자 컬럼이 기존과 동일하게 정상 표시됨을 확인

## 참고
- Cross-CRM Contract: staff role / source_system(TM=도파민 생성 예약) 정의 참조
- sibling: T-20260702-foot-DOPAINGEST-PHONE-HOVER-MISSING (같은 도파민→풋 표시측 누락 클러스터)

## QA 결과 (supervisor)
- 코드 변경/커밋이 확인되지 않아 QA 진행 불가. 구현 반영 후 deploy-ready 재갱신 필요.
- 근거: git log --grep "TMSTATS-DOPAMINE-REGISTRANT" 결과 없음, 작업 트리 clean 상태.
