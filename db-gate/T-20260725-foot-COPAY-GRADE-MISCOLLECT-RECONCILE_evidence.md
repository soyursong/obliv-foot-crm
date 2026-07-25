# T-20260725-foot-COPAY-GRADE-MISCOLLECT-RECONCILE — Stage 1~3 진단 evidence (READ-ONLY)

- **티켓**: T-20260725-foot-COPAY-GRADE-MISCOLLECT-RECONCILE (P1, diagnose-first)
- **근거**: CEO-DECISION MSG-20260725-163902-0c0w (B안 carve-out 승인)
- **실행**: 2026-07-25 · dev-foot · **READ-ONLY (REST GET only, UPDATE/refund 0건)**
- **대상 DB**: prod `rxlomoozakkjesdqjtvd` (VITE_SUPABASE_URL) · 인증컨텍스트 = **service_role (RLS bypass)** → 0-row = 실제 무데이터, RLS 마스킹 아님 (진단 인증컨텍스트 표준 준수)
- **재현 스크립트**: `scripts/T-20260725-foot-COPAY-GRADE-MISCOLLECT-RECONCILE_census.mjs`

---

## 0. 오산 window 확정

| 경계 | 값 | 근거 |
|------|----|----|
| window 시작 | 등급분기(0.14/0.15) 최초 존재 = 급여청구 최초 시점 | `getBaseCopayRate` low_income_1/2=0.14, medical_aid_2=0.15 는 grade 시스템 도입 이래 상수 |
| window 종료 | **2026-07-21 04:21:18 KST** | calc_copayment v1.6 prod 실적용(`..._apply_evidence.md`) — low_income_1→면제0 / low_income_2·medical_aid_2→정액1,000 교정 배포 |

**정정후 SSOT 로직 (재계산 기준, calcCopayment v1.6 = `src/lib/copayCalc.ts::copayFromBase`)**
- `low_income_1` → **0원 (면제)** — 종전 0.14 오적용
- `low_income_2` → **LEAST(1,000, base) 정액** — 종전 0.14 오적용
- `medical_aid_2` → **LEAST(1,000, base) 정액** — 종전 0.15 오적용
- `medical_aid_1` → 정액 유지(회귀0) · general/infant/elderly/foreigner → 회귀0(교정대상 아님)

> ⇒ 등급분기 오산의 **교정대상 등급 = low_income_1 / low_income_2 / medical_aid_2** 3종.

---

## 1. 규모 산출 — 등급 케이스별 실측 (전수 census, 3개 독립소스 삼각검증)

CEO 집행조건2(등급 케이스별 실측·전수집계 지향) 이행. 급여 등급별 **prod 전수** 대조.

### (A) `customers.insurance_grade` — 등급 모집단 (전수 729명)

| insurance_grade | 인원 | 교정대상? | 비고 |
|-----------------|-----:|:---:|----|
| NULL(미분류) | 494 | – | 급여 미확정 |
| general (30%) | 231 | ✗ 회귀0 | |
| foreigner (100%) | 3 | ✗ 회귀0 | 전액본인부담 pre=post |
| unverified | 1 | ✗ | |
| **low_income_1 (차상위 면제)** | **0** | ✔ | **모집단 없음** |
| **low_income_2 (차상위 정액)** | **0** | ✔ | **모집단 없음** |
| **medical_aid_2 (의급2종 정액)** | **0** | ✔ | **모집단 없음** |
| medical_aid_1 (의급1종) | 0 | ✗ 회귀0 | 모집단 없음 |
| elderly_flat (65세↑정액제) | 0 | ✗ 회귀0 | 모집단 없음 |
| infant | 0 | ✗ | 모집단 없음 |

### (B) `payments.resettle_confirmed_grade` — 수납 재정산 등급 (전수 258건)
- 258건 전부 `NULL` → 교정대상 등급 재정산 수납 **0건**.

### (C) `service_charges.customer_grade_at_charge` — 청구시점 등급 스냅샷 (전수 33건)
- grade 스냅샷 distinct = `general`, `manual` **2종뿐** (교정대상 등급 스냅샷 0건).
- 급여(covered) 청구 = 26건 전부 `general`. 최초 covered 청구 = **2026-07-22** (배포 이후).
- 정정후 로직 재계산 vs 저장 copay 불일치 = 2건(§3 참조, general·배포후·carve-out 밖).

### 규모 집계 결과

| 구분 | 건수 | 환자수 | 총액 |
|------|-----:|------:|-----:|
| **과다징수 (환자 초과부담)** | **0** | **0** | **0원** |
| **과소징수 (기관 결손)** | **0** | **0** | **0원** |

> **등급분기 오산으로 인한 오수납 규모 = 0원 (과다·과소 모두).**
> 사유: 풋센터 prod에 차상위(low_income_1/2)·의료급여2종(medical_aid_2) 등급으로 **급여 청구·수납된 환자가 단 1명도 없음.** 급여 청구는 전부 `general(30%)` — 교정 무영향 등급.

---

## 2. 환불 대상 (과다징수 건)

- 과다징수 건 = 0건 → **환불대상 환자 0명, 1인당 차액 분포 = 해당 없음.**

---

## 3. 소급 재계산 안 A/B/C

규모 0 이므로 세 안 모두 **대상규모 0 / 환불총액 0원 / 운영부담 없음**. 실질 권고:

| 안 | 정의 | 대상규모 | 환불총액 | 판단 |
|----|------|--------:|--------:|----|
| A | window 전건 소급 | 0건 | 0원 | 불필요 |
| B | 차액≥N원만 소급 | 0건 | 0원 | 불필요 |
| C | 특정일 이후만 소급 | 0건 | 0원 | 불필요 |

> **권고: 4단계(원장 정정·소급 백필) 불필요 — 되돌릴 오수납이 없음.** 단, 게이트는 낮추지 않음(CEO: 예외이므로 더 엄하게) → 본 census를 근거로 planner→CEO 상신, "소급범위 = 없음" 확정 요청.

---

## 4. carve-out 밖 관찰 (봉인 — 본 티켓 미착수, 참고 통보만)

- 정정후 재계산 불일치 2건: `check_in_id=ac0c2f1d…`, grade=**general**, `hira_score=NULL → price-full fallback(rate=1.0)`, calculated_at=**2026-07-22(배포 후)**.
  - 등급분기 오산과 **무관**(general·정률제 회귀0·배포후). `hira_score NULL default-deny` 문서화 동작.
  - CEO carve-out 봉인 준수 → 본 티켓서 미조사. 별도 판단 필요 시 planner가 신규 티켓 분리.

---

## 5. 정합성 caveat (투명 고지)

- 현 `service_charges` 급여 covered 최초시점 = 2026-07-22(배포 후). pre-fix window 구간의 covered 청구가 현 테이블에 부재.
  - 두 경우 모두 결론 동일: (a) pre-fix covered 청구 자체가 없었거나, (b) 있었더라도 grade 스냅샷은 과거·현재 모두 `general`/`manual`만 관측 → 교정대상 등급 0.
- ⇒ 어느 분기든 **교정대상 등급 오수납 규모 = 0** 으로 수렴.

---

## 금지선 준수 확인
- [x] payments/service_charges 실 UPDATE·환불·소급 반영 0건 (전부 REST GET)
- [x] blind count-UPDATE 없음
- [x] carve-out 봉인 — 타 풋 이슈(§4) 미착수
- [x] 게이트 미인하 — 4단계는 별도 승인·SOP·supervisor DDL/DML-diff 소관 명시
