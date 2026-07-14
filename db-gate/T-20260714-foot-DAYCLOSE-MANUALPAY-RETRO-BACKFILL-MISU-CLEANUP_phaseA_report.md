# T-20260714-foot-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP — Phase A 리포트 (READ-ONLY)

> **write 0.** 본 리포트는 SELECT 만으로 산출. 어떤 INSERT/UPDATE/DELETE 도 실행하지 않음.
> Phase B(payments 링크/미수 해소 write)는 3중 게이트 미충족 → **착수 금지** 상태.
>
> 산출 스크립트(모두 read-only):
> - `scripts/..._probe.mjs` — 모집단·버그구간 파악
> - `scripts/..._match.mjs` — chart/성함 3분류 매칭
> - `scripts/..._misu.mjs` — 고객별 미수/결제 대사

## 1. 대상 후보 추출 (버그구간 ∩ 버그경로 지문 — 단일 count 아님)

- **버그구간(time)**: `closing_manual_payments` 발생일 = **2026-07-14 단일일** (전수 13건이 오늘로 클러스터 — 급여환자 전수 수기수납 PAYMINI workaround 당일과 정확히 일치). 다른 날짜 0건 → 버그구간이 오늘로 자연 확정.
- **버그경로 지문(path)**: 워크어라운드 테이블 `closing_manual_payments` 에 free-text `chart_number`/`customer_name` 로만 남아 canonical `payments`/`package_payments` 를 만들지 못한 레코드. (canonical write-path = `src/lib/manualPaymentWritePath.ts` 미경유)
- **교집합 = 13건** (1개 clinic: `74967aea-...930bc8`). chart_number·customer_name 은 13건 모두 채워져 있음(스태프 수기 타이핑).
- **미수 후보 = 버그경로 지문과 교집합만 채택.** clinic 전체 `payment_waiting` check_ins 23건 중 본 후보 고객과 매칭되는 것은 2건뿐 → **나머지 21건은 정상 진행 미수로 판단, 백필 대상에서 배제**(단일 count 오귀속 회피).

## 2. 매칭 리포트 3분류

| 분류 | 건수 | 판정 근거 |
|------|------|-----------|
| **1:1확정** | **13 / 13** | chart_number + 성함이 canonical `customers` 1건에 동시·유일 일치 |
| 다중후보 모호 | 0 | — |
| 무매칭 | 0 | — |

> 대조군: 해당 clinic customers 345명. 13건 전부 chartNo·성함이 정확히 한 고객으로 수렴 → 매칭 모호성 없음.

### 레코드별 (금액 KRW)

| # | chart | 성함 | 금액 | method | staff | memo | 분류 | 매칭 cust_id |
|---|-------|------|------|--------|-------|------|------|--------------|
| 1 | F-4590 | 전인호 | 10,000 | card | 엄경은 | | 1:1확정 | 5bd0e924… |
| 2 | F-4695 | 이미현 | 8,900 | card | 데스크 | 진찰료 | 1:1확정 | a07a3079… |
| 3 | F-4644 | 최고 | 10,000 | cash | 정연주 | | 1:1확정 | d2c91749… |
| 4 | F-4646 | 박형규 | 10,000 | card | 송지현 | | 1:1확정 | 4c7fcad8… |
| 5 | F-4652 | 진태주 | 10,000 | card | 엄경은 | | 1:1확정 | 3210644b… |
| 6 | F-4655 | 마서현 | 10,000 | card | 엄경은 | | 1:1확정 | 23d923ed… |
| 7 | F-4600 | 최창수 | 10,000 | card | 송지현 | | 1:1확정 | 14889376… |
| 8 | F-4601 | 정종석 | 10,000 | card | 정연주 | | 1:1확정 | 7d177461… |
| 9 | F-4546 | 김종형 | 10,000 | card | 정연주 | | 1:1확정 | d0a9a495… |
| 10 | F-4696 | 허유희 | 3,880,000 | card | 송지현 | | 1:1확정 | 4e051559… |
| 11 | F-4696 | 허유희 | 1,000,000 | transfer | 송지현 | 100만원 이체 | 1:1확정 | 4e051559… |
| 12 | F-4597 | 윤철희 | 10,000 | card | 정연주 | | 1:1확정 | 476038ed… |
| 13 | F-4687 | 신용섭 | 10,000 | card | 송지현 | | 1:1확정 | 6b3f8373… |

## 3. 미수 대사 (Phase B 판정 근거 — 이중입력 vs 진짜 미링크 구분)

### (A) 클린 백필군 — 11건 / 10고객 (소액 체험·무좀체험권)
수기입력액 = 활성 패키지 잔금과 동액, 당일 canonical 결제 0, payment_waiting 0.
→ 수기 10,000(이미현 제외)이 canonical 로 안 들어가 **패키지 잔금(미수)이 그대로 남음**. 1:1 링크 시 미수 해소, 이중계상 위험 없음.

| chart | 성함 | 수기 | 패키지 | 패키지미수 |
|-------|------|------|--------|-----------|
| F-4590 | 전인호 | 10,000 | 무좀체험권 10,000 | 10,000 |
| F-4644 | 최고 | 10,000 | 체험 10,000 | 10,000 |
| F-4646 | 박형규 | 10,000 | 무좀체험권 10,000 | 10,000 |
| F-4652 | 진태주 | 10,000 | 무좀체험권 10,000 | 10,000 |
| F-4655 | 마서현 | 10,000 | 무좀체험권 10,000 | 10,000 |
| F-4600 | 최창수 | 10,000 | 무좀체험권 10,000 | 10,000 |
| F-4601 | 정종석 | 10,000 | 체험 10,000 | 10,000 |
| F-4546 | 김종형 | 10,000 | 체험 10,000 | 10,000 |
| F-4597 | 윤철희 | 10,000 | 체험 10,000 | 10,000 |
| F-4687 | 신용섭 | 10,000 | 무좀체험권 10,000 | 10,000 |

### (B) 정밀검토군 — 2고객 (당일 canonical 결제 병존 → 이중계상 위험)

**이미현 (F-4695)** — 수기 8,900(진찰료)
- 당일 canonical payments 497,800 + package_payments 2,890,000(12회권 완납, 미수 0), payment_waiting **1건 잔존**.
- ⚠️ 진찰료 8,900이 canonical 497,800 안에 이미 포함되는지 대사 필요. 미포함이면 payment_waiting 해소 대상, 포함이면 수기건은 중복 → 링크 금지.

**허유희 (F-4696)** — 수기 2건 합계 4,880,000 (3,880,000 card + 1,000,000 transfer)
- 24회권 total 4,880,000 / canonical paid 380,000 / **미수 4,500,000**, payment_waiting 1건.
- ⚠️ 수기 합계(4,880,000)가 패키지 total 과 정확히 일치. canonical 380,000 이 수기 4,880,000 에 포함/별도인지 대사 필요. 별도면 380,000+4,880,000=5,260,000 > total → 초과·이중. 포함이면 4,880,000 전액 링크.

## 4. Phase B 진입 전 3중 게이트 (미충족 — 착수 금지)

1. **(게이트1)** DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC write-path 포크 결정 = canonical 수납 write-path 확정. → 현행 canonical = `manualPaymentWritePath.recordManualPayment` 옵션A(package/checkin/single 3분기). 백필 write 는 이 경로 **재사용**, 병렬 신설 금지.
2. **(게이트2)** data-architect CONSULT — Cross-CRM Data-Correction 백필 SOP(대상셋 freeze·판정근거 스냅샷·폴백·원장 무접점). Phase B 설계 진입 시 dev-foot 이 CONSULT 발행.
3. **(게이트3)** dry-run + 김주연 총괄 사람 confirm — 매칭 규칙(1:1확정 13건 자동 / (B)군 2고객 개별 판정)·미수 정리 정의 확정.

## 5. Phase B 제안 개형(참고 — 미승인)

- **클린 백필군 11건**: 각 수기건 → `recordManualPayment({attribution:{kind:'package', packageId}})` 재사용(ADDITIVE), package.paid_amount 재집계로 미수 자동 해소.
- **정밀검토군 2고객**: 총괄 대사 confirm 후 개별 링크(또는 보류). canonical 병존건은 이중계상 방지 위해 자동처리 제외.
- 대상셋 = 본 리포트 13 cmp_id freeze. 실행 시 재조회로 drift 검증, 불일치 시 abort.
