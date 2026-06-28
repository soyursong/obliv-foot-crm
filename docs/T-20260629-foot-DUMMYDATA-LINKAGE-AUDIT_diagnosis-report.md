# T-20260629-foot-DUMMYDATA-LINKAGE-AUDIT — 진단 리포트 (Phase 1, READ-ONLY)

- **작성**: dev-foot · 2026-06-29 (Asia/Seoul)
- **레포**: obliv-foot-crm · Supabase rxlomoozakkjesdqjtvd
- **쓰기**: 0건 (prod 무영향). 본 티켓은 진단만. 2차 수정은 분할 티켓에서.
- **재현 스크립트**: `scripts/T-20260629-foot-DUMMYDATA-LINKAGE-AUDIT_diag{,2,3}.mjs` (SELECT only)
- **현장 호소(풋센터 원장)**: 한 환자의 한 방문일 기준 방문이력·상담차트·진료차트·진료경과 4축이 정합되게 묶여야 하는데, 각 축이 따로 논다 (ex. 진료경과 1건·상담기록 다수·방문이력 0건).

---

## 0. 결론 요약 (TL;DR)

> **호소 현상은 "더미데이터 DB 연결성 결함"이 아니라, 실고객에서도 동일하게 재현되는 구조적 문제다.**
> 4축은 애초에 **공통 앵커(visit_id / reservation_id / check_in_id)로 묶이도록 설계된 적이 없다.** 각 축은 `customer_id`(+느슨한 날짜)만 공유하며 독립 저장된다. 여기에 **화면 렌더 필터 2종**이 겹쳐 "방문이력 0 / 상담 다수"라는 비대칭을 만든다.

근인은 **단일이 아니라 3겹**이며, "시드가 독립 난수로 찍는가 vs 스키마 FK 부재인가"의 답은 **둘 다 — 단 1차 근인은 스키마/렌더, 시드는 증상을 가린 2차 요인**이다.

| # | 근인 | 층위 | 영향 |
|---|------|------|------|
| RC-1 | `medical_charts`에 `check_in_id`/`reservation_id` FK 컬럼 **부재** → 진료차트·진료경과가 방문(check_in)과 행 단위로 안 묶임. `customer_id + visit_date`로만 느슨하게 연결 | **스키마** | 4축 결속 불가의 근본 |
| RC-2 | `visibleVisitHistory` 렌더 필터 (`MedicalChartPanel.tsx` L746-753): `treatment_kind`·`treatment_memo.details`·`doctor_note`가 **모두 빈** check_in 행을 방문이력에서 숨김 | **렌더(FE)** | "방문이력 0" 직접 원인 |
| RC-3 | 상담기록 탭(`ConsultRecordTab.tsx`)은 동일 check_ins를 **필터·날짜창 없이 전부** 노출 (status≠cancelled) | **렌더(FE)** | "상담 다수" 직접 원인. RC-2와의 비대칭이 "따로 논다"는 체감 생성 |
| RC-4 | 더미 시드 스크립트가 4축을 **교차 FK 없이 독립 INSERT** (check_ins.reservation_id 미설정, medical_charts 별도 생성) | **시드** | 더미에서 결속 부재를 그대로 복제. 단 현 더미는 필드 충진율 100%라 증상이 가려져 있음 |

---

## 1. 4축 테이블·FK·연결 키 매핑표

각 축이 **실제로 어떤 키로 묶이는지** (설계 의도가 아니라 현재 스키마·쿼리 기준):

| 화면 축 | 소스 테이블 | 행을 잡는 앵커(현재) | 다른 축과의 FK | 로드 쿼리 |
|---------|------------|---------------------|----------------|-----------|
| **방문이력** | `check_ins` | `customer_id` (+ `visibleVisitHistory` 렌더 필터) | `reservation_id` 컬럼 **존재**하나 더미 15/15 NULL, 실데이터도 대부분 미연결 | `MedicalChartPanel.tsx` L589 `from('check_ins').eq('customer_id', …)` |
| **상담차트(상담기록)** | `check_ins` (동일 테이블) | `customer_id` only, 필터 없음 | 위와 동일 행. 날짜 그룹핑만, 날짜창 없음 | `ConsultRecordTab.tsx` L132 `from('check_ins')…order(checked_in_at desc)` |
| **진료차트** | `medical_charts` | `customer_id + clinic_id`, `order(visit_date desc)` | **check_in_id / reservation_id 컬럼 자체 없음** → 방문과 행 매칭 불가 | `MedicalChartPanel.tsx` L817 `from('medical_charts').eq('customer_id',…).eq('clinic_id',…)` |
| **진료경과** | `medical_charts.clinical_progress` (동일 테이블 컬럼) | 진료차트와 동일 행 | 동일(없음) | 위와 동일 |
| (상위 앵커) | `reservations` | `customer_id`, `reservation_date` | `check_ins.reservation_id` 로 자식 연결 가능하나 현장/더미 미사용 | — |

### 핵심 관찰
- **방문이력과 상담차트는 같은 `check_ins` 테이블의 같은 행**이다. 두 화면이 갈라지는 건 데이터가 아니라 **렌더 필터 차이**(RC-2 vs RC-3) 때문.
- **진료차트와 진료경과는 같은 `medical_charts` 행**(진료경과 = `clinical_progress` 컬럼)이다.
- 따라서 진짜 "4축"은 물리적으로 **2개 테이블(check_ins, medical_charts)**이며, 이 둘을 묶는 행 단위 FK가 **없다**. `customer_id + 같은 날짜`라는 암묵 규약에만 의존.

`medical_charts` 실제 컬럼 (2026-06-29 스키마 덤프):
```
id, customer_id, clinic_id, visit_date, chief_complaint, diagnosis,
treatment_record, materials_used, treatment_result, created_by, created_at,
updated_at, clinical_progress, prescription_items, created_by_name,
signing_doctor_id, signing_doctor_name, signing_doctor_seal_url
```
→ `check_in_id` **부재 확정** (`column medical_charts.check_in_id does not exist`).

---

## 2. 환자 × 날짜 4축 카운트 — 결손 규모·패턴

### 2-A. 더미데이터 (is_simulation=true, 16명)
| 축 | 더미 총건 | 패턴 |
|----|-----------|------|
| reservations | **1건** | 16명 중 1건만 — 방문 동선 상위 앵커가 사실상 비어 있음 |
| check_ins | 15건 | 환자당 1건. `reservation_id` **15/15 NULL** (예약↔방문 미연결) |
| medical_charts | 15건 | check_in과 **같은 날짜로 정렬**(date-anchor 정합 15/15) — 우연히 맞음, FK로 묶인 게 아님 |
| check_ins 필드 충진 | treatment_kind·memo.details·doctor_note 각 **15/15 (100%)** | → `visibleVisitHistory` 통과 15/15. 더미에선 "방문이력 0" **미재현** |

- 더미 부작용: check_ins 13/15가 **오늘 이후 + active status**(registered/laser/consultation…) → 셀프접수 대기명단·라이브큐 **오염 위험** (0617 불변식#5 관련). 별도 추적 필요.
- 더미 고객당 check_in 분포 `{1:15}` → "상담 다수"도 더미에선 미재현.

> **더미 단독 판정**: H1(check_ins 0건)·H2(필드 빔으로 숨김) **둘 다 반증**. 현 더미는 4축이 다 채워져 있고 날짜도 맞아 호소 현상이 재현되지 않는다. 즉 **"더미 DB 연결성 결함"이라는 가설은 현 더미에는 해당 없음.**

### 2-B. 실고객 (is_simulation=false, 458명) — 호소 현상 재현
| 환자 | 예약 | 방문(check_ins) | 방문이력 노출(필터통과) | 진료차트 | 상담기록 노출 |
|------|------|------|------|------|------|
| 김민경 | 30 | 28 | **0** | 1 (visit_date 06-08) | 27 |
| 장예지 | 23 | 19 | **0** | 1 (06-15) | 15 |
| 김지혜 | 10 | 8 | **0** | 0 | 6 |
| 박민석 | 20 | 19 | (혼재) | 3 | 19 |
| 김사비 | 11 | 7 | — | 1 | — |

→ **"방문이력 0 / 상담 다수 / 진료차트 소수"는 실고객에서 정확히 재현.** 원인은 check_ins 행이 없어서가 아니라, **treatment 필드가 비어 `visibleVisitHistory`에서 숨겨지기 때문**(RC-2). 같은 행이 상담기록 탭에선 필터 없이 다 보임(RC-3).

---

## 3. 근인 판정 (planner 질문 #3 직접 답변)

> **Q. 시드 생성 로직이 4축을 독립 난수로 찍는가 vs 스키마 FK 자체가 부재한가?**
> **A. 스키마 FK 부재가 1차 근인이고, 시드 독립 INSERT는 그 위에 얹힌 2차 요인이다.**

### 3-A. 스키마 FK 부재 (1차) — 확정
- `medical_charts`에 `check_in_id`/`reservation_id` **컬럼 없음**. 진료차트·진료경과를 특정 방문(check_in)에 못 박을 구조가 없다.
- `check_ins.reservation_id`는 **존재하나** 시드·현장 모두 거의 미설정(더미 15/15 NULL).
- 결과적으로 4축 결속은 `customer_id + 같은 날짜` 암묵 규약뿐 → 같은 날 방문이 여러 건이면 어느 진료차트가 어느 방문인지 **시스템이 알 수 없음.**

### 3-B. 시드 독립 INSERT (2차) — 확정 (코드 증거)
`scripts/seed_testdata_20260604.mjs` (대표 시드) 분석:
- 재진 고객: `reservations` 1건 + `check_ins` 1건(과거, status=done)을 **각각 독립 INSERT**, `check_ins.reservation_id` **미설정**.
- `medical_charts`(진료차트/진료경과)는 **아예 생성 안 함**.
- 초진 고객: check_in 미생성.
→ 시드는 4축을 **교차 FK 없이** 찍는다(난수라기보단 고정값이지만 "축 간 비연결"은 동일). 현재 prod 더미(16명)는 이 시드가 아닌 후속 보정 스크립트 산물이라 필드는 채워졌으나, **교차 FK 부재 패턴은 그대로 상속**.

### 판정 정리
- **순수 더미 DB 연결성 결함은 아님** — 현 더미는 4축 카운트·날짜가 맞음.
- **진짜 결함은 (1) 스키마에 행 단위 FK가 없고 (2) 렌더 필터가 빈 방문을 숨겨** 실고객에서 비대칭이 보이는 것.
- 시드는 이 구조를 복제하지만 증상을 만들지는 않음(필드가 차 있으면 숨김 안 됨).

---

## 4. 개선안 옵션 (2차 티켓용 — 본 티켓 범위 외)

| 옵션 | 내용 | 해소 근인 | 게이트 |
|------|------|----------|--------|
| **A. 시드 재생성** | 더미 시드를 4축 교차 FK 포함·날짜 정합으로 재작성(check_ins.reservation_id 채움, medical_charts를 check_in 날짜에 정합 생성). **라이브큐 오염 방지**(과거일자·done status 고정) 포함 | RC-4 | 데이터만. prod 더미 재시드 시 supervisor 통보 |
| **B. 스키마 FK 보강** | `medical_charts.check_in_id`(nullable, ADDITIVE) 추가 + `check_ins.reservation_id` 백필. 4축을 행 단위로 결속 | RC-1 | **data-architect CONSULT + supervisor DDL-diff 필수**(신규 컬럼). `medical_charts`=의사 도메인 → **§11 medical_confirm_gate 대상**(문지은 대표원장 컨펌) |
| **C. A+B 동시** | 스키마 FK 보강 후 시드를 FK 기반으로 재생성. 근본 + 더미 동시 정합 | RC-1+RC-4 | B의 게이트 모두 |
| **(별건) D. 렌더 필터 정합** | `visibleVisitHistory`(RC-2)와 `ConsultRecordTab`(RC-3)의 노출 기준 불일치 재검토 — "방문이력 0/상담 다수" 비대칭의 **직접 체감 원인**. 데이터 안 건드리고 UX만 정합 | RC-2/RC-3 | `MedicalChartPanel`=진료관리 surface → **§11 medical_confirm_gate 대상**. 원장 의도(빈 행 숨김은 T-20260609 의도된 동작)이라 **변경 전 원장 재확인 필수** |

### 권고
- **단기 체감 개선**은 옵션 D(렌더 정합)가 가장 효과적이나, 빈 행 숨김은 원장이 의도한 동작(T-20260609-VISITLOG-EMPTYROW-HIDE)이므로 **원장 컨펌 없이 손대지 말 것.**
- **근본 해결**은 옵션 C이나 스키마 변경(B)이 의사 도메인 + ADDITIVE → DA CONSULT + DDL-diff + 원장 컨펌 3중 게이트.
- 옵션 A 단독은 더미만 깨끗해지고 실고객 비대칭은 그대로라 **현장 호소를 못 닫음** → 비권장.

---

## 5. 게이트·핸드오프 메모 (planner용)

- 본 티켓 = **진단 종료**. 쓰기 0. deploy-ready = 리포트 산출만.
- 2차 티켓 분할 시:
  - 옵션 B/C/D는 모두 `medical_charts`·`MedicalChartPanel`(진료관리/진료차트) = **의사 도메인 → §11 medical_confirm_gate: required + confirm_status 확정 선행.** dev-foot는 confirmed 전 해당 코드 미착수.
  - 옵션 B/C는 신규 컬럼 → **data-architect CONSULT + supervisor DDL-diff** 선행.
  - 옵션 A는 라이브큐 오염 방지(2-A 부작용) 반드시 포함.
- 더미 check_ins 라이브큐 오염(13건 active/오늘 이후)은 **별도 P1 추적 권고** (0617 DUMMY-CHECKIN-POLLUTION 라인 재발 신호).
