---
ticket_id: T-20260525-foot-DOC-AUTOBIND-REGRESS
title: 서류 자동 바인딩 회귀 — 고객정보·처방약·상병코드 복원
status: deploy-ready
priority: P2
domain: foot
created: 2026-05-25
deploy_ready: true
deploy_ready_at: 2026-05-25T23:45:00+09:00
build_ok: true
db_change: false
spec_file: tests/e2e/T-20260525-foot-DOC-AUTOBIND-REGRESS.spec.ts
go_warn: 1
---

## 개요

PRINT-FORM-BIND(3cd5c8d) / DOC-CODE-INSERT(32accd1) 이후 서류 자동 바인딩에서 발생한 회귀를 조사하고 잔여 버그를 수정.

INS-FIELD-BIND(6efe66e)에서 AC-3(상병코드 전건)이 구현된 것을 확인하고, 나머지 AC 처리.

---

## AC별 결과

### AC-1: 회귀 원인 조사 ✅ 완료

**PRINT-FORM-BIND(3cd5c8d) 회귀**:
- `handleBatchPrint` 내 service_charges 쿼리에 `category_label` 미포함 → 상병코드 배치 미주입
- **수정**: INS-FIELD-BIND(6efe66e)에서 완료 ✅

**DOC-CODE-INSERT(32accd1) 회귀**:
- PaymentMiniWindow가 `loadMiniAutoBindValues`(7필드) 사용 → patient_rrn·record_no·doctor_license_no 누락
- **수정**: DOC-PRINT-UNIFY에서 `loadAutoBindContext`(전건)으로 교체 완료 ✅

**잔여 IssueDialog 버그**:
- 초회 `useEffect` service_charges 쿼리에 `copayment_amount` 미포함 → `bill_detail` 본인부담금 열 0 표시
- `refreshServiceItems`(add/edit/delete 후 재조회)는 포함 → 불일치
- **수정**: 이번 커밋에서 쿼리 + 매핑 + allValues bill_detail 동기화 ✅

### AC-2: 고객정보 연동 전건 복원 ✅ 완료

`autoBindContext.buildAutoBindValues`가 반환하는 고객정보 전건 확인:
- `patient_rrn` (주민번호) — `rrn_decrypt` RPC ✅
- `record_no` (차트번호) — `customer.chart_number` fallback `customer_id[:8]` ✅
- `doctor_license_no` (면허번호) — `clinic_doctors.license_no` ✅
- `doctor_specialist_no` (전문의번호) — `clinic_doctors.specialist_no` ✅
- `patient_address` — `address + address_detail` 조합 ✅
- `patient_gender` — 체크박스 형태 ✅
- `insurance_grade_label` / `copay_rate` ✅

IssueDialog 초회 useEffect `copayment_amount` 누락 수정 (이번 커밋):
- select에 `copayment_amount` 추가
- items 매핑에 `copayment_amount: (c.copayment_amount as number | null) ?? null` 추가
- allValues `bill_detail` billItems에 `copayment_amount: item.copayment_amount ?? undefined` 추가

### AC-3: 상병코드 전건 ✅ INS-FIELD-BIND(6efe66e) 동일 범위 확인

6efe66e 커밋이 DOC-AUTOBIND-REGRESS AC-3과 동일 범위 커버 확인:
- IssueDialog `allValues` useMemo: diagChargeItems 필터 + diag_code_N 주입 ✅
- `handleBatchPrint`: diagBatchItems 필터 + autoValues에 주입 ✅
- 대상 form_key 8종: diagnosis/treat_confirm/visit_confirm/diag_opinion/diag_opinion_v2/rx_standard/ins_claim_form/bill_detail(N/A) ✅

### AC-4: 처방약 코드 연동 — rx_standard 상병코드 항목 제외 ✅ 완료

**변경 전**: IssueDialog `allValues` rx_standard에 ALL serviceItems → 상병코드 항목도 처방전에 삽입
**변경 후**: `rxServiceItems = serviceItems.filter((i) => i.category_label !== '상병')` → 상병코드 제외

PaymentMiniWindow는 이미 `buildCodeEnrichedValues`에서 `category_label === '처방약'`으로 정확히 필터 → 변경 불필요 ✅

---

## 코드 변경 요약

### `src/components/DocumentPrintPanel.tsx`

1. **IssueDialog useEffect 초회 쿼리 (AC-2)**:
   - select에 `copayment_amount` 추가
   - items 매핑에 `copayment_amount` 포함

2. **allValues useMemo — bill_detail (AC-2)**:
   - billItems에 `copayment_amount: item.copayment_amount ?? undefined` 추가

3. **allValues useMemo — rx_standard (AC-4)**:
   - `rxServiceItems = serviceItems.filter((i) => i.category_label !== '상병')` 추가
   - rxItems를 rxServiceItems 기반으로 변경

### `tests/e2e/T-20260525-foot-DOC-AUTOBIND-REGRESS.spec.ts` (신규)
- 35 케이스 전 통과

### `playwright.config.ts`
- unit 프로젝트에 DOC-AUTOBIND-REGRESS + INS-FIELD-BIND spec 추가

---

## E2E 결과

```
35 passed (6.6s)
```

---

## DB 변경

없음 (DB_CHANGE: false)

---

## 빌드

```
✓ built in 3.21s
```
