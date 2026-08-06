# 플랜A ② 분할결제(복수 결제수단) — AC-0 설계안

- 티켓: `T-20260806-foot-PLANA-SPLIT-MULTIPAY` (P2, GO_WARN, design-first)
- parent: `T-20260806-foot-PLANA-SCOPE-BASELINE-DIRECTIVE` §3-② / §6-② / §9(3순위)
- reporter: 최필경 총괄(U05L6HE7QF6) · origin C0ATE5P6JTH
- 작성: agent-fdd-dev-foot · 2026-08-06

> ⚠ 본 문서는 **AC-0 설계 선행 산출물**이다. planner/reporter 확인 후 UI 배선·현장 field-soak 진입.
> 본 커밋에 포함된 코드는 **순수 로직(스키마 무접촉·기능플래그 OFF·UI 미배선)** 뿐이며,
> 실 단말 왕복(할부·부분취소불가·5만원↑서명)은 INSTALLMENT-HALBU 선례대로 현장 검증(총괄).

---

## 0. 결론 요약 (3대 설계 판정)

| AC-0 항목 | 판정 | 근거 |
|---|---|---|
| (a) 이중결제 잠금 예외처리 | **기존 3층 잠금 유지 + `patient_completed`(소프트 confirm)만 분할 컨텍스트에서 억제** | `patient_in_progress`(하드)·`terminal_busy`(하드)는 그대로 안전. 순차 분할은 하드락을 자연 통과(레그K 승인→락 해제→레그K+1) |
| (b) 중간 실패 부분결제 UX | **자동취소 절대 금지 · 사람 판단 3옵션(재시도/승인분 취소/유지) 정지 화면** | `splitPayment.ts` 순수 상태머신. 실패/확인필요 발생 시 halt, 자동 롤백 경로 부재(불변식) |
| (c) 한 수납 ↔ 복수 승인번호 묶기 | **스키마 무접촉 — 기존 `check_in_id` 링크로 묶음. 신규 컬럼/테이블/enum 0 → DA CONSULT 불요** | 기존 PMW-SPLIT-PAYMENT(check_in_id 공유 N행) + CAT canon(external_approval_no/payment_attempt_id per leg) 이미 성립 |

**⇒ `db_change=false` 유지. §S2.4 데이터 정책 게이트 = 추가 스키마 0이므로 CONSULT 대상 아님.**

---

## 1. 알려진 조건 (§6-② 규격/실측)

- **코밴 규격**: 한 전문 = 한 결제. 분할이면 전문을 N회 전송(순차).
- 🔴 **중간 실패**: 첫 건 승인 + 둘째 실패 = **부분 결제 상태**. 자동 취소 = 위험 → 사람 판단.
- 🔴 **잠금 충돌**: 한 환자 연속 전송 → 이중결제 잠금 저촉 가능 → 분할 예외 처리.
- **레드페이**: 각각 별개 승인 → CRM이 한 수납에 여러 승인번호를 묶어야 대조 정합.

---

## 2. (a) 이중결제 잠금 예외처리

### 2.1 현행 3층 잠금 (paymentFlow.ts §AC-6)

- **(하드) 한 환자 in-flight**: L2 partial UNIQUE `(clinic_id, check_in_id) WHERE status='requested'`.
  insert-first 시점 23505 발화 → 송신 0. `patient_in_progress`.
- **(하드) 한 단말 busy**: 서버 read-recheck(`probeConcurrent`) + CAT 동시1건 한도. `terminal_busy`.
- **(소프트) 한 환자 완료건 재결제**: `patient_completed`(살아있는 완료 결제 존재) → confirm 유도(allowOverride=true).

### 2.2 순차 분할은 하드락을 **자연 통과**한다

레그를 순차 실행하면 레그K는 `approved`(터미널)로 전이된 뒤에야 레그K+1 insert-first가 일어난다.
→ 동시 `requested` 2건이 존재하지 않음 → L2 partial UNIQUE 미발화. **하드락 무저촉(안전 유지).**

### 2.3 유일 마찰점 = `patient_completed` 소프트 confirm

레그1 승인 직후 레그2 진입 시 `hasLiveCompletedPayment`=true → "이미 결제된 환자" confirm이 매 레그 반복.
분할은 **추가 결제가 의도된 것**이므로 이 소프트 confirm을 분할 세션 컨텍스트에서만 억제한다.

### 2.4 예외 처리 방식 (additive · 무차단)

`classifyConcurrency(probe, { splitContext: true })` → `patient_completed`만 통과(blocked=false).
`patient_in_progress`·`terminal_busy`(진짜 동시성 하드 안전)는 **그대로 차단 유지**.

- default(`splitContext` 미지정) = 기존 동작 완전 동일(회귀 0, 전 기존 spec 통과).
- 분할 세션 진입 후 각 레그 precheck에만 `splitContext: true` 전달.
- **하드백스톱은 유지**: 진짜 두 실장 동시결제(응답 전 in-flight)는 여전히 하드 차단.

---

## 3. (b) 중간 실패 부분결제 상태 UX — 자동취소 금지

### 3.1 세션 상태머신 (`src/lib/cband/splitPayment.ts`, 순수)

- 세션 = 순서 있는 레그 N개. 각 레그 outcome: `pending | approved | failed | attention`.
- `nextPendingLeg(session)` → 다음 실행할 레그 index (없으면 null).
- `applyLegResult(session, i, PaymentFlowResult)` → 레그 outcome 확정.
- `classifySession(session)`:
  - `idle` (아직 시작 전) / `in_progress` (진행 중)
  - `completed` (전 레그 approved)
  - `partial_failure` (일부 approved + 일부 failed/attention) ← **핵심 정지 상태**
  - `failed` (approved 0)
- **불변식 (하드 규칙)**: `failed`/`attention` 레그 발생 즉시 `advanceHalts=true` → **자동 진행/자동 취소 경로 없음.**
  auto-cancel 함수·자동 롤백 분기는 코드에 **존재하지 않는다**(spec로 강제).

### 3.2 사람 판단 옵션 (부분결제 시 노출, `partialFailureOptions`)

| 옵션 | 동작 | 자동성 |
|---|---|---|
| **재시도** | 실패한 레그만 재전송(승인분 무변경) | 사람 클릭 |
| **승인분 취소** | 이미 승인된 레그를 `cancel()`(0430, 원거래 AUTHNO)로 개별 취소 | 사람 클릭 · per-leg confirm |
| **유지** | 부분결제 상태 그대로 저장(실장이 현금 등으로 잔액 별도 수납) | 사람 클릭 |

- `attention`(응답 불명)은 **재시도 옵션 비노출** — 기존 D 상태머신 규칙 계승(자동/수동 재시도 금지, MSG_TRACE 조회 안내).
- 어떤 옵션도 CRM이 임의로 승인분을 취소하지 않는다(AC-2 자동취소 금지 준수).

---

## 4. (c) 한 수납 ↔ 복수 승인번호 묶기 — 스키마 무접촉

### 4.1 기존 구조로 이미 성립

- **PMW-SPLIT-PAYMENT (T-20260616)**: 한 수납을 (method, amount) N행 `payments`로 분리 insert, **동일 `check_in_id` 공유**.
- **CAT canon (paymentFlow)**: 각 카드 레그 승인 → `payments` 1행에 `external_approval_no`=AUTHNO,
  `external_tid`=TID, `payment_attempt_id`=attempt FK 착지.
- ⇒ "한 수납의 여러 승인번호" = **`check_in_id`로 묶인 payments 행들의 external_approval_no 집합**. 신규 링크 불요.

### 4.2 레드페이 대조 정합

- RedPay 매처는 이미 **승인번호(external_approval_no)/TID 단위로 개별 매칭**(redpay-reconcile/matcher).
- 각 레그가 독립 승인번호를 가지므로 레드페이 별개 승인과 1:1 대응 → 자동 정합.
- CRM 화면 묶음 표시 = `collectApprovals(session)` 순수 헬퍼가 세션의 승인 레그 목록을
  {legIndex, method, amount, authNo, msgTrace}로 반환(표시·확인용, 저장은 check_in_id 링크).

### 4.3 왜 신규 컬럼(payment_group_id)을 두지 않는가

- check_in_id가 이미 "한 수납 방문"을 묶는다. 한 방문에 분할 세션이 여럿 겹치는 극단은
  현장 동선상 사실상 부재(수납은 방문당 마감). 필요 시 후속 티켓에서 DA CONSULT로 승격(현재 불요).
- AC-6 동시성방지 선례("스키마 무접촉 → DA CONSULT 불요")와 동일한 판단.

---

## 5. AC 매핑

| AC | 반영 |
|---|---|
| AC-0 설계 선행 | 본 문서 |
| AC-1 순차 전송·개별 승인번호 | `nextPendingLeg`+레그별 `runPaymentFlow`(external_approval_no per leg) |
| AC-2 중간실패 자동취소 금지 | `classifySession`=partial_failure halt + 자동취소 경로 부재(불변식·spec) |
| AC-3 잠금 예외처리 | `classifyConcurrency(probe,{splitContext})` — 소프트만 억제, 하드 유지 |
| AC-4 복수 승인번호 대조정합 | check_in_id 링크 + RedPay per-approval 매칭(스키마 무접촉) |
| AC-5 커플링(취소 짝) | 승인분 취소=기존 `cancel()`(0430) per-leg. 승인불명 자동재시도 금지 |

---

## 6. 배선 계획 (planner/reporter 확인 후)

1. PaymentMiniWindow 분할 동선에서 카드 레그를 splitPayment 세션으로 오케스트레이션.
2. 부분결제 정지 패널(3옵션) UI — 태블릿 UX(teal-emerald·큰 버튼).
3. 기능플래그 `VITE_CBAND_PAY` ON PC에서만 노출(기존 게이트 계승).
4. 현장 field-soak: 실단말 2건 분할·중간실패·연속전송 잠금(총괄).

**미확정/확인 요청**: 부분결제 '유지' 선택 시 잔액을 다른 결제수단(현금 등)으로 이어받는 동선을
기존 PMW split 빌더에 합류시킬지(권장) vs 별도 정산 화면으로 분리할지 — reporter 확인 필요.
