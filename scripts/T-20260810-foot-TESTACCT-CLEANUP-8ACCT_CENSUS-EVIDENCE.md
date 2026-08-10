# T-20260810-foot-TESTACCT-CLEANUP-8ACCT — AC-1 READ-ONLY CENSUS 증적

- 실행: dev-foot / 2026-08-10 / Management API SELECT introspection only (WRITE 0 · DDL 0 · DELETE 0)
- 대상 DB: foot prod rxlomoozakkjesdqjtvd
- 스크립트: `_match.mjs` `_fkmap.mjs` `_census.mjs` `_drill.mjs` `_drill2.mjs`

## A. 이름→레코드 해소 (8 이름 → 9 customer 행 / auth·staff 계정 0건)
전 8 이름이 **customers(고객 차트)에만** 존재. user_profiles/auth.users 로그인·staff 계정 = **0건**. → 순수 고객차트 정리(로그인계정 삭제 아님).

| # | 이름 | customer_id | chart | phone | visit_type | is_simulation |
|---|------|-------------|-------|-------|-----------|---------------|
| 1 | 서류테스트 | 78975d00-9d31-4ac3-848c-0f77c6f0d735 | F-4990 | (phone off-git) | returning | false |
| 2 | 서류테스트2 | 80df7a6b-077d-46db-b9db-31591f3977a4 | F-5113 | (phone off-git) | returning | false |
| 3 | 송지현2 | d7faae9b-8e0b-421a-b68b-483ede6834a3 | F-4692 | (phone off-git) | new | false |
| 4 | 엄경은2 | a0f8c846-9f93-47bf-a79e-57d265d989b6 | F-4691 | (phone off-git) | new | false |
| 5 | 엄경은2(중복) | 02594dfa-9428-4405-b640-95ab50ad5e5d | F-4703 | (DUMMY-phone off-git) | new | false |
| 6 | 총괄테스트중 | 351d34c5-2dd9-4583-bfb3-8e27025777a6 | F-4574 | (phone off-git) | returning | false |
| 7 | 풋 서류 테스트 입니다 | c074025b-cd27-443c-93a9-151d6d4214d4 | F-4468 | (phone off-git) | new | false |
| 8 | 풋테스트1 | e72022d0-7cf5-4f42-b5e3-b5162005b454 | F-4427 | (phone off-git) | new | false |
| 9 | 풋테스트3 | 21a82994-b231-4bcc-94ff-dd9e6c3a4951 | F-4425 | (phone off-git) | new | false |

- **엄경은2 = 2행** (F-4691 실전화 / F-4703 DUMMY전화·예약더미 경로). 둘 다 대상.
- created_by = 전 행 NULL.

## B. 동명이인 실고객 배제 (SOP: 이름 단독 비유일 술어 금지)
- NFC exact-match 술어 사용(ILIKE/부분매칭 아님).
- **실고객 존재**: 송지현(F-4451, (phone off-git)), 엄경은(F-4623, (phone off-git)) — "2" 없는 실고객.
- 삭제 대상은 정확히 "송지현2"/"엄경은2"(2 suffix) → 실고객 자동 배제됨 ✓
- KEEP 지정(김민경/박민석)은 customers+user_profiles 양쪽 존재하나 8대상과 id 충돌 0 ✓

## C. 자식/원장 census + (a)/(b) 분류
발행 서류(insurance_documents/receipts/claims·prescriptions·consultation_notes·consent_forms·clinical_images·treatment_photos·patient_file_records) = **전 대상 0건**.
packages는 8행 존재하나 **전부 paid_amount=0 · package_payments 0 · credit_ledger 0 = 빈 테스트 회차권(매출·소진 무접점)**.

| 대상 | payments | service_charges | medical_charts(서명) | packages(빈) | 기타 자식 | 분류 |
|------|----------|-----------------|----------------------|--------------|-----------|------|
| 서류테스트 F-4990 | 2 (8800 pay+8800 refund) | 2 | **2 (문지은/김윤기)** | 2 | check_ins4,form33,phi1515 | **(b) 신규** 매출원장+의료차트 |
| 서류테스트2 F-5113 | 4 (8800×2+refund×2) | 2 | **1 (문지은)** | 1 | check_ins1,form10 | **(b) 확정승계** (재논의 금지) |
| 총괄테스트중 F-4574 | 0 | 0 | **2 (문지은/한동훈)** | 1 | check_ins2,form19 | **(b) 신규** 의료차트(의료법) |
| 송지현2 F-4692 | 0 | 0 | 0 | 1 | chart_treatment_requests2,memo1 | (a′) 빈pkg+메모 |
| 엄경은2 F-4703(DUMMY) | 0 | 0 | 0 | 1 | chart_treatment_requests1,memo1 | (a′) 빈pkg+메모 |
| 풋 서류 테스트 입니다 F-4468 | 0 | 0 | 0 | 1 | check_ins1 | (a′) 빈pkg |
| 풋테스트1 F-4427 | 0 | 0 | 0 | 1 | resv2,memo1 | (a′) 빈pkg |
| 풋테스트3 F-4425 | 0 | 0 | 0 | 1 | resv2 | (a′) 빈pkg |
| **엄경은2 F-4691** | 0 | 0 | 0 | **0** | notif1,resv1 | **(a) CLEAN** |

phi_access_log(감사로그, FK 없음·loose customer_id)는 매출/의료 원장 아님 — 삭제 blocker 아니나 orphan 잔류 처리 필요.

## D. 분기 판정 요약
- **(a) 완전 clean (1건)**: 엄경은2 F-4691 — archive-first 후 FK-safe 물리삭제 후보.
- **(a′) 빈 회차권+메모/예약만 (5건)**: 송지현2 F-4692, 엄경은2 F-4703, 풋서류테스트입니다 F-4468, 풋테스트1 F-4427, 풋테스트3 F-4425 — 매출·의료 무접점. 빈 package/child 선삭제 후 물리삭제 가능(archive-first). **판정 필요**: 빈 회차권을 (a) 물리삭제로 볼지 확인.
- **(b) 물리삭제 HOLD (3건)**: 서류테스트 F-4990(매출+의료차트), 총괄테스트중 F-4574(의료차트), 서류테스트2 F-5113(확정승계). → is_test 테스트표시 경로.
  - **서류테스트2**만 선례 확정. **서류테스트 F-4990·총괄테스트중 F-4574 = 신규 (b)** → 총괄 confirm 게이트 대상.

## E. 블로커 — (b) is_test 경로 실행 전제
- foot `customers`에 **is_test 컬럼 없음** (is_simulation만 존재). 서류테스트2도 현재 무플래그(is_simulation=false).
- (b) "is_test 테스트표시" 실행 = 신규 컬럼 추가(ADDITIVE) 필요 → **data-architect CONSULT 선행**(§S2.4 데이터 정책 게이트). body 선례(DA-...ISTEST: is_simulation 재사용 REJECT, is_test 신규 GO) 준용 여부 DA 판정 필요.
