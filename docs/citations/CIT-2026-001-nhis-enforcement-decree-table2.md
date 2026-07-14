---
id: CIT-2026-001
source_org: 법제처 (국가법령정보센터)
document: 국민건강보험법 시행령 별표2 제19조 제1항 (요양급여비용 본인부담액 산정)
quote: "100원 미만은 제외한다"
url: https://www.law.go.kr/법령/국민건강보험법시행령
retrieved_at: 2026-07-14
related_tickets:
  - T-20260714-foot-COPAY-ROUND-REG-VERIFY
  - T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM
---

# CIT-2026-001 — 국민건강보험법 시행령 별표2: 외래 본인부담금 100원 미만 절사

## 출처
- 기관: 법제처 (국가법령정보센터)
- 문서·조항: 국민건강보험법 시행령 별표2 제19조 제1항
- URL: https://www.law.go.kr/법령/국민건강보험법시행령
- 확인 일자: 2026-07-14

## 원문 인용 (원문 그대로)

> 100원 미만은 제외한다

(외래 요양급여비용 본인부담액 산정 시 끝자리 처리 규정. 확인 경로: 국가법령정보센터 국민건강보험법 시행령 별표2 제19조 제1항.)

## 해석·적용

- 외래 본인부담금 끝자리 처리 결론: **100원 미만 절사** (FLOOR to 100).
- CRM 계산 로직 `calc_copayment` RPC / `copayCalc.ts` 미러의 단수처리 근거.
- `T-20260714-foot-COPAY-ROUND-REG-VERIFY` 검증 GATE에서 규정 원문으로 확정 (2026-07-14 closed).
  이전 관행-기반 결론(베가스 영수증 관찰 → 10원 절사)을 폐기하고 규정-기반 100원 절사로 재정의.
- 베가스 관찰의 10원 단위는 비급여·자보 등 급여 외 수납 혼입으로 추정됨(급여 외래 규정과 별개 축).

## 관련 티켓
- T-20260714-foot-COPAY-ROUND-REG-VERIFY (규정 검증 GATE, closed)
- T-20260714-foot-HIRA-ELDERLY-ROUNDING-CONFIRM (단수처리 impl 재정의: FLOOR(x/100)*100)
