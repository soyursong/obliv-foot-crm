---
id: T-20260519-foot-INS-UI
domain: foot
priority: P1
status: deployed
title: 풋센터 건보 UI 통합 + 시드 데이터
created: 2026-05-19
assignee: dev-foot
db-change: true
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260519-foot-INS-UI.spec.ts
deploy_commit: 38e152a50df6d6a34c280ec3ab449cfe5e204f88
qa_result: pass
qa_grade: green
deployed_at: "2026-05-19T16:43:15+09:00"
deployed_by: dev-foot
precheck_pass: true
precheck_at: "2026-05-19T19:15:00+09:00"
e2e_skipped_reason: auth_env
field_soak_until: "2026-05-20T19:15:00+09:00"
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

## QA 결과 (supervisor, 2026-05-19 19:15 KST)

**판정: GO (Green)** — precheck C1~C7 PASS (C2 WARN: auth_env — 차단 없음)

| 항목 | 결과 |
|------|------|
| C1 env 매트릭스 | PASS |
| C2 E2E spec | WARN (auth_env — spec 실재, 실행은 맥북 자격증명 미설정) |
| C3 RLS/DB | PASS (migration + rollback SQL 실재, RLS 전 테이블 적용) |
| C4 Cross-CRM | PASS (신규 테이블만, contract 테이블 변경 0건) |
| C5 빌드 | PASS (3.34s, exit 0) |
| C6 Lovable | N/A (foot=Vercel) |
| C7 배포 알림 | PASS (C0ATE5P6JTH) |

**배포 확정**: commit 38e152a → origin/main merge (2026-05-19 16:43:15 KST) → Vercel 자동 배포.
**field_soak_until**: 2026-05-20 19:15 KST

> 배경: esc1 PHANTOM_DEPLOY_VOIDED 판정은 관제탑 맥북 stale clone(23일) 오판. RETRACTION MSG-20260519-190500-rtr1 수신, supervisor 재검증으로 모든 파일·커밋 실재 확인 후 GO 판정.
