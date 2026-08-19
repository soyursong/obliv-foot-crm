# RCA — 마감 [현금] 합계 100,000원 불일치 (2026-08-18)

- **티켓(진단)**: T-20260819-foot-CLOSING-CASH-REFUND-SUM-MISMATCH (duplicate) → **canonical: T-20260819-foot-CLOSING-CASHSUM-REFUNDROW-100K-DROP**
- **Phase A (READ-ONLY 진단)** — prod WRITE/DDL 0. 근거: 실 prod census (`_diag_readonly.mjs`) + 코드 경로 추적.
- **판정: 전산 "설계"상 문제 (write-path RPC 결함). 단순 표시 SUM 버그 아님. 환불 이중차감 아님.**

## 1. 증상
- 2026-08-18 마감 결제수단 [현금]: 현장 수동합 **735,400** vs CRM 표시 **635,400** → **100,000 부족**.
- 차이(100,000) ≠ 환불액(4,700,000) → "환불 이중차감" 가설로는 설명 안 됨(현장 ⚠ 정확).

## 2. Forensic (prod 실데이터 · foot 종로 clinic)
이금득 고객 패키지 결제/환불 4행 (package_payments):

| id(앞8) | 금액 | 유형 | **결제수단** | created_at(KST) | parent |
|---|---|---|---|---|---|
| a3327725 | 4,700,000 | payment | **현금** | 08-18 14:27 | — |
| 2d58854a | 100,000 | payment | **카드** | 08-18 14:27 | — |
| 0c96f6db | 4,700,000 | refund | 현금 | 08-18 17:46 | a3327725 |
| 5ffd4b57 | 100,000 | refund | **현금** | 08-18 23:18 | **2d58854a** |

- a3327725 + 2d58854a는 **동일 timestamp(14:27:06.926512)** = 한 번의 패키지 판매를 현금 4.7M + 카드 0.1M **두 레그**로 수납.
- 08-18 [현금] NET 합산 실측(`_diag_readonly.mjs §6`):
  - 현금 payments(단건) 합 = **735,400** (= 현장 수동합과 정확히 일치)
  - 패키지 현금 NET = **−100,000** (4.7M 판매 − 4.7M 환불 − 0.1M 환불)
  - → 현금 총계 = 735,400 − 100,000 = **635,400** (= CRM 표시와 정확히 일치)
  - accounting_date 축·created_at 축 **둘 다 635,400** (§4/§4b 공집합) → 날짜축 divergence 아님.

## 3. Root Cause — 환불행 결제수단이 원결제 레그와 불일치 (카드 원결제 → 현금 환불)
- 5ffd4b57 환불의 원결제(parent 2d58854a)는 **method=card**인데, 환불행은 **method=cash**로 기록됨.
- 결과: 카드총계 +100,000 그대로(미차감) · **현금총계 −100,000(차감)** → **결제수단별 [현금]만 100,000 과소, [카드]는 100,000 과대. 전체 총합계(net)는 정상.**

### 원인 코드 지점
1. **(주범) RPC `refund_package_payment(p_payment_id, p_method)`** — 환불행 INSERT 시
   `method = p_method` **호출자 자유 지정값**을 사용하고 원결제 `v_orig.method`를 **승계하지 않음**.
   (`refund_package_atomic`, 단건 `refund_single_payment`도 동일 구조로 추정 — Phase B 확인 대상.)
   → 호출자(UI)가 원결제와 다른 수단을 넘기면 결제수단별 집계 desync. **F4717(blocked)과 동일 class**.
2. **(부수·표시) `src/pages/Closing.tsx` enrichedRows 환불 merge (L1233–1251)** —
   환불행을 `parent_payment_id`로 원결제행에 병합하되 **결제수단 일치는 검사하지 않음**.
   교차수단 환불(현금환불↔카드원결제)이 **카드 원결제행(카드탭)에 merge → `merged_refund=true`로 현금탭에서 렌더 스킵**.
   그러나 합계 reduce(`totals`, L924~)는 환불행 자체 method(=cash)로 −100,000 차감.
   → **현금탭 화면행 합(735,400) ≠ 현금 총계(635,400)**. 현장이 "돈이 어디로 빠졌는지" 볼 수 없음.

### 교차참조 결론 (티켓 지시)
- **T-20260813 SPLITSIGN (deployed)**: 마감전령 emit payload(음수 부호) 축 — 본 표시-집계 경로에 **미적용/무관**. Closing.tsx totals에 Math.sign/split-sign 로직 없음(표준 net `refund?-amount:amount`).
- **T-20260805 F4717 REPAY-METHODCHG-UNMATCH (blocked)**: **동일 class**. 본 08-18 건은 그 원인(환불-원결제 수단 매칭)의 신규 구체 인스턴스.

## 4. 버그 vs 설계 · 값의 정오(正誤)
- **설계 문제**: 환불 수단을 서버가 원결제 레그에서 **승계하지 않고** 호출자 지정에 맡김 → 환불 있는 날 교차수단 환불 발생 시 **구조적 상시 재발**.
- 635,400이 "맞는 값"인지는 물리 현금 실사에 달림:
  - **실제로 카드결제분을 현금 100,000으로 환급했다면** → 635,400이 물리 현금서랍과 맞고, **표시(#2)가 진짜 문제**(현금탭에 −100,000 환불행이 안 보임).
  - **환불이 카드로 처리됐어야 했다면(수단 오선택)** → 현금(−100k)·카드(+100k) **둘 다 오염**, 데이터 정정 필요(#1).
  - 4.7M 레그는 현금→현금으로 정상 환불된 정황상, 0.1M 카드레그의 현금환불은 **수단 오선택(설계상 승계 부재)** 가능성이 높음.

## 5. 수정 방향 초안 (Phase B — 별 게이트, 미착수)
- **B-1 (write-path, 주):** 환불 RPC들이 환불행 `method`를 **원결제행 `v_orig.method`에서 서버 강제 승계**(호출자 `p_method` 무시 또는 검증) → 결제수단별 집계 desync 원천 차단. **money-path RPC 변경 = DA CONSULT 필수.** F4717과 통합 검토.
- **B-2 (표시, 부):** enrichedRows merge에 **결제수단 동일 조건 추가** — 교차수단 환불은 병합하지 말고 **자체 행으로 렌더**(고아 환불 fallback과 동일)하여 현금탭에서 −100,000이 보이게. (view-layer only, 합계 불변)
- **B-3 (소급 정정):** 08-18 5ffd4b57 행 수단 정정 필요 시 → **archive-first · DA CONSULT · 현장 per-row confirm · supervisor dry-run** (risk_reason 게이트). B-1/B-2와 분리된 자식 티켓.
- **영향 범위:** 환불행이 있는 모든 마감일 중 **원결제와 환불 수단이 다른 건**만 해당. Phase B 진입 시 전 기간 census(교차수단 환불 전수) 선행 권장.

## 6. 현장 확인 방법 (김주연 총괄 안내용)
- 로그인 → 마감 내역 → 2026-08-18 → [현금] 탭.
- B-2 반영 후: 이금득 건에 **−100,000 현금 환불행이 별도 행으로 표시**되어, 화면 개별행 합(635,400)이 화면 하단 [현금] 합계(635,400)와 **일치**하게 됨(현재는 환불행이 카드탭에 숨어 735,400로 보임).
- 회귀 확인: 환불행이 있는 다른 마감일에서도 개별행 합 == [현금] 합계 재확인.

---

## 7. 라이브 재검증 + 전 기간 교차수단 환불 census (2026-08-19, READ-ONLY 재실행)
Phase A 판정을 커밋 doc 신뢰가 아닌 **prod 실데이터 재실행**으로 독립 재확인함(`_diag_readonly.mjs` + parent/census 보강 쿼리). prod WRITE/DDL 0.

### 7-1. 08-18 현금 NET 재실측 (§6 재실행) — 판정 불변
| 항목 | 값 |
|---|---|
| payments(단건) 현금 net | **735,400** (= 현장 수동합) |
| package 현금 net (created_at 축) | **−100,000** |
| package 현금 net (accounting_date 축) | **−100,000** |
| 현금 총계 | **635,400** (= CRM 표시) |
| `diff_list_minus_hap` | **0** → 날짜축 divergence 배제 확정 |

- 부모 레그 `2d58854a` 직접 조회 = `payment_type=payment, method=**card**, 100,000` → **교차수단 환불(카드 원결제 → 현금 환불) 못박음.**
- ∴ 100k 갭 = 환불행(5ffd4b57) 자체 method(cash)로 현금 총계만 −100k, 카드 총계는 미차감(+100k) → **결제수단별 desync, net 정상.** 이중차감·표시 SUM 버그 아님 재확인.

### 7-2. ★전 기간 교차수단 환불 전수 census (소급 영향범위 = 4건)
환불행 method ≠ 원결제행 method 인 전 기간 행 (payments + package_payments):

| # | 소스 | refund_id(앞8) | 날짜(accounting) | 금액 | 원결제→환불 |
|---|---|---|---|---|---|
| 1 | package | 5ffd4b57 | 2026-08-18 | 100,000 | **card→cash** (이금득, 본건) |
| 2 | package | ad2cb3a1 | 2026-07-30 | 1,400,000 | transfer→card |
| 3 | package | 2a074445 | 2026-07-28 | 1,260,000 | transfer→card |
| 4 | 단건 | b062b29f | 2026-07-28 | 8,800 | cash→card |

- 각 건은 해당 마감일의 **결제수단별 합계를 그 금액만큼 desync**(한 수단 과소·다른 수단 과대, net 불변) 시킴 → **구조적 상시 재발 = 설계 결함 확정**(우발적 1회 버그 아님).
- B-3(소급 정정) 대상 = 위 4행. **archive-first · DA CONSULT · 현장 per-row confirm(물리 실사 대조) · supervisor dry-run** 게이트. 정정은 "환불이 어느 수단으로 물리 집행됐나"(현금서랍/카드취소 실사) 확인 후에만 — CRM 값 임의 변경 금지.

### 7-3. Phase B 진행 상태 (planner 확정 대기)
- **B-2 (view-layer 표시 재정합)**: 커밋 `8a5d48b5` (FE-only, `db_change=false`, 회귀 0) — origin/work 브랜치 push 완료. main 반영은 supervisor 게이트. merge 루프에 `if (r.method !== orig.method) continue;` 가드 = 교차수단 환불을 자체 행으로 렌더 → 환불행 method 탭에서 −amount 노출 → [화면행 합 == 총계] 재정합. totals reduce 불변(L928-929/L2240) 코드 대조로 회귀 0 확인.
- **B-1 (write-path RPC 승계, 주범 근본수정)**: 환불 RPC들이 환불행 method 를 원결제 `v_orig.method` 서버 강제 승계. **money-path = DA CONSULT 필수 · db_change=TRUE.** F4717(blocked)과 통합. 미착수(별 게이트).
- **B-3 (소급 정정)**: 위 7-2 4행. 미착수(별 게이트).
