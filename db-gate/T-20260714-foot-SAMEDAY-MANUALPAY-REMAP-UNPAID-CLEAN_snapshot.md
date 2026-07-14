# T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN — 판정근거 스냅샷 (Phase 1)

> data_correction_backfill_sop 준수. 조회 시점: 2026-07-14 (일마감). clinic_id=74967aea-a60b-4da3-a0e7-9c997a930bc8 (foot).
> Phase 3 UPDATE는 **현장(김주연 총괄) confirm 후에만** 실행. 본 스냅샷 = freeze set + before-state.

## 0. "2번차트" 개념 특정 (AC1)
- "2번차트" = **CustomerChartPage(고객차트 2번 탭, 전능CRM 이중탭 구조)** 의 **수납내역 탭 + 미수이력**. (별도 `chart_no=2` 레코드/슬롯 아님.)
- 근거: `manualPaymentWritePath.ts` L5 주석 "(b) 2번차트 수납내역 미표시", `CustomerChartPage.tsx` CHART2-* 티켓 다수.
- 수납내역 탭 소스 = canonical `payments` + `package_payments`. 미수 = `packages.total_amount - paid_amount` (패키지 잔금) 또는 `check_ins.status='payment_waiting'` (진료비 미수). **`closing_manual_payments`는 소스에 포함 안 됨.**

## 1. 근본원인 진단 — 버그 vs 운영 (AC2, repro=진태주 F-4652)
**판정: 운영-우세 하이브리드(코드 로직 결함 아님).**
- `Closing.tsx` 수기결제 입력 UI는 옵션A canonical 라우팅(`recordManualPayment`)을 **이미 보유**(오늘 Part1 배포). 단 **opt-in**: `attrSel` 기본값 `'manual'`(L1896, "기본값=수기(rollup) 기존동선 무회귀").
- 스태프가 '귀속 대상'(패키지 잔금 / 수납대기 내원 / 단건) 드롭다운을 **선택하지 않으면** L2007 raw `closing_manual_payments` INSERT로 폴백 → canonical 미생성 → **2번차트 수납내역 미표시 + 미수 미해소**(설계상 net-zero, 매출 이중계상 방지).
- 오늘 13건은 모두 기본값('수기') 상태로 저장됨 → 자동 연결 로직 '결함'이 아니라, **귀속 미선택 시 별도 rollup 원장에 남는 정상 동작**.
- repro 진태주 F-4652: closing_manual_payments 10,000(card,15:15) 존재 / canonical payments·package_payments 0 / 무좀체험권 balance 10,000 = 미수 → 정확히 위 경로.
- **후속(선택) 코드개선 여지**: 차트번호가 활성패키지 잔금 1건으로 유일 해소될 때 귀속 자동제안/기본선택 or 귀속 선택 필수화. → 별도 P1/P2 티켓(설계 판단 필요, 본 티켓 데이터정정과 분리).

## 2. 매핑 정정 조회 결과 (AC: 오매핑) — **오매핑 0건**
- 13건 전부 chart_number ↔ customers 1:1 유일 해소, `customer_name` == `customers.name` 완전 일치. **chart↔name 오매핑/미매핑 없음.**
- 현장이 말한 "올바른 고객 레코드 매핑"의 실질 = 수기행을 canonical(customer_id/패키지/내원)에 **연결(canonicalize)** 하는 것 (라벨 오류 정정 아님).

## 3. 보강 12건(스크린샷 16:11) ↔ DB 대사 (AC)
DB `closing_manual_payments` (close_date=2026-07-14) = **13건**.
- 스크린샷 12건 中 **11:09 F-4695 이미현 2,890,000 card** → 현재 DB 없음 = **Part1(T-20260714-DAYCLOSE-MANUAL-PAY, opt-A)이 이미 canonical화**(package_payments 2,890,000 존재). ✅ 설명됨.
- 나머지 11건 = 스크린샷과 일치.
- 스크린샷에 없던 **신규 2건**(16:11 이후 등록): 16:32 F-4597 윤철희 10,000 card / 16:34 F-4687 신용섭 10,000 card.
- ∴ 대사: 누락 1건(=Part1 처리완료) / 초과 2건(=스크린샷 이후 신규). **불일치 원인 전부 설명됨.** 미처리 pending = 현재 13건.

## 4. FREEZE SET — closing_manual_payments (13건, before-state)
| # | cmp_id | pay_time | chart | name | cust_id | amount | method | memo | 제안귀속 | pkg_id / 대상 |
|---|--------|----------|-------|------|---------|--------|--------|------|---------|--------------|
| A1 | 804b6d72-cf9f-4827-9545-1aa126f59573 | 11:25 | F-4590 | 전인호 | 5bd0e924-c701-4b16-8865-a03c5a6edae1 | 10000 | card | - | package | f84a95cd-ab07-4f83-8760-d941c46ed079 (무좀체험권) |
| A2 | b674132c-b68f-4920-9b25-977527e39eb9 | 12:16 | F-4644 | 최고 | d2c91749-c6c3-498b-a3d4-12d5d26a67e8 | 10000 | cash | - | package | 04feb879-afbf-4158-ba29-3dfaa39c0c3c (체험) |
| A3 | a503218f-0d0a-4393-a771-a6ddf8a02173 | 13:02 | F-4646 | 박형규 | 4c7fcad8-115d-4e80-a88d-65e2e24e81d4 | 10000 | card | - | package | 3ba632cd-82ec-4abc-89ca-7ac2ca710286 (무좀체험권) |
| A4 | dfd30a1a-1b6c-463d-a433-2d03c486c616 | 15:15 | F-4652 | 진태주 | 3210644b-04a5-4f24-b425-c3d10ae87dc9 | 10000 | card | - | package | 1f7a61f1-f7d0-438b-adb6-620d203969db (무좀체험권) [repro] |
| A5 | f0f16293-d146-4bb1-a430-5547623a88d0 | 15:16 | F-4655 | 마서현 | 23d923ed-7cd9-4cbb-a169-bb64450ec3f2 | 10000 | card | - | package | 84808f19-c6c4-45d6-bf85-8e242b01bee4 (무좀체험권) |
| A6 | 28e305ff-4e54-404c-b360-21336eb0508e | 15:21 | F-4600 | 최창수 | 14889376-6f68-4222-8b76-14a22b16dd1d | 10000 | card | - | package | a8d402ba-7763-4dd8-8f63-5fca23dc484c (무좀체험권) |
| A7 | a41079be-81eb-4874-949d-d6636974dae8 | 15:45 | F-4601 | 정종석 | 7d177461-cd0c-478b-b322-7c8498798ef5 | 10000 | card | - | package | 387c8f6a-f151-426d-ac56-96366188a2f4 (체험) |
| A8 | c3f9b8fd-58fe-4a38-a8c5-68aabf81f489 | 15:50 | F-4546 | 김종형 | d0a9a495-e068-4dba-a96e-b0366ab6c596 | 10000 | card | - | package | 24e02b64-84b0-4e44-82cd-670768340927 (체험) |
| A9 | bb54e3f4-30f1-4069-8aec-c5fe238a1359 | 16:32 | F-4597 | 윤철희 | 476038ed-5ed1-44c0-8a2b-2cfb2d7011b9 | 10000 | card | - | package | 692fb8d5-ce16-48c0-a25b-19c885757483 (체험) |
| A10 | 832b75bc-1555-444c-8354-f3c1b5aba4df | 16:34 | F-4687 | 신용섭 | 6b3f8373-3841-49af-b308-1f128d4b00cc | 10000 | card | - | package | 1637a08f-5d5a-4eab-bcb8-aea9b84253e1 (무좀체험권) |
| B1 | a226fb72-683a-4e74-abe5-b869c87eae1f | 15:51 | F-4696 | 허유희 | 4e051559-a7bf-4eee-9819-d626a26b6220 | 3880000 | card | "100만원 이체" | package | 876e1a55-0545-4c5f-8591-75609be0bd06 (24회권) |
| B2 | 38a37a50-a9f4-44f3-b233-376345b4d3d7 | 15:52 | F-4696 | 허유희 | 4e051559-a7bf-4eee-9819-d626a26b6220 | 1000000 | transfer | - | package | 876e1a55-0545-4c5f-8591-75609be0bd06 (24회권) |
| C1 | 4e73d913-8bf4-4c9b-ae92-f76f3ac28055 | 12:06 | F-4695 | 이미현 | a07a3079-69ba-415a-a0f8-61e8d0921168 | 8900 | card | "진찰료" | **single(진찰료)** ⚠확인요 | 12회권 balance=0 → 패키지 아님 |

## 5. 패키지 balance before-state (미수 근거)
| pkg_id | chart | name | package | total | paid | balance(미수) | 처리 후 예상 balance |
|--------|-------|------|---------|-------|------|--------------|--------------------|
| f84a95cd | F-4590 | 전인호 | 무좀체험권 | 10000 | 0 | 10000 | 0 |
| 04feb879 | F-4644 | 최고 | 체험 | 10000 | 0 | 10000 | 0 |
| 3ba632cd | F-4646 | 박형규 | 무좀체험권 | 10000 | 0 | 10000 | 0 |
| 1f7a61f1 | F-4652 | 진태주 | 무좀체험권 | 10000 | 0 | 10000 | 0 |
| 84808f19 | F-4655 | 마서현 | 무좀체험권 | 10000 | 0 | 10000 | 0 |
| a8d402ba | F-4600 | 최창수 | 무좀체험권 | 10000 | 0 | 10000 | 0 |
| 387c8f6a | F-4601 | 정종석 | 체험 | 10000 | 0 | 10000 | 0 |
| 24e02b64 | F-4546 | 김종형 | 체험 | 10000 | 0 | 10000 | 0 |
| 692fb8d5 | F-4597 | 윤철희 | 체험 | 10000 | 0 | 10000 | 0 |
| 1637a08f | F-4687 | 신용섭 | 무좀체험권 | 10000 | 0 | 10000 | 0 |
| 876e1a55 | F-4696 | 허유희 | 24회권 | 4880000 | 0 | 4880000 | 0 (3.88M+1M) |

- F-4695 이미현 12회권(e55c868d): total 2,890,000 / paid 2,890,000 / balance 0 (Part1 완료) — **본 티켓 미접촉**.

## 6. canonical 이중계상 점검 (오늘)
- package_payments(오늘): F-4695 2,890,000(opt-A Part1) 1건뿐 → freeze set 13건과 무중복.
- payments(오늘): F-4695 248,900 payment + 248,900 refund("시스템오류") net-zero (본 건과 무관, 미접촉).
- ∴ 13건 canonicalize 시 **이중계상 리스크 없음**.

## 7. ⚠ 확인 요청 항목 (C1 이미현 진찰료 8,900)
- 12회권 balance=0(완납) → 패키지 잔금 아님. 이미현은 오늘 payment_waiting 내원(check_in 12211472) 보유(단, 그 내원엔 248,900 결제 후 시스템오류 환불 이력).
- 제안: **single(단건 진찰료)** 로 canonical payments 기록. 
- 대안: check_in 12211472 귀속('checkin') → 수납내역 표시 + 칸반 payment_waiting→done 해소. 이 경우 현장이 해당 내원 칸반 종결 원하는지 확인 필요.
- → **현장 confirm 시 single/checkin 택1.**
