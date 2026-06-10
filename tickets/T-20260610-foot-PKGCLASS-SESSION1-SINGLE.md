---
id: T-20260610-foot-PKGCLASS-SESSION1-SINGLE
title: "[결제분류] 회수=1 패키지 = 단건 결제 자동 분류 (회수 기반 단건/패키지 자동 판별)"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 134e769
created: 2026-06-10
assignee: dev-foot
reporter: 김주연(현장 총괄)
source_msg: MSG-20260610-070945-rh82
needs_field_confirm: true
related_tickets:
  - T-20260609-foot-RECEIPT-PKG-ALWAYS
  - T-20260609-foot-TRIAL-REVENUE-ZERO
  - T-20260608-foot-RECEIPT-PKG-PAYCLASS
  - T-20260519-foot-PKG-REVENUE-SPLIT
---

# T-20260610-foot-PKGCLASS-SESSION1-SINGLE

## 요청 (planner NEW-TASK / 김주연 총괄)
"1만원+체험권 패키지 발행건은 단건 결제로 잡히는게 맞다. 패키지 생성 회수+결제금액 매핑해
패키지↔단건 자동 구분되게 가능? 영수증 업로드 매출 무조건 패키지로 했는데, 패키지 생성 시
회수 1회인 건 단건 결제다."

## 핵심 규칙
- 패키지 총 회수(total_sessions)=1 → **단건(payments)** 분류.
- 회수≥2 → **패키지(package_payments)** 유지 (RECEIPT-PKG-ALWAYS 305b0ad 보존).
- 1차 키 = **회수**(금액 보조). 자동 판별(수동선택 X). SSOT = `src/lib/footBilling.isSinglePaymentByCount`.
- 경계: `total_sessions <= 1 → 단건` ("회수≥2 → 패키지"의 여집합. 0회 degenerate도 안전하게 단건).

## REDEFINITION (정합)
- RECEIPT-PKG-ALWAYS(305b0ad, 영수증=항상 package_payments)를 **회수=1 케이스에 한해 supersede**.
- TRIAL-REVENUE-ZERO(b5bbf28, isTrialService 체험권=단건)의 **일반화**. 체험권(회수1)은 계속 단건(AC-6 회귀 금지).

## AC-7 선검증 결과 (구현 가능)
- `packages.total_sessions` 는 결제 분류 시점에 read 가능(전 경로). 스키마 변경 불필요.
- `payments` 테이블: `check_in_id` **NULLABLE**(20260419 초기스키마) + `clinic_id` 존재(20260422000002) +
  `created_at` settable → 영수증/추가결제(내원 비종속) 경로도 payments INSERT 가능.
- **escalate 안 함**(스키마 변경 無). db_change=false.

## 구현 (분류 분기 — 새 경로 신설 없음)
분류 SSOT(`isSinglePaymentByCount`) 단일 헬퍼를 4개 결제 분류 진입점이 공유:
- **(A) 영수증 업로드** `CustomerChartPage.ReceiptUploadSection.handlePaymentConfirm`
  - activePkgs 조회에 `total_sessions` 동반. 회수1 → `payments`(단건, check_in_id=null) + packages.paid_amount 직접 가산. 회수≥2 → 기존 package_payments.
- **(B) 패키지 발행 결제** `PaymentDialog.handleSubmit`(package mode)
  - 패키지 row 는 그대로 발행(paid_amount=totalAmount, 1회 세션 소진 추적) + check_ins.package_id 연결 유지.
    `tmplTotalSessions<=1` 이면 결제만 `insertPayments`(payments, 단건)로 라우팅, 아니면 package_payments.
- **(C) 패키지관리 추가결제** `Packages.PackagePaymentAdd.save` — 동일 SSOT 적용(같은 회수1 패키지가 경로마다
  다르게 분류되는 구멍 차단). 회수1 → payments(check_in_id=null) + paid_amount 가산.
- **(미접촉)** PaymentMiniWindow(소진/차감)은 이미 payments(단건) 경로 + 체험권 단건 처리(TRIAL-REVENUE-ZERO) → 무변경.

## 무파괴 / 정합
- Closing 은 payments(단건)·package_payments(패키지) 행을 각각 집계 → 분기만으로 단건 버킷 정확 산입(이중집계 0).
- 회수1 패키지의 paid_amount 는 payments 행이 package_payments 합계 밖이므로 직접 가산해 "미납" 오표시 방지.
- 회수≥2 RECEIPT-PKG-ALWAYS 동작 불변(AC-2). 체험권(회수1) 단건 보존(AC-6).

## E2E (tests/e2e/T-20260610-foot-PKGCLASS-SESSION1-SINGLE.spec.ts)
- 시나리오 3(AC-3): 회수1 영수증 → payments 생성·package_payments 0 (entry A 통합).
- 시나리오 2(AC-2): 회수10 영수증 → package_payments 유지·payments 0 (회귀 가드).
- 시나리오 4(AC-6): 체험권(회수1, 1만원) 영수증 → payments 단건 보존.
- 시나리오 1(AC-1): 발행 분류 계약 — 회수1=단건/회수2+=패키지 헬퍼 경계 회귀 차단(entry B/C 동일 헬퍼 동치 보증).
- UI 통합 3건은 테스트 env storage 미도달 시 graceful skip(기존 RECEIPT-PKG-ALWAYS spec 동일 거동) → soak env 실행.

## 과거 소급 (scope 외)
- 회수1인데 기존 package_payments 로 잡힌 과거건 백필은 **scope 외**(planner 별도 게이트). 코드/데이터 단독 백필 금지.
- 필요 시 영향 건수만 read-only 산정 보고.

## risk
GO_WARN — 정산 영향이나 reporter 자기재정의 + 비파괴 분류정정. db_change 無.
