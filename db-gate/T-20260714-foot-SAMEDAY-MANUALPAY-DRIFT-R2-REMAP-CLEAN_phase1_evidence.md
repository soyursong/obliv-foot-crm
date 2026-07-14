# T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2-REMAP-CLEAN — Phase 1 판정근거 스냅샷 (READ-ONLY)

> 조회 시각: 2026-07-15 (일마감 종료 후 = 대상셋 확정/frozen). clinic=foot(74967aea…). 대상 DB: obliv-foot-crm(rxlomoozakkjesdqjtvd).
> 성격: R1(SAMEDAY-REMAP) apply(12행 canonical, commit f2360824) **이후** 잔여 당일 수기수납(drift/신규) 재조회·분류. SELECT only, **write 0**.
> SOP: Cross-CRM Data-Correction Backfill — 대상셋 freeze · 판정근거 스냅샷 · 롤백SQL · net-zero · 원장 파괴 0. Phase3 UPDATE는 **현장 confirm 게이트 후에만**.

## 0. double-canonicalize 안전 확인 (SOP 핵심)
| 지표 | 값 | 판정 |
|------|-----|------|
| R1 canonical package_payments (마커 T-20260714-SAMEDAY-REMAP) | 11건 / 4,600,000 | 무접촉 유지 ✅ |
| R1 canonical payments (마커) | 1건 / 8,900 | 무접촉 유지 ✅ |
| R1 canonical 합계 | 12행 / 4,608,900 | R1 apply 확정분 그대로 ✅ |
| R2 자체 마커(DRIFT-R2) 사전존재 | package_payments 0 / payments 0 | 미적용(사고 無) ✅ |
| R2 대상셋 ∩ R1 12행 | 0건 (R1이 정본화 12행 DELETE, id 전부 disjoint) | R1 apply 12행 재접촉 0 ✅ |

## 1. R2 대상셋 (당일 전체 수기수납 − R1 12행 = 현재 잔존 closing_manual_payments) — **8건 확정(frozen)**
일마감 종료됨(익일 2026-07-15) → 19:22 이후 추가 drift 없음. seed 8건 = 실제 잔여 8건 **완전 일치**(누락/초과 0).

| # | pay_time | chart(원본) | 이름 | 금액 | method | staff | cmp id | 분류 |
|---|----------|-------------|------|------|--------|-------|--------|------|
| 1 | 17:51 | F-4564 | 허유진 | 10,000 | card | 송지현 | 54f54cc3 | A(package 잔금) |
| 2 | 18:50 | (null) | 김성애 | 10,000 | card | 정연주 | 580bda4d | A(package 잔금) |
| 3 | 19:01 | " F-4645"(공백) | 노수옥 | 10,000 | card | 정연주 | 7021a5ca | A(package 잔금) |
| 4 | 19:03 | F-4642 | 이멋진 | 10,000 | card | 엄경은 | bb0bd71c | A(package 잔금) |
| 5 | 19:05 | F-4702 | 이재성 | 350,000 | card | 엄경은 | 3a713bd7 | B(고액 package 잔금) |
| 6 | 19:12 | F-4643 | 황찬식 | 10,000 | card | 송지현 | e0280dbb | A(package 잔금) |
| 7 | 19:21 | 4696(F-없음) | 허유희 | 8,900 | card | 데스크 | 78c19a4f | C(진찰료 single) |
| 8 | 19:22 | 4702(F-없음) | 이재성 | 8,900 | card | 데스크 | 4ff33dc0 | C(진찰료 single) |

## 2. 김성애 chart_no 특정 (AC)
- 원 수기행 chart_number = **NULL** (미기재). 이름 `김성애`로 고객 조회 → **F-4589** (id c68b7056-3c1c-4476-a21a-9b5f6e1f9f56, visit_type=returning). **동명이인 0건** → 특정 확정.
- 해당 고객 패키지: `체험`(a2869398) total 10,000 / paid 0 / **balance 10,000 active** → A군 매핑 대상.

## 3. ★ B군 이중계상 대사 — 이중계상 0 확증 (reconcile-with-evidence)
### (a) 허유희 F-4696 8,900 (데스크, 19:21)
| 근거 | 값 |
|------|-----|
| 24회권(876e1a55) total / paid / balance | 4,880,000 / 4,880,000 / **0** (R1 canonical: 4,500,000 이체 + 380,000 영수증업로드) |
| 허유희 기존 payments(single) | **0건** (오늘 8,900 아직 원장 부재) |
| 판정 | 8,900 = **진찰료/데스크 = 24회권 패키지와 무관한 별개 청구**. 패키지에 붙이면 paid 4,888,900 > 총액 4,880,000 = 이중계상 → **single(payments, check_in_id NULL)로 계상**하면 패키지 balance 0 유지·**이중계상 0**. (R1 이미현 F-4695 8,900 진찰료 single과 동형) |

### (b) 이재성 F-4702 350,000 (19:05) + 8,900 (데스크, 19:22)
| 근거 | 값 |
|------|-----|
| `가열`(8d42dbcb, custom) total / paid / balance | 350,000 / 0 / **350,000 active** |
| 이재성 기존 payments / package_payments | **각 0건** (원장 부재) |
| 판정 350,000 | `가열` 패키지 잔금과 **정확 일치**(balance 350,000) → package_payment 정본화, balance→0. |
| 판정 8,900 | 별개 **진찰료 single**(가열은 350k로 완납, 8,900은 데스크 진찰료). 350,000과 금액·시각·성격 상이 → **별개 정당 2건, 중복 아님**. single 계상 → 이중계상 0. |

## 4. A군 소액 5건 (net-zero, R1 A군과 동형)
모두 당일 계약(2026-07-14) package, paid 0 / balance = 금액 → package_payment 정본화 시 balance 0(미수 전건 해소). 원장 파괴 0.

| chart | 이름 | package | balance(before) | package_id | customer_id |
|-------|------|---------|-----------------|-----------|-------------|
| F-4564 | 허유진 | 무좀체험권 | 10,000 | 2b8a0c23 | ed91fabd |
| F-4589 | 김성애 | 체험 | 10,000 | a2869398 | c68b7056 |
| F-4645 | 노수옥 | 체험 | 10,000 | f7f02420 | d7814e4b |
| F-4642 | 이멋진 | 무좀체험권 | 10,000 | 730a1e69 | 8c525a72 |
| F-4643 | 황찬식 | 무좀체험권 | 10,000 | db0a17a6 | db243c4d |

> ※ 카운트 대사: MQ seed는 "A군 소액 6건"으로 표기했으나 실제 순수 10,000 소액 = **5건**. 6번째로 지목된 이재성은 350,000(B군 고액 package). 실측 재분류: A 소액 5 + B 고액 package 1(이재성 350k) + C 진찰료 single 2(허유희·이재성 각 8,900) = 8건.

## 5. net-zero 검증 (Phase3 apply 시)
| 항목 | 금액 |
|------|------|
| 삭제 대상 closing_manual_payments 8건 SUM | 417,800 |
| canonical package_payments (A 5×10,000 + B 350,000) | 400,000 |
| canonical payments single (C 2×8,900) | 17,800 |
| **canonical 합계** | **417,800** |
| **net** | **417,800 == 417,800 ✅ (매출 무증감)** |

## 6. 제안 정정안 (Phase3 — confirm 후 실행)
- **A/B(6건)**: 각 고객 package_payment 정본화(opt-A/pkg) → paid_amount 재집계 → balance 0(미수 해소). 영향 패키지 6개.
- **C(2건, 진찰료)**: payments single(check_in_id NULL) 계상. 패키지 무접촉 → 이중계상 0. (비차단 residual: single/checkin 귀속은 결과 relay 시 현장 재확인 — R1 이미현과 동일 정책)
- 원 closing_manual_payments 8건 DELETE(net-zero rollup). 원장(payments/package_payments) 파괴적 삭제 0.
- 마커 = `T-20260714-DRIFT-R2` (R1 마커와 구분, 멱등 가드 WHERE NOT EXISTS).

## 7. 7-invariant self-test (Phase3 apply 후 검증 예정)
1. canonical package_payments(DRIFT-R2) = 6건 / 400,000
2. canonical payments(DRIFT-R2) = 2건 / 17,800
3. 대상 6개 package balance = 0 (미수 전건 해소)
4. 허유희 F-4696 24회권 balance = 0 (무접촉 — R2 8,900은 single, 패키지 미접촉)
5. closing_manual_payments(2026-07-14) = 0건 (8건 DELETE)
6. net-zero: SUM(canonical) == SUM(deleted) == 417,800
7. R1 canonical 마커(SAMEDAY-REMAP) 12행 / 4,608,900 **무변경**(R2가 R1 재접촉 0)

## 8. 안전 점검
- confirm 전 원장 UPDATE **0건** (Phase1 = SELECT only).
- R2 마커 사전존재 0 → double-canonicalize/double-UPDATE 없음. execution_owner=this(R2 신규분 단독).
- 대상셋 frozen(일마감 종료, 8건 확정). 롤백SQL v1 준비(before-state 정확복원).
- 조회 스크립트: `scripts/T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2_p1_probe.mjs`, `..._p1_classify.mjs`.
