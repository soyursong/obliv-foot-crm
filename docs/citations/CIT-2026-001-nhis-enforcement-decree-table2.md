---
id: CIT-2026-001
source_org: 법제처(국가법령정보센터) / 보건복지부 / 건강보험심사평가원(HIRA)
document: "[verified 근거체인] 국민건강보험법 시행령 제22조제1항 → 보건복지부 고시(요양급여비용 청구방법·심사청구서·명세서 서식 및 작성요령) + 심평원 외래 본인부담기준 / [pending 재확인] 시행령 별표2 제19조 제1항 verbatim"
quote: "[별표2 제19조1항 verbatim = 미검증·재확인 대상] 결론(외래 본인부담금 100원 미만 절사)은 심평원 표 verbatim '100원미만 절사'(CIT-2026-002, verified) + 시행령 제22조1항→복지부 고시 근거체인으로 확정"
verbatim_status: pending_lawgokr
verbatim_reverify_at: null
url: https://www.law.go.kr/법령/국민건강보험법시행령
retrieved_at: 2026-07-14
related_tickets:
  - T-20260714-foot-COPAY-ROUND-REG-VERIFY
  - T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM
  - T-20260716-foot-CIT-BYPYO2-VERBATIM-RECONCILE
---

# CIT-2026-001 — 국민건강보험법 시행령: 외래 본인부담금 100원 미만 절사

> ⚠️ **검증 상태 주의 (2026-07-16 정합, T-20260716-foot-CIT-BYPYO2-VERBATIM-RECONCILE)**
> 이 파일 초판(2026-07-14)은 근거를 **"시행령 별표2 제19조 제1항 — '100원 미만은 제외한다'"** verbatim 으로 단정 기재했으나,
> 2026-07-15 dev-foot 규정 실조사(MSG-20260715-043047-n54m)에서 **별표2 verbatim 은 미검증**으로 정정됐다
> (별표2는 부담률(%) table 축으로, 100원 절사 근거 조문과 별개 축이며, 조사 시점 law.go.kr 서버 과부하로 원문 추출 실패).
> 따라서 **별표2 제19조1항 verbatim 은 pending(재확인 대상)** 으로 강등하고, 근거체인을
> **검증본(심평원 표 + 시행령 제22조1항 → 복지부 고시)** 으로 재지정한다.
> **결론(100원 미만 절사 = FLOOR to 100)과 CRM 계산 로직은 변경 없음** — verified(심평원 표) 근거로 이미 확정돼 있다.
> 정본 토픽 뷰: [`health_insurance.md`](./health_insurance.md) 블록 #1.

## 출처

### [verified] 근거체인 (직접 확인된 1차 근거)
- **심평원 외래 본인부담기준표** (HIRA) — 원문 표기 `100원미만 절사`. 정본 per-file: [`CIT-2026-002`](./CIT-2026-002-hira-outpatient-copay-standard.md).
- **국민건강보험법 시행령 제22조제1항 → 보건복지부 고시**(요양급여비용 청구방법·심사청구서·명세서 서식 및 작성요령): 외래 본인일부부담금 중 **100원 미만 끝수 계산 제외(절사)**, 절사액은 공단 부담. 연혁: 2008.8 의원급 → 2009.7 종합·병원 등 확대.

### ⚠️ [pending 재확인] 시행령 별표2 제19조 제1항 verbatim
- 기관: 법제처 (국가법령정보센터)
- URL: https://www.law.go.kr/법령/국민건강보험법시행령
- 확인 일자(초판 기재): 2026-07-14 / 정정: 2026-07-15
- 상태: `verbatim_status: pending_lawgokr` — 아래 §"별표2 verbatim 재확인 절차" 참조.

## 원문 인용

### [verified] 심평원 외래 본인부담기준표 (원문 그대로)

> 100원미만 절사

(전 외래 종별 일관. 직접 확인된 1차 근거 → 정본 `CIT-2026-002`.)

### ⚠️ [pending 재확인] 시행령 별표2 제19조 제1항 (미검증 — 확정 전사 금지)

> (미검출) — law.go.kr 서버 과부하로 원문 텍스트 추출 실패(2026-07-15 정직 보고).

- 종전 초판의 "별표2 제19조1항 '100원 미만은 제외한다'" 단정 인용은 **미검증 → 확정 전사 금지**.
- 별표2는 **부담률(%) table** 로, 100원 절사 근거 조문과 **별개 축**일 가능성이 높다.
- law.go.kr 정상화 후 시행령 제22조1항·별표2 원문을 재확인하여 verbatim 확정 후 이 블록에 전사할 것.

## 해석·적용 (결론·로직 변경 없음)

- 외래 본인부담금 끝자리 처리 결론: **100원 미만 절사** (FLOOR to 100). — verified(심평원 표) 근거로 확정, 본 정합에서 **불변**.
- CRM 계산 로직 `calc_copayment` RPC / `copayCalc.ts` 미러의 단수처리 근거. **코드 영향 없음(docs-only provenance 정합).**
- `T-20260714-foot-COPAY-ROUND-REG-VERIFY` 검증 GATE에서 규정-기반 100원 절사로 확정(2026-07-14 closed). 이전 관행-기반 결론(베가스 영수증 관찰 → 10원 절사)을 폐기.
- 베가스 관찰의 10원 단위는 비급여·자보 등 급여 외 수납 혼입으로 추정됨(급여 외래 규정과 별개 축).

## 별표2 verbatim 재확인 절차 (self-tracking marker)

- `verbatim_status: pending_lawgokr` 인 동안: 별표2 제19조1항 verbatim 은 **미검증**으로 취급한다.
- law.go.kr 정상화 후:
  1. 시행령 별표2 제19조1항 원문 텍스트를 추출·전사.
  2. 위 "⚠️ [pending 재확인]" 인용 블록에 verbatim 반영.
  3. frontmatter `verbatim_status: verified`, `verbatim_reverify_at: <YYYY-MM-DD>` 갱신.
- 이 재확인은 외부 사이트(law.go.kr) 정상화에 종속되므로 **정합 티켓(CIT-BYPYO2-VERBATIM-RECONCILE)의 done 조건이 아니다** — 본 marker 로 별도 추적한다.

## 관련 티켓
- T-20260714-foot-COPAY-ROUND-REG-VERIFY (규정 검증 GATE, closed)
- T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM (단수처리 impl 재정의: FLOOR(x/100)*100)
- T-20260716-foot-CIT-BYPYO2-VERBATIM-RECONCILE (본 정합: 별표2 verbatim 강등 + 근거체인 재지정 + pending_lawgokr marker)
