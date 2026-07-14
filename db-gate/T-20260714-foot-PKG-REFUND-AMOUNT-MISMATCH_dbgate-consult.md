# DA CONSULT — T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH

- **from**: dev-foot
- **to**: data-architect (CONSULT), cc planner
- **date**: 2026-07-14
- **domain**: foot (obliv-foot-crm / Supabase rxlomoozakkjesdqjtvd)
- **gate context**: 패키지 환불 산식은 Tier-A 돈-함수(`refund_package_atomic`) 경로. RPC 산식 변경 = 2중 게이트 (a) DA CONSULT GO (b) CRM-PREGATE(김주연 총괄) GO. **본 파일은 (a) 요청.** 실제 RPC 구현은 (a)+(b) 통과 및 총괄 환불정책(A/B/C) 회신 후 착수.
- **cross-ref**: T-20260714-body-SUSUNAEYEOK-REFUND-BUNDLE-GUARD (환불 RPC ADDITIVE 선례, DA 진행 중) / 승계트랙 T-20260713-foot-PAY-REFUND-AMOUNT-INPUT(단건 FE-only, deploy-ready).

---

## 1. 근본원인 (read-only discovery, 코드 실측 — 검증 완료)

패키지 환불 견적/처리 금액은 전적으로 `calc_refund_amount(p_package_id)` 한 함수가 산출한다.
FE 표시(`ClosingRefundDialog`, Closing.tsx:2305)와 RPC 처리(`refund_package_atomic`, 20260603000000:52)가 **동일 함수를 각각 호출** → 표시=처리 (현재는 일치).

`calc_refund_amount` 현행 산식 (초기스키마 20260419000000_initial_schema.sql:412):

```sql
unit_price    = total_amount / total_sessions           -- ★ total_amount = 총액(정가/list)
refund_amount = (total_amount / total_sessions) * remaining_sessions
              = unit_price * (total_sessions - used_sessions)
```

- **분자가 `packages.total_amount`(총액/정가)** 이다. `packages.paid_amount`(실납 = Σ package_payments 순납부 캐시)는 **산식에서 전혀 참조되지 않는다.**
- 즉 할인 패키지(실납 ≪ 총액)에서 환불액이 **정가 기준 단가 × 잔여회차**로 산출 → 실납을 크게 초과한다.

### F-4696(허유희님) 대입 — 결정적(deterministic)
- `total_amount` = 4,880,000 (총액 488만), `total_sessions` = 24, `paid_amount` = 380,000 (실납 38만).
- 정가 단가 = 4,880,000 / 24 = **203,333원/회**.
- 환불액 = 203,333 × 잔여회차.
  - 잔여 24(미사용) → **4,880,000 (488만)** ← 실납의 **12.8배**, 과다환불 **+4,500,000**.
  - 잔여 20 → 4,066,666 (실납의 10.7배).
- 반면 **실납 기준** 회당가 = 380,000 / 24 = 15,833원/회. 잔여 24 → 정당 환불 상한 380,000.

> exact 잔여회차는 prod read-only SELECT 1건이면 확정되나, **과다환불 방향·규모는 잔여값과 무관하게 성립**(정가단가 > 실납단가가 항상 참). 필요 시 planner 승인 하 read-only SELECT로 실측 제공 가능(F-4696 = 실환자 PHI).

---

## 2. discovery 항목별 회신 (착수범위 1~4)

1. **표시 로직 위치 / 실납 컬럼**: 표시 = `pkgQuote.refund_amount` (Closing.tsx:2437), `pkgQuote`는 `calc_refund_amount` RPC 결과. 실제결제금액 컬럼 = **`packages.paid_amount`** (= Σ`package_payments`(payment) − refund 순액, Packages.tsx:1855/1840에서 갱신). **존재하나 환불산식이 미참조.**
2. **RPC 현행 산식**: §1 — `total_amount/total_sessions × remaining`. **총액 기준 확정** (실납 아님).
3. **F-4696 대조**: §1 — 현재 산출 최대 488만 vs 실납 380,000 = 과다환불 위험 확정.
4. **FE-only 가드레일 평가**: §3.

---

## 3. FE-only 임시 가드레일 — 평가 결과

- **표시 교정만(실납 표기) = 불가/위험.** `refund_package_atomic`는 **`p_amount` 파라미터가 없다** — 내부에서 `calc_refund_amount`를 재호출해 산출·INSERT한다. FE가 어떤 값을 넘겨도 처리금액을 바꿀 수 없다. 표시만 380,000으로 고치면 표시(38만)-처리(488만) 불일치로 **더 위험**(티켓 경고와 동일).
- **가능한 유일한 FE-only 안전책 = 하드 블록(제출 차단).** 다이얼로그 오픈 시 `packages.paid_amount`(read-only 1 SELECT)를 조회해 `pkgQuote.refund_amount > paid_amount`이면 **제출 비활성 + 경고**("자동견적이 실납액을 초과 — 정식 환불 산식 수정 전까지 관리자 확인 필요"). 과다환불을 **거래 거부로 방지**한다(금액 처리 무변경, RPC/스키마 무접점).
  - carve-out 성격 = 승계 티켓 713과 동일한 FE-only 금전경로(제출 차단 방향, GO_WARN 예상). **DB/RPC 무접점 → DA/PREGATE 불요**로 판단하나 금전경로이므로 supervisor QA + planner carve-out 확인 하에 즉시 hotfix 가능.
  - 한계: 이는 **정당 부분환불을 가능케 하지 않는다**(방어 stop). 정상 환불 재개는 RPC 산식 교정(정식 fix) 필요.

---

## 4. DA 판정 요청 (정식 fix — RPC 산식 교정)

최종 산식은 **총괄 환불정책 회신(A/B/C: 잔여회차 기준 vs 실납 기준)** 에 종속. planner가 confirm 요청 발행함(회신 대기). 아래는 기술 설계안 + ADDITIVE 여부 판정 요청.

| 안 | 산식 | 스키마 영향 | 비고 |
|----|------|------------|------|
| **A. 실납 pro-rata** (권장) | `refund = round(paid_amount * remaining_sessions / total_sessions)` | **신규 컬럼 0** (기존 `paid_amount` 재사용) | `calc_refund_amount` 본문 분자를 `total_amount`→`paid_amount`로 교체. 함수 시그니처 불변. |
| **B. 실납 − 소비가치** | `refund = paid_amount - round(paid_amount * used_sessions / total_sessions)` | 신규 컬럼 0 | A와 반올림 외 동치. |
| **C. 스태프 수기입력** | `refund_package_atomic`에 `p_amount` 추가, FE에서 `≤ paid_amount` 검증 | 신규 컬럼 0, **돈-함수 시그니처 변경** | 단건(refund_single_payment)과 동선 통일. 서명변경 = 계약 영향. |

**요청 사항**:
1. A/B(본문 산식 교체, 시그니처 불변)가 **ADDITIVE(비파괴)** 로 분류되는지 — 기존 total_amount 기준 환불이력(있다면)과의 정합/백필 필요 여부 판정.
2. C(시그니처에 `p_amount` 추가)의 계약 영향 등급 및 SECDEF allowlist(20260710223000 Tier-A) 재확인 필요 여부.
3. `paid_amount` 캐시(Σpackage_payments)를 환불산식 분모/분자로 신뢰 가능한지 — 승계 패키지(transferred_from, package_payments 0행이나 paid_amount 有, Packages.tsx:1569) 엣지 포함.
4. 반올림 정책(round/floor) 및 이미 부분소비된 패키지의 소비회차 가치 귀속(정가 vs 실납 단가) 확정.

> RPC 구현 착수는 (a) 본 CONSULT GO + (b) CRM-PREGATE GO + 총괄 정책(A/B/C) 회신 3자 모두 충족 후. db_changed=true → deploy-ready 시 MIG-GATE evidence 4필드 첨부.
