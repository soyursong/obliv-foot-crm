---
id: T-20260524-foot-INS-DOC-COPAY-LINK
domain: foot
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
spec_added: true
e2e_spec: tests/e2e/T-20260524-foot-INS-DOC-COPAY-LINK.spec.ts
summary: "InvoiceDialog 급여(공단+본인) 자동채움 fix + refreshServiceItems copayment_amount + spec AC-1 갱신 + INS-UI BASE_URL fix"
qa_result: fix_applied
qa_grade: pending_recheck
---

## 개요

`InvoiceDialog`(진료비 영수증 등록) 열릴 때 `insurance_claims` draft를 조회하여 급여(공단+본인) 금액을 자동채움.
`service_charges` 비급여 합산도 `nonCovered`에 자동채움.
자동채움 시 teal 뱃지 "산출 결과에서 불러왔습니다 (수정 가능)" 표시.
`bill_detail` 배치출력 서비스항목에 `copayment_amount` 추가 → 본인부담금/공단부담금 열 채움.

## 수정 파일

- `src/components/DocumentPrintPanel.tsx`
  - `InvoiceDialog` useEffect(open): `insurance_claims` + `service_charges` 조회 → 자동채움
  - `autoFilledFromClaim` state + teal 뱃지 JSX
  - 배치출력 service_charges SELECT에 `copayment_amount` 추가 + billItems 전달
- `src/lib/htmlFormTemplates.ts`
  - `buildBillDetailItemsHtml` item 타입에 `copayment_amount?: number` 추가
  - 본인부담금(col8)/공단부담금(col9) 열 실제 값 렌더링

## QA 검증 포인트

1. 결제 다이얼로그에서 InsuranceCopaymentPanel 저장 → InvoiceDialog 열면 급여 금액 자동채움 확인
2. 뱃지 "산출 결과에서 불러왔습니다 (수정 가능)" 표시 확인
3. draft 없을 때 기존처럼 0 초기화 유지 확인
4. 비급여 항목만 있을 때 nonCovered 자동채움 확인
5. bill_detail 일괄출력: 급여 항목 본인부담금/공단부담금 열 값 표시 확인

## 빌드

```
✓ tsc -b + vite build 통과 (3.12s)
```

## DB 변경

없음 (기존 insurance_claims, service_charges SELECT만 확장)

## 커밋

`0e4c37b` fix(InvoiceDialog): insurance_claims draft 자동채움 + bill_detail 본인부담 열 연동

## FIX-REQUEST 반영 (2026-05-24)

### 수정 내역
1. **DocumentPrintPanel.tsx L2335**: `setInsuranceCovered(claim.total_covered ?? 0)` →
   `setInsuranceCovered((claim.total_covered ?? 0) + (claim.total_copayment ?? 0))`
   — 급여(공단+본인) = total_covered + total_copayment. 기존엔 공단부담만 채워 급여 본인부담 누락.

2. **DocumentPrintPanel.tsx ServiceChargeItem interface**: `copayment_amount?: number | null` 필드 추가

3. **DocumentPrintPanel.tsx refreshServiceItems**: SELECT에 `copayment_amount` 추가 + 매핑에 `copayment_amount` 포함
   — IssueDialog 세부내역서 본인부담 열이 '0'으로 표시되던 문제 해결.

4. **T-20260524-foot-INS-DOC-COPAY-LINK.spec.ts AC-1**: 틀린 값 assert 제거 →
   `setInsuranceCovered(` + `total_copayment` 존재 검증으로 갱신.

5. **T-20260519-foot-INS-UI.spec.ts**: BASE_URL fallback `localhost:5173` → `localhost:8082` (dev 서버 포트 정합)

### 빌드
```
✓ tsc -b + vite build 통과 (3.23s)
```
