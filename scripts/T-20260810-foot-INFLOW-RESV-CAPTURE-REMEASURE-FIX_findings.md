# T-20260810-foot-INFLOW-RESV-CAPTURE-REMEASURE-FIX — 진단 findings (READ-ONLY)

**결론: 근본원인 = 도파민/TM ingest leg (예약 66%, 캡처 0%) → foot-FE 범위 밖. CARVE to planner/DA.**
foot 측 잔여(STEP2 미머지·키오스크 candidate)는 secondary·marginal.

## 0. 실행 메타 (deliverable 계약 준수)
- **인증컨텍스트**: Supabase Management API PAT (`SUPABASE_ACCESS_TOKEN`, `.env.local`) = **service-role-equivalent, RLS bypass, 전건 read**. 전 쿼리 SELECT-only. **WRITE 0 · DDL 0**.
- **§36 방화벽**: read 대상 = `inflow_channel`(§36① canonical) + `first_inflow_channel` + `inflow_channel_self_reported`(candidate) + `checklist_data->>'referral_source'` 키 **존재여부 count만**(값 read 아님). `referral_source`(§36③ freeze) **무접점**.
- **더미번호 조인 0**: 조인은 전부 `customer_id`(UUID FK) / `check_in_id`(UUID FK)만. phone 조인 없음.
- 스크립트: `scripts/T-20260810-foot-INFLOW-RESV-CAPTURE-REMEASURE_census.mjs`, `..._candidate_probe.mjs`.

## 1. 재실측 (full table, 2026-08-10)

| 지표 | total | filled | pct |
|---|---|---|---|
| C1 reservations.inflow_channel 전체 | 1988 | 29 | **1.5%** |
| C8 최근 30일 reservations | 1600 | 29 | 1.8% |
| C6 check_ins.inflow_channel (canonical) | 948 | 5 | 0.5% |
| C6 check_ins.inflow_channel_self_reported (candidate) | 948 | **0** | 0.0% |
| C7 customers.first_inflow_channel (상속 원천) | 1692 | 31 | **1.8%** |
| checklists (키오스크 태블릿 제출) | **0** | — | — |

> ⚠ **DA 20.9%(32/153) vs full-table 1.5%(29/1988) 분모 발산**: DA 측 분모 153 은 full-table 아님(최근 신규-비광고 manual 코호트 슬라이스로 추정 — 배선주면 forward 채움 14.9% 와 정합). **DA 원 쿼리 슬라이스 공유 요청**(reconcile). 단, 어느 분모든 **구조적 결론 동일**.

## 2. 저장경로 split (deliverable c)
- **canonical reservations.inflow_channel**: 29 (전 캡처의 주경로).
- **canonical check_ins.inflow_channel**: 5 (walk-in 스태프커밋 NewCheckInDialog).
- **키오스크 candidate (check_ins.inflow_channel_self_reported)**: **0** — `checklists` 테이블 전건 0-row = 태블릿 사전체크리스트 **프로덕션 트래픽 전무**. RPC(`fn_complete_prescreen_checklist`)는 `referral_source`→candidate write 로직 **정상 존재**(코드 결함 아님) — **미사용(0 adoption)**. ⇒ candidate ≠ canonical 혼동 없음, candidate 기여도 = 0.
- **notes**: inflow 관련 notes 착지 경로 없음(별도 컬럼 candidate 로만 설계).

## 3. 코호트 split (deliverable, 신규-비광고 vs 재진 vs 도파민)

| 코호트 | total | filled | pct | 비고 |
|---|---|---|---|---|
| **도파민(created_via/source_system=dopamine)** | **1315** | **0** | **0.0%** | 전 예약의 **66%**. visit_type=new 1314 + returning 1 |
| 신규-비광고 (visit_type=new, manual/null) | 284 | 26 | 9.2% | manual 175→26(**14.9%**, 배선주면), null 109→0 |
| 재진 (visit_type=returning, 非dopamine) | 389 | 3 | 0.8% | manual 298→3, null 91→0. 드롭다운 미렌더+상속원천 空 |

## 4. optional skip 채택률 (deliverable b)
필수-선택 게이트는 다음에서 **구조적으로 우회**되어 null-inflow 저장 진행:
- 도파민/quick-add/copy 주면: 게이트 **부재**(dropdown 미렌더) — 1515건.
- 재진(returning) 주면: dropdown 미렌더 + 상속(`first_inflow` 1.8%뿐)으로 사실상 null.
- `useInflowChannels.available===false`(RPC 미가용) 시 게이트 완화.
⇒ 실질 **~98.5% 예약이 null-inflow 로 저장**(1959/1988). 게이트는 "2개 배선주면 × 신규고객"에만 발동.

## 5. render 여부 (deliverable a) — origin/main 기준 (Explore 감사)
- **데스크 예약생성 주면**: 6개 INSERT 주면 中 **2개만 배선**(NewCheckInDialog check_ins, Reservations 팝업 신규). **4개 미배선**(Dashboard 빠른추가, CustomerChart mini/inline 재진, Ctrl+V copy) = STEP2 브랜치(`feat/T-20260810-foot-INFLOW-RESV-COVERAGE-COMPLETE`)에 있으나 **main 미머지**.
- **키오스크 접수화면(TabletChecklistPage)**: referral 질문 렌더 O, candidate 컬럼(`inflow_channel_self_reported`)에만 착지(canonical 무접점=설계대로). 단 트래픽 0.

## 6. 근본원인 분해 & disposition

| # | 원인 | 규모 | foot-FE 범위? | disposition |
|---|---|---|---|---|
| **P1 (dominant)** | 도파민 ingest EF 가 `inflow_channel` server-side auto-stamp 미구현 | **66% 예약·0% 캡처** | **아니오** (dopamine 도메인 EF + DA 정책) | **CARVE → DA CONSULT** (reservation-ingest-from-dopamine EF TM auto-stamp 정책·값) |
| P2 | STEP2 4개 데스크 주면 미머지 | 재진/quick-add lane | 예 | foot fix child 후보(단 **marginal** — 상속원천 `first_inflow` 1.8%뿐이라 상속 ≈0) |
| P3 | 키오스크 candidate 0 트래픽 | 0 | 코드결함 아님 | note only (adoption/rollout 사안) |

**핵심**: 이 red 는 **FE 배선 누락(STEP2)이 주원인이 아니다.** STEP2 자체가 self-documented 한 대로, 분모 지배축(도파민 66%)은 server-side EF auto-stamp 부재이며 이는 **DA 정책 판정 + dopamine/EF 도메인 구현** 사안 → foot-FE 배선만으로 aggregate 개선 불가. STEP2 를 머지해도 상속 원천(`customers.first_inflow_channel` 1.8%)이 비어 재진 캡처는 ≈0.

## 7. 권고 (planner)
1. **P1 CARVE**: dopamine reservation-ingest EF 의 `inflow_channel` auto-stamp 를 **DA CONSULT** 로 승격(정책: TM 이 어떤 값으로 canonical stamp? cross-CRM §36 축). = 유일한 aggregate 개선 레버.
2. **P2 foot fix child (선택·marginal)**: STEP2 `feat/T-20260810-foot-INFLOW-RESV-COVERAGE-COMPLETE` 머지 승인 여부 planner 판단. 단 상속원천 空 → 효과 제한적임을 명시.
3. **DA reconcile**: 20.9%(32/153) 원 쿼리 슬라이스 공유 요청.
