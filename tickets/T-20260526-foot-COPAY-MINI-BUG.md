---
id: T-20260526-foot-COPAY-MINI-BUG
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
commit: ccbb3cc
db_migration: true
db_migration_files:
  - supabase/migrations/20260526100000_services_insurance_covered_fix.sql
  - supabase/migrations/20260526110000_calc_copayment_price_fallback.sql
build_passed: true
spec_added: false
reporter: 김주연 총괄
created_at: 2026-05-26
closed_at: 2026-05-26
---

# T-20260526-foot-COPAY-MINI-BUG — 건보 "일반" 등급 시 미니 결제창 급여/비급여 분류 미반영 버그

## 버그 요약

건강보험 자격등급 "일반" 저장 후 미니 결제창을 열면, hira_code를 보유한 수가항목(AA154·D6203 등)이
전부 "면세"로 분류되어 급여=0, 비급여(면세)=329,380 출력됨.

## 근본 원인

`getTaxClass(svc)` 함수가 `svc.is_insurance_covered` 만 참조하고,
고객의 건보 등급(insurance_grade)을 전혀 전달받지 못하는 구조적 누락.
→ hira_code가 있어도 is_insurance_covered가 false/null이면 비급여 분류.

## 수용기준 (AC) 구현 내역

| AC | 내용 | 구현 |
|----|------|------|
| AC-1 | 건보 "일반" 시 hira_code 보유 항목 → 급여 분류 | COVERED_GRADES set + getTaxClass(svc, insuranceGrade) |
| AC-2 | 급여 항목 본인부담 30% 자부담금 산출 | copaymentTotal 계산 + UI 표시 (파란색 라인) |
| AC-3 | 비급여 항목 기존 면세 유지 | 미변경 |
| AC-4 | 건보 미설정/미가입 시 기존 동작 무변경 | null/foreigner/unverified → 기존 흐름 |
| AC-5 | 빌드 성공 | tsc -b && vite build ✓ |

## 변경 파일

- `src/components/PaymentMiniWindow.tsx`

## 주요 변경 요약

1. **import 추가**: `InsuranceGrade`, `getBaseCopayRate` from `@/lib/insurance`
2. **COVERED_GRADES** 상수 추가 (general/low_income_1/2/medical_aid_1/2/infant/elderly_flat)
3. **getTaxClass** 2번째 인자 `insuranceGrade` 추가 — 등급 유효 + hira_code → '급여'
4. **SortablePricingRowProps** + 컴포넌트에 `insuranceGrade` 추가
5. **customerInsuranceGrade state** 추가 + customers 테이블 비동기 로드
6. **totalByTax** 루프에 insuranceGrade 반영
7. **copaymentTotal** 산출 (100원 절상, copayCalc.ts 동일 규칙)
8. **UI** — 급여 자부담 (30%) 파란색 라인 표시

## DB 변경

없음 — customers.insurance_grade 읽기만.

## 관련 티켓

- T-20260520-ins-COPAY-CALC (deploy-ready) — 산출 로직 별개, 분류 수정 후 정합성 확인 권장
