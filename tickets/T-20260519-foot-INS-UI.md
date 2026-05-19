---
id: T-20260519-foot-INS-UI
domain: foot
priority: P1
status: deploy-ready
title: 풋센터 건보 UI 통합 + 시드 데이터
created: 2026-05-19
assignee: dev-foot
db-change: true
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260519-foot-INS-UI.spec.ts
deploy_commit: 38e152a50df6d6a34c280ec3ab449cfe5e204f88
related:
  - T-20260504-foot-INSURANCE-COPAYMENT
  - T-20260515-foot-KENBO-API-NATIVE
  - T-20260507-foot-CHART2-INSURANCE-FIELDS
---

# T-20260519-foot-INS-UI — 풋센터 건보 UI 통합 + 시드 데이터

## 개요
INSURANCE-COPAYMENT(84e9a6a) 기반 건보 UI를 insurance_claims 기반 청구 흐름으로 고도화.
copayCalc.ts 로직 분리 + 4개 신규 테이블 + 시드 정비 + InsuranceCopaymentPanel → insurance_claims upsert 연동.

## 현장 클릭 시나리오

### 시나리오 A: 보험 등급 입력 → copay 산출 → 결제 다이얼로그 표시
1. 고객 차트 → 건강보험 자격 섹션 → 등급 선택 (예: 1등급)
2. 결제 다이얼로그 열기 → "급여 진료비 미리보기" 토글 클릭
3. InsuranceCopaymentPanel 펼쳐짐 → 급여 항목 목록 표시
4. 항목 1개 이상 선택 → 본인부담 금액 산출
5. "산출 이력 저장" 버튼 클릭 → insurance_claims draft 저장
6. 결제 완료 → service_charges INSERT (append-only 감사 로그)

## AC (구현 완료)
- AC-1: copayCalc.ts 분리 (순수 산출 함수), insurance.ts 하위호환 재수출
- AC-2: insurance_claims/claim_items/claim_diagnoses/edi_submissions 마이그레이션
- AC-3: 풋센터 급여 서비스 hira_score/hira_category 시드 정비 (AA254/AA157/D7020)
- AC-4: InsuranceCopaymentPanel → insurance_claims upsert 연동 (check_in_id 기준 draft 1건)
- AC-5: service_charges append-only 감사 로그 유지 (이중기록 방지)

## 빌드
- tsc -b + vite build ✅ (3853 modules, 에러 0)

## E2E Spec
- 경로: `tests/e2e/T-20260519-foot-INS-UI.spec.ts`
- 5 tests: AC-1 import 정상 / AC-3 패널 열기+급여항목 / 시나리오1 본인부담 표시 / 시나리오2 등급변경 UI / AC-4 저장버튼 / AC-5 저장완료 메시지

## DB 변경
- insurance_claims 테이블 신규 (check_in_id FK)
- claim_items, claim_diagnoses, edi_submissions 테이블 신규
- 롤백: migration down SQL (supabase/migrations/ 내 .down.sql)

## 변경 파일
| 파일 | 내용 |
|------|------|
| `src/lib/copayCalc.ts` | 신규 — 순수 산출 함수 141줄 |
| `src/lib/insurance.ts` | 리팩터 (180줄 → 하위호환 재수출) |
| `src/lib/types.ts` | insurance_claims 타입 45줄 추가 |
| `src/components/insurance/InsuranceCopaymentPanel.tsx` | 412줄 (164줄 수정) |
| `tests/e2e/T-20260519-foot-INS-UI.spec.ts` | E2E 5 tests |

## 배포 대기
- commit: 38e152a50df6d6a34c280ec3ab449cfe5e204f88
- supervisor QA 대기
