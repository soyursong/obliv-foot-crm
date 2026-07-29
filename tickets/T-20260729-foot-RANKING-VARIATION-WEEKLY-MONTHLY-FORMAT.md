---
id: T-20260729-foot-RANKING-VARIATION-WEEKLY-MONTHLY-FORMAT
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
qa_result: pass                                   # dev self-QA: playwright 12/12 PASS (신규 6 + 6SPEC 회귀 6) + vite build OK
deploy_commit: 1dcce8f5                            # branch T-20260729-foot-RANKING-VARIATION-WEEKLY-MONTHLY-FORMAT HEAD (supervisor merge 시 갱신)
deployed_at: "n/a (NOT yet deployed — branch push only; supervisor merge → main → CF Pages auto-deploy)"
bundle_hash: "n/a (merge 후 obliv-foot-crm.pages.dev/version.json 로 검증)"
build-passed: true
db-change: false
data_consult_gate: "not_required — 신규 컬럼·테이블·enum 0. 월간 변동표 전월매출은 기존 payments RPC(foot_stats_consultant_admin / fetchConsultantPerf) 를 전월 구간 인자로 1회 추가 호출하는 순수 READ 파생. 신규 저장 없음 → §S2.4 데이터 정책 자문 게이트 비대상."
e2e-spec: "tests/e2e/T-20260729-foot-RANKING-VARIATION-WEEKLY-MONTHLY-FORMAT.spec.ts 신규 6-case (S1 전월 경계 산출[월/연 경계 안전] · S2 월간 변동 파생[전월 순위 vs 당월 순위·↑N/↓N/-·오름차순] · S3 엣지[전월 0매출 신규실장·순위유지·빈랭킹] · STATIC 소스구조[월간 카드+공통 컴포넌트+행 포맷 재편] · REGRESS[admin 잠금+주간표 불변]). + 기존 T-20260727-6SPEC STATIC 회귀 갱신(변동표 공통 컴포넌트 추출 반영). 12/12 PASS. 실렌더 클릭(갤탭)·라이브 매출정합은 supervisor QA 커버."
summary: "[랭킹] 탭 '실장별 랭킹 변동' 표 보완 2건. 작업1 월간 변동표 추가 — '실장별 랭킹 변동(월간)' = 전월(1일~말일) 매출 순위 vs 당월(1일~선택일) 매출 순위. 당월 순위 = perfRows(월매출) 재사용(재산정 없음), 전월매출 = fetchConsultantPerf 동일 엔진 READ 파생(전월 구간 1회 추가 병렬 read) → 신규 저장 0. 작업2 행 포맷 재편(주간·월간 공통) — [실장명 → 변동(↑N/↓N/-) → 이번(당월) 순위 → 전(전월/전주) 순위], 예 `엄경은 ↑1 | 1위 | 2위`, 이번(당월) 순위 오름차순. ★divergence 가드: 병렬 신규 변동표 컴포넌트 금지 → 주간/월간을 단일 VariationTable 컴포넌트로 렌더(포맷 단일 소스). durable marker=assignments-ranking-variation-card(주간 유지)/ranking-variation-delta, 월간 카드=assignments-ranking-variation-card-monthly(주간 카드 아래 세로 스택). R1 매출정합(재직 실장·풋 payments·clinic·deleted_at 제외) 동일 엔진으로 월간 계승."
created: 2026-07-29
reporter: planner
parent: MSG-20260729-173620-708r
commit: PENDING_SUPERVISOR_MERGE
open_questions_resolved: "OQ1(월간 순위 근거) — '전월 총매출 순위 vs 당월(1일~선택일) 매출 순위' 파생 = YES. 기존 월매출 엔진(fetchConsultantPerf, foot_stats_consultant_admin RPC)에서 READ 파생 가능 = YES (당월=perfRows 재사용, 전월=전월 구간 인자 추가 호출). 신규 저장 불요 → db_change=false 확정, DA CONSULT/planner FOLLOWUP 불필요. OQ2(배치) — 기존 레이아웃 관행(카드 세로 스택) 준수 → 월간 카드를 주간 카드 바로 아래 배치(상하)."
files_changed: "src/pages/Assignments.tsx (rankingRanges 전월 경계 추가 · VariationRow 모듈 hoist · VariationTable 공통 컴포넌트 추출 · prevMonthRevenue state + 7번째 병렬 read · monthVariationRows memo · 렌더 2 인스턴스 치환) · tests/e2e/T-20260729-foot-RANKING-VARIATION-WEEKLY-MONTHLY-FORMAT.spec.ts (신규) · tests/e2e/T-20260727-foot-RANKING-TAB-DATEPICKER-6SPEC.spec.ts (STATIC 회귀 갱신)"
medical_confirm_gate: not_applicable            # [랭킹]/Assignments = 실장 배정·랭킹(비의료). 진료대시보드/진료관리 아님 → §11 게이트 비대상.
---

# T-20260729-foot-RANKING-VARIATION-WEEKLY-MONTHLY-FORMAT

planner NEW-TASK 이행 (in-reply-to MSG-20260729-173620-708r). 현장=김주연 총괄(C0ATE5P6JTH).

## 작업 내역

### 작업1 — 월간 변동표 추가
- 신규 카드 '실장별 랭킹 변동 (월간)' = 전월(1일~말일) 매출 순위 vs 당월(1일~선택일) 매출 순위.
- **db_change=false 확정**: 당월 순위는 기존 `perfRows`(월매출 1일~선택일) 재사용(재산정 없음).
  전월매출은 `fetchConsultantPerf(clinicId, prevMonthStart, prevMonthEnd)` — 기존 payments RPC
  (`foot_stats_consultant_admin`) 동일 엔진에 전월 구간을 인자로 넣은 1회 추가 병렬 READ.
  신규 컬럼·테이블·저장 0. R1 매출정합(재직 실장 필터·풋 payments·clinic 필터·deleted_at 제외)이
  `fetchConsultantPerf` 내부에 이미 구현되어 있어 월간 순위 산정에 그대로 계승.
- `rankingRanges()` 에 전월 경계(prevMonthStart=전월 1일, prevMonthEnd=당월 1일 하루 전=전월 말일)
  추가. 월/연 경계 넘김 안전(2월 28일·1월→전년 12월 검증).

### 작업2 — 행 포맷 재편 (주간·월간 공통)
- 컬럼 순서: [실장명 → **변동(↑N/↓N/-)** → 이번(당월) 순위 → 전(전월/전주) 순위].
  현행 [전주|이번주|변동] → 변동을 이름 옆으로, 이번/현재 순위를 앞으로.
- 예시 렌더: `엄경은 ↑1 | 1위 | 2위`. 이번(당월) 순위 오름차순 정렬(기존 동일).
- delta = prevRank − thisRank ( >0 상승 ↑N emerald / <0 하락 ↓N red / 0·null 유지 - muted).

## ★divergence 가드 (CHART-ORDER R2 좀비 교훈)
- **병렬 신규 변동표 컴포넌트 작성 금지** 준수 → 주간/월간을 단일 `VariationTable` 프레젠테이션
  컴포넌트로 렌더. 행 포맷을 단일 소스로 수렴 → 주간·월간 포맷 divergence 원천 차단.
- durable marker 유지: `assignments-ranking-variation-card`(주간 카드 인스턴스, cardTestId prop),
  `ranking-variation-delta`(공통 컴포넌트 내 렌더). 월간 카드는
  `assignments-ranking-variation-card-monthly`(주간 카드 바로 아래 세로 스택).

## 오픈 질문 해소
- **OQ1(월간 순위 근거)**: '전월 총매출 순위 vs 당월(1일~선택일) 매출 순위' 파생 = 맞음.
  기존 월매출 엔진에서 READ 파생 가능(신규 저장 불요) → db_change=false 유지, DA CONSULT·
  planner FOLLOWUP 불필요.
- **OQ2(배치)**: 기존 레이아웃 관행(카드 세로 스택) 우선 → 월간 카드를 주간 카드 바로 아래(상하).

## 검증
- Playwright 12/12 PASS (신규 6-case + 기존 6SPEC 회귀 6). vite build OK.
- 회귀 가드: 랭킹 탭 admin 전용 잠금(canViewRanking) 불변, 주간 변동표(variationRows) 파생 불변.
- 미검증 잔여(supervisor QA): 갤탭 실브라우저 렌더·클릭, 라이브 전월/당월 매출 정합 스팟체크.

## baseline
- 현행 주간표 스샷: ~/file_inbox/20260729/173313_F0BLNLYHLDA_20260729_172537.png
