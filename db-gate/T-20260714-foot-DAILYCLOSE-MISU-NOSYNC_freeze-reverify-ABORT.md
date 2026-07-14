# T-20260714-foot-DAILYCLOSE-MISU-NOSYNC — Step 1 freeze 재검증 → **ABORT** (evidence)

- author: dev-foot · 2026-07-14
- 정본 계획: `_handoff/da_replies/DA-REPLY-T-20260714-foot-DAILYCLOSE-MISU-NOSYNC.md` (DA-20260714-MISU-REPOST)
- 판정: **데이터 정정(Step 1~3) 미집행 — ABORT.** DA Step 1 재검증 ABORT 조건 2건 모두 성립.
- 방식: **READ-ONLY 라이브 prod 프로브만 실행** (write 0). script `scripts/T-20260714-foot-DAILYCLOSE-MISU-NOSYNC_probe.mjs`.

---

## 1. 라이브 prod 실측 (2026-07-14, ref rxlomoozakkjesdqjtvd)

| 앵커 | DA 계획 전제 | 라이브 실측 | ABORT? |
|---|---|---|---|
| `closing_manual_payments` d993ffc5 | 존재·amount=2,890,000 | **행 부재 (하드삭제됨)** | ✅ 성립 (행부재) |
| `package_payments`(pkg e55c868d) | **count = 0** | **count = 1** (2,890,000 / payment / fee_kind=package) | ✅ 성립 (count≠0) |
| pkg e55c868d | total 2,890,000 / pp 0 | total 2,890,000 / **paid 2,890,000 / balance 0** | — |
| void 3컬럼 | 신설 예정 | **미존재** (Step 0 미적용) | — |
| F-4695 미수(SSOT) | 2,890,000 | **0** (이미 해소됨) | — |

**결정적 증거 — 기존 package_payments 행 memo:**
> `일마감 수기결제 정본화(F-4695, opt-A) T-20260714-DAYCLOSE-MANUAL-PAY` (created 2026-07-14 02:09Z)

→ 본건 정정은 **병렬 세션(opt-A Part1, 티켓 DAYCLOSE-MANUAL-PAY / CUSTBOX-UNPAID-SYNC)이 이미 prod에 집행**했다.

## 2. 무엇이 divergence 인가

1. **방식 위반**: opt-A Part1 은 수기행 d993ffc5 를 **hard-DELETE** 했다. DA 는 hard-DELETE 를
   **반려**하고 **soft-void 강제**(비파괴·완전 원복·순소실0·감사가능)를 정본으로 확정했다(A1/A2).
   즉 현재 prod 상태는 **미수=0(기능적 정답)이나 DA 가 금지한 파괴적 경로로 달성**됨.
2. **감사추적 부재**: void 컬럼 미신설, 수기행 물리삭제 → DA 가 요구한 "행 존치=순소실0·감사가능"
   불성립. (단, 삭제행 원데이터는 opt-A `..._F4695_rollback.sql` FROZEN SET 에 보존되어 **복원 가능**.)
3. **재집행 위험**: 현 상태에서 DA Step 2 를 그대로 집행하면 package_payments **이중 INSERT**
   → 2,890,000 × 2 = 5,780,000 과수납·pkg over-payment 오염. **절대 금지.** (ABORT 이유)
4. **활성 재무오류는 없음**: 현재 07-14 마감에서 수기행(2,890,000) 부재 + package_payment(2,890,000)
   존재 → **이중계상 없음**. 기능적으로 미수=0·매출 정합. 즉시 재무 손해 없음.
5. **미해소 deconfliction**: 동일 area(closing_manual_payments·F-4695) 4개 티켓 병존
   (DAILYCLOSE-MISU-NOSYNC / DAYCLOSE-MANUAL-PAY(opt-A) / SAMEDAY-MANUALPAY-REMAP / RETRO-BACKFILL).
   single-owner 지정 FOLLOWUP(MSG-170505-x5y9) 미해결.

## 3. blocker-② 미수 판별자 (해소 — 참고)

foot 라이브 산식 확정: `packageDue = packages.total_amount − Σ signed(package_payments.amount WHERE fee_kind='package')`
(signed: payment_type='refund'→음수). migration `20260617120000_pkg_consultation_fee_and_payment_feekind.sql`
로 `fee_kind` 실재(NOT NULL DEFAULT 'package'). → INSERT 판별자 = **fee_kind='package' + payment_type='payment'**.
(현존 opt-A 행이 이미 이 판별자로 삽입되어 미수 0 달성.)

## 3-b. blocker-① A3 grossTotal manual 포함 여부 (해소 — 참고)

foot 라이브 `Closing.tsx` grossTotal = `totalCard+totalCash+totalTransfer`,
`totalCard = pkgCard + singleCard + **manualCard**` → **manual 포함**(DA 가 본 body 워크트리와 갈림).
→ 원 계획상 FE grossTotal 도 이중계상 대상이었으나, opt-A 가 수기행을 삭제해 현재는 이중계상 없음.

## 4. 권고 (planner/DA 판단 요청 — dev 단독 진행 금지)

- **(A) 현상 인정 + void-infra 재범위화(권장)**: F-4695 미수 데이터 정정은 opt-A 로 **이미 해소(단 파괴적)**
  → 본 티켓 데이터 파트는 *superseded* 처리. void 3컬럼 ADDITIVE + 전 합산경로 `WHERE voided_at IS NULL`
  (FE grossTotal + 마감payload 비급여버킷 + Silver 팩트뷰) 는 **재발 방지용 forward 프리미티브**로 분리 티켓화
  (cross-CRM 전파 대상). 원자배포·silver 조율 필요.
- **(B) 감사복원(DA 방식 정합)**: opt-A rollback.sql 로 d993ffc5 복원 + package_payment 제거 → Step0 void-infra
  적용 → DA Step2 로 **soft-void 재집행**. 파괴흔적 제거·DA 정본 방식 달성. 단 orchestration·single-owner·게이트 필요.
- **(C) DA 재판정**: opt-A 가 DA 금지 방식(hard-DELETE)으로 prod 선집행한 governance 이슈 + divergence 를 DA 에 통지, 방식-of-record 확정.

**dev-foot 조치**: 데이터 write 0, deploy-ready 미마킹, 병렬세션 미커밋 코드(opt-A working tree) 미접촉.
