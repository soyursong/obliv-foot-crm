---
id: T-20260504-foot-INSURANCE-COPAYMENT
domain: foot
priority: P1
status: deployed
title: 건보 본인부담분 자동 산출
created: 2026-05-04
assignee: dev-foot
db-change: true
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/unit/ (27+ unit tests — see 84e9a6a commit body)
qa_result: pass
qa_grade: Green
deploy_commit: 84e9a6a7070b3980ba9623c72e2ae3920bc327e0
deployed_at: "2026-05-04T18:38:36+09:00"
---

# T-20260504-foot-INSURANCE-COPAYMENT — 건보 본인부담분 자동 산출

## 개요
풋센터 건강보험 본인부담분 자동 산출 기능. 9등급 체계 + 급여 서비스 수가 코드 기반 copay 계산.

## AC (구현 완료)
- AC-1: DB 스키마 — clinics(hira_unit_value/year) + customers(rrn_vault_id, insurance_grade*) + services(is_insurance_covered, hira_*) ALTER + service_charges 신규 테이블 + RPC calc_copayment
- AC-2: 풋센터 기본 급여 서비스 시드 5건 (진찰료 초진/재진, KOH 검사, 처방료, 진단서)
- AC-3: lib/insurance.ts — 9등급/source/카테고리 라벨 + 순수 calcCopaymentLocal (정액제·override·unit_value 분기)
- AC-4: hooks/useInsurance.ts — useCalcCopayment / calcCopaymentBatch / updateInsuranceGrade / useInsuranceGrade
- AC-5: InsuranceGradeSelect 컴포넌트 — 9등급 그리드 + source 4개 + 90일 stale 뱃지 + 메모
- AC-6: InsuranceCopaymentPanel — PaymentDialog 상단 미리보기 (급여 항목 다중선택 → RPC 산출 → 합계 + service_charges INSERT)
- AC-7: Customers 차트 — 건강보험 자격 섹션 추가 (rrn Vault TODO 안내)
- AC-8: DocumentPrintPanel field_map — insurance_covered/copayment/non_covered + service_charges 우선 합산
- AC-9: 단위 테스트 27+ 케이스 (9등급 × 시나리오 + 엣지)
- AC-10: 빌드 PASS (2.52s, 에러 0)

## 주의사항
- rrn 평문 저장 금지: 컬럼만 확보, Vault Edge Function은 후속 작업
- xlsx 전체 매핑 후속 예정

## 변경 파일
- `src/lib/insurance.ts` — 신규
- `src/hooks/useInsurance.ts` — 신규
- `src/components/insurance/InsuranceGradeSelect.tsx` — 신규
- `src/components/insurance/InsuranceCopaymentPanel.tsx` — 신규
- `src/pages/Customers.tsx` — 건강보험 자격 섹션 추가
- `src/components/documents/DocumentPrintPanel.tsx` — field_map 확장
- `supabase/migrations/` — clinics/customers/services ALTER + service_charges + calc_copayment RPC
- `supabase/seed/` — 풋센터 급여 서비스 5건

## 배포 이력
- 2026-05-04 18:38 commit 84e9a6a → Vercel 자동 배포
