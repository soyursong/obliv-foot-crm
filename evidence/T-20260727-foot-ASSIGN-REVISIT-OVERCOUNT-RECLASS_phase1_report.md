# T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE — Phase 1 진단 결과 (READ-ONLY)

- 도메인: foot / clinic: **jongno-foot** (오블리브의원 서울오리진점, `74967aea-a60b-4da3-a0e7-9c997a930bc8`)
- 창: **2026-07-01 ~ 2026-07-27 KST** (직원별 누적 [당월누적] = 오늘(07-27) 당월, `Assignments.tsx` 로직과 동일 경계)
- 실행: READ-ONLY SELECT only (`scripts/..._probe.mjs` — 변형 키워드 코드-게이트 차단). **UPDATE/DDL 0건. db_change=false.**
- 백필 SOP 준수: 단일 count 판정 금지 → 레코드별 판정근거 evidence 스냅샷 동봉 + freeze셋 고정 + sha256 지문.

## 1. 버그경로 지문 재현 (현장 수치와 정합)
현장 보고 재진 카운트(41/46/41/38/54/6)를 코드 경로 그대로 재현 → **완전 일치**.

| 상담실장 | 재진 카운트(현장=재현) | KEEP(찐재진) | RECLASS(재분류후보) |
|---|---|---|---|
| 정연주 | 54 | 3 | 51 |
| 엄경은 | 46 | 0 | 46 |
| 김지윤 | 41 | 3 | 38 |
| 송지현 | 41 | 1 | 40 |
| 강경민 | 38 | 1 | 37 |
| 김주연 | 6 | 0 | 6 |
| 김수린 | 3 | 0 | 3 |
| **합계** | **229** | **8** | **221** |

## 2. ★ 근본원인 (RC) — 재진 과다집계의 정체
"배정(재진)" 카운트 = 7월 check_ins 중 **effective visit_type='returning'** 이고 상담실장이 배정된 건.
effective visit_type 결정 = `Assignments.tsx monthAxisOf` → `deriveConsultAxis({visit_type: cu?.visit_type ?? ci.visit_type})`
여기서 `cu.visit_type` 는 **런타임 recency 재판정**(`resolveVisitTypesByRecency`, 365일·done·`< 오늘자정`) 결과로 override 된 값.

**핵심 결함**: recency 판정이 **고객 단위**로, **"오늘 자정 이전의 done 방문이 하나라도 있으면 returning"** 으로 본다.
그런데 이 창은 **판정 대상 check_in 자기 자신(과거 날짜의 첫 방문)** 을 배제하지 못한다.
→ **오픈(2026-01) 이후 첫 방문이 이미 [완료]된 신규 고객**은, 그 첫 방문 자체가 "과거 done" 으로 잡혀 **자기-오염으로 재진 승격**.
(T-20260715 SAMEDAY 가드는 "당일" 만 배제 → "과거 날짜의 첫 방문" 은 그대로 통과.)

부가로 **stored 오염도 병존**: `customers.visit_type` = jongno 309건이 'returning' 으로 **영구 승격**(레거시 "완료 시 영구 returning 승격" 정책 잔재). recency override 가 이를 일부만 되돌림(stored 기준 241 → recency 기준 229).

데이터 근거:
- jongno 전체 done check_ins = 331건, 그 중 **283건이 7월**. 최초 check_in = 2026-01-01 (신규 오픈원).
- 재진-판정 고객 221명 중 **214명이 이전 방문/예약 이력 전무한 순수 초진**.

## 3. ★★ Phase 2 필독 경고 (rc_first — 데이터 UPDATE 단독은 false fix)
표시 카운트는 **런타임 recency 재파생**이 정본 소스다.
→ **`check_ins.visit_type` 또는 `customers.visit_type` 를 UPDATE 해도 화면 재진 카운트는 그대로다.**
   (recency override 가 고객의 7월 done 방문에서 'returning' 을 매번 다시 계산해 stored 값을 덮어씀.)
→ 따라서 Phase 2 의 "visit_type 필드만 UPDATE" 전제만으로는 **표시 과다집계가 교정되지 않음.**

**교정에 반드시 필요(택1 또는 병행)**:
1. **코드 수정(정본)**: recency 판정 경계를 "오늘 자정" 이 아니라 **"판정 대상 check_in 자기 시각"** 으로 (자기·동일/후속 방문 배제). = 초진/재진의 시점정합 판정. → 이후 stored 백필은 표시와 무관한 정합 보조.
2. 또는 카운트 로직을 stored 필드 기준으로 되돌리고 stored 를 정합 백필(단, recency-unify 설계 취지 후퇴).

→ **데이터 freeze셋(§4)은 확정하되, Phase 2 authorize 시 위 코드축을 반드시 포함해야 함.** planner 재량 판단 요청.

## 4. 산출 2리스트 + freeze셋
- **[찐 재진] KEEP = 8건** → `evidence/..._KEEP.json` (각 건 이전 done 방문일·evidence record_id 동봉. 최다 사례 = 이전 done 15회 since 2026-05-20 — 명백한 실재 재진. 환자 실명/차트번호는 PHI §4.3 미포함, confirm 시 record_id 로 해석).
- **[재분류 후보] RECLASS = 221건** → `evidence/..._FREEZE_reclass_recordids.json` (**freeze 고정**)
  - `RECLASS_clean` (이전 방문·예약 전무) = **214건**
  - `RECLASS_EDGE_priorNondoneVisit` (이전 *미완료* 방문 존재 = 왔지만 done 아님) = **5건** ⚠총괄 확인 권장
  - `RECLASS_EDGE_priorResvOnly` (이전 예약만 존재, 완료방문 없음) = **2건** ⚠총괄 확인 권장
- 전체 판정근거 = `evidence/..._phase1_full.json` (229행, 레코드별 prior_done/prior_any_visit/prior_resv 스냅샷).

### freeze셋 지문 (Phase 2 rows-affected 검증 기준)
- freeze_count = **221**
- freeze_sha256 = `f4c0879cbac211bf...` (record_ids 정렬 join sha256; 전문은 FREEZE 파일)
- Phase 2 UPDATE 시: rows-affected == 221 (초과/미달 abort), freeze셋과 record_id 완전일치.
- 원장(payments/service_charges) 무접점 — visit_type 축만.

## 5. 판정 정의 (재현 가능)
- "찐 재진(KEEP)" = 해당 배정 check_in 시각 **이전에** 동일 phone-그룹(중복 고객행 포함)의 **완료(status='done') 방문**이 1건 이상 존재.
- "재분류 후보(RECLASS)" = 위 이전 완료방문 0건. (= recency 가 자기/후속 방문으로 재진 오승격한 건.)
- phone 그룹핑으로 중복 등록(동일인 다중 customer row)까지 교차 확인 → 이전방문 누락 방지.
