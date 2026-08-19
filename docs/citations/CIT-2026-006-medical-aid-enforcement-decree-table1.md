---
id: CIT-2026-006
source_org: 법제처(국가법령정보센터) / 보건복지부
document: "의료급여법 시행령 [별표1] — 의료급여 1·2종 본인부담(의원급 외래 정액 1,000원)"
quote: "[verbatim = 미검출·재확인 대상] 결론(의급 1·2종 의원급 외래 본인부담 = 정액 1,000원 = LEAST(1000, 수가))은 revenue_insurance_split_spec §2-2 + DA 재확정 da_ratify_copayment_grade_rates_20260720 근거체인으로 확정. 원문 verbatim 은 아래 §재확인 절차 참조."
verbatim_status: pending_lawgokr
verbatim_reverify_at: null
source_sha256: bc01a65a
url: https://www.law.go.kr/법령/의료급여법시행령
retrieved_at: 2026-08-19
related_tickets:
  - T-20260720-foot-COPAY-GRADE-BRANCH-MISSING
  - T-20260819-foot-COPAY-VISIT-GRAIN
---

# CIT-2026-006 — 의료급여법 시행령 [별표1]: 의급 1·2종 의원급 외래 본인부담 정액

> ⚠️ **검증 상태 주의 (정직 보고, repo citation 규약 §"원문 미검출 = 미검출로 정직 기록")**
> 본 CIT는 `T-20260819-foot-COPAY-VISIT-GRAIN` 동반 조치로 신규 등재됐다. 등재 시점 원문(law.go.kr
> 의료급여법 시행령 [별표1]) 텍스트 **직접 전사(verbatim)는 미수행** — 확인 시점 원문 텍스트 추출 미완.
> 따라서 `verbatim_status: pending_lawgokr` 로 강등해 추적한다. **결론(정액 1,000원)과 CRM 계산 로직은
> 변경 없음** — 이미 [`health_insurance.md`](./health_insurance.md) 블록 #5 + DA 재확정으로 확정돼 있다.

## 출처

- 기관: 법제처(국가법령정보센터) / 보건복지부
- 문서·조항: **의료급여법 시행령 [별표1]** (의료급여 본인부담 기준)
- URL: https://www.law.go.kr/법령/의료급여법시행령
- 원문 파일 해시(티켓 제공): `sha256:bc01a65a` — 원문 재확인 시 대조 앵커.
- 확인 일자: 2026-08-19

## 결론 (근거체인으로 확정 · 로직 변경 없음)

- **의료급여 1종·2종 = 의원급(1차) 외래 본인부담 정액 1,000원** = `LEAST(1000, 수가(base))`.
- 차상위 만성·18세미만(`low_income_2`)도 동일 정액 1,000원(시행령 별표2 제3호 라목, `CIT` 계열 근거체인).
- ⚠ **grain = 방문당(visit)**: 정액 1,000원은 **1회 방문(외래 1일) 단위** 상한이다. 한 방문에서 급여 항목이
  N개여도 본인부담 합계는 `LEAST(1000, 방문 급여 총액)` — **항목별 1,000원 중복 부과 금지**. 이 grain 이
  `T-20260819-foot-COPAY-VISIT-GRAIN` 결함(항목당 계산 → 방문당 교정)의 규정 근거다.

## ⚠️ [pending 재확인] 원문 verbatim

> (미검출) — 등재 시점 의료급여법 시행령 [별표1] 원문 텍스트 직접 전사 미수행(정직 보고).

- law.go.kr 정상 접근 후 [별표1] 원문(1·2종 의원급 외래 본인부담 항목)을 추출·전사하고, 제공 해시
  `sha256:bc01a65a` 와 대조해 verbatim 확정할 것.

## 재확인 절차 (self-tracking marker)

- `verbatim_status: pending_lawgokr` 인 동안: [별표1] verbatim 은 **미검증**으로 취급한다.
- 재확인 시:
  1. 의료급여법 시행령 [별표1] 원문 텍스트를 추출·전사.
  2. 위 "⚠️ [pending 재확인]" 블록에 verbatim 반영 + `sha256:bc01a65a` 대조.
  3. frontmatter `verbatim_status: verified`, `verbatim_reverify_at: <YYYY-MM-DD>` 갱신.
- 외부 사이트 종속 → 티켓 done 조건이 아니다(본 marker 로 별도 추적).

## 관련 티켓
- T-20260720-foot-COPAY-GRADE-BRANCH-MISSING (의급/차상위 정률→정액 재확정, 블록 #5)
- T-20260819-foot-COPAY-VISIT-GRAIN (본인부담 방문 grain 교정 — 본 CIT 신규 등재의 계기)
