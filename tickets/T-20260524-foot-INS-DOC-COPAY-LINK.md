---
id: T-20260524-foot-INS-DOC-COPAY-LINK
domain: foot
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
spec_added: false
summary: "InvoiceDialog insurance_claims draft 자동채움 + bill_detail 본인부담 열 연동"
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
