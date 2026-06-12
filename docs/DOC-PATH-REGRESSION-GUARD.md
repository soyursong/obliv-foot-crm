# 풋센터 서류(문서) 출력 경로 — 회귀방지 가드 체크리스트

> **출처:** T-20260611-foot-DOC-FEATURE-AUDIT-HARDENING (P1, 우산 회귀방지 하드닝)
> **디렉티브:** 김주연 총괄 — "서류 진짜 중요한 항목이라고 여러번 말했는데, 한번 검토하고 개선할 때 확실하게 잡아."
> **Lock:** L-006 (DOC-PRINT-UNIFY) — DocumentPrintPanel/`bindHtmlTemplate` 단일 렌더 경로
> **자동 가드:** `tests/e2e/T-20260611-foot-DOC-FEATURE-AUDIT-HARDENING.spec.ts` (unit 프로젝트)
>
> 서류 계열을 다시 손질하는 dev/supervisor는 **착수 전 본 문서를 1독**하고, 배포 전 하단 체크리스트를 통과시킨다.

---

## AC-2 — 서류 출력/발행 진입 경로 인벤토리 (1차)

| # | 경로 | 진입 위치 | 정상 출력 = 채워져야 하는 것(현장 기준) | 렌더 경로 |
|---|------|-----------|------------------------------------------|-----------|
| PATH-3 | **차트>진료내역 재발급** | `DocumentPrintPanel.handleBatchPrint` / `handleReceiptReissue` | 상병·향후치료의견·본인/공단 부담금·진료 항목/금액(공란 0건) | `openBatchPrintWindow` → `bindHtmlTemplate` |
| PATH-4 | **결제 미니창 발행** | `PaymentMiniWindow` | 핵심 항목·금액·환자 인적사항(정상 레퍼런스) | iframe print → `bindHtmlTemplate` |
| REFERRAL | **진료의뢰서 인쇄** | `DocumentPrintPanel` (`referral_letter`) | 환자(성명/연령/성별)·진단·의뢰내용·의뢰처, 중앙정렬·클립 정상 | `bindHtmlTemplate` |
| CONSENT | **동의서** | `ConsentFormDialog` / self-checkin | 성명 중앙정렬·서명·타임스탬프 | (canvas/penchart 계열 — L-006 양식 맵 비대상) |
| DOCPANEL-ALLROLE | **per-role 인쇄** | `DocumentPrintPanel` (역할별 노출) | 역할별 노출 항목 누락 없이 인쇄 | `bindHtmlTemplate` (stale 번들 재검증 대기) |

> **L-006 양식 맵(`HTML_TEMPLATE_MAP`) 등록 11종:** diagnosis, treat_confirm, visit_confirm, diag_opinion, bill_detail, payment_cert, referral_letter, medical_record_request, diag_opinion_v2, rx_standard, bill_receipt, ins_claim_form.
> **이메일 연동(REFERRAL-EMAIL-INTEGRATION / EMAIL-INTEGRATION-CLARIFY):** human_pending(현장 의미 확인 대기) — 인벤토리 항목으로만 적고 구현은 해당 티켓에서.

---

## AC-4 — L-006 단일 렌더 경로 점검 결과

- **양식 바인딩 단일 함수:** `src/lib/htmlFormTemplates.ts::bindHtmlTemplate` (LOGIC-LOCK L-006). 모든 의료서류 양식의 `{{placeholder}}` 치환은 이 함수 1곳만 통과. ✅
- **우회 바인딩 부재:** DocumentPrintPanel·PaymentMiniWindow 내 raw `{{...}}` 복제 치환 0건. ✅ (스펙 AC-4 가드)
- **우회 `window.print()` 점검 (OPEN-Q — 이번 스코프에서 제거 X, 회귀 위험):**
  - `src/pages/Closing.tsx` — 일마감 보고서 인쇄. **비양식**(의료서류 아님) → L-006 비대상. 유지.
  - `src/pages/CustomerChartPage.tsx` — 차트/사진 인쇄. **비양식** → L-006 비대상. 유지.
  - `src/components/PhotoUpload.tsx` — 사진 인쇄. **비양식** → L-006 비대상. 유지.
  - → **판정:** 위 3곳은 의료서류 양식 경로가 아님(보고서/차트/사진). L-006 단일경로 위반 아님. 단, 향후 이 경로들에 **양식(서류)** 출력을 얹는다면 반드시 `bindHtmlTemplate` 경유로 흡수할 것.

---

## AC-5 — 회귀 원인 패턴 (왜 한 픽스가 다른 경로를 깼는가)

06-08~06-11 서류 ping-pong(4차)의 공통 메커니즘은 **"공유 출력 컴포넌트(DocumentPrintPanel)의 한쪽 경로만 보고 손질해, 비대칭/공유 상태를 통해 다른 경로를 깬다"** 이다.

- **06-08 `c7090ca` (REISSUE-SYNC):** PATH-3 재발급을 PATH-4(정답 레퍼런스)에 수렴시키려 했으나, bundle_hash=pending-vercel(운영 반영 미검증)로 "픽스가 실제 prod에 없을" 가능성을 남김.
- **06-09 `0cbbdc2` (DOCFORM-3FIX):** DocumentPrintPanel의 **조건부 렌더를 disable**. 이 컴포넌트가 PATH-3·PATH-4 **공유**라, 한 경로 기준의 조건 제거가 다른 경로의 바인딩을 빈 값/false로 떨어뜨릴 위험.
- **06-11 P0 (REISSUE-CONTENT-MISSING):** 진짜 근인 = **비대칭 데이터 소스**. service_charges는 print 시점 fresh 조회였는데 check_in_services(`footBillingItems`)·`customerInsuranceGrade`는 **비동기 load()가 채우는 React state 단독 의존** → 모달 mount 직후 load() 완료 전 발행 시 폴백 미발동 → "당일 정상(PATH-4, in-memory) → 재발급(PATH-3) 내용 전체 누락". 수정 = `billingReady` 게이트(4소스 로드 전 출력 차단) + `fbStale` 게이트(state 비면 print 시점 fresh 조회)로 **race 자체를 제거**.

### 다음 서류 손질 시 체크리스트 (배포 전 필수)

1. [ ] **양쪽 경로 동시 확인** — PATH-3(재발급)과 PATH-4(결제발행) 둘 다 회귀 없는지. 한쪽만 보지 말 것.
2. [ ] **공유 컴포넌트 영향 추적** — DocumentPrintPanel 조건부 렌더/props를 바꿀 때, 그 조건이 어느 경로에서 false로 떨어지는지 전 경로 점검.
3. [ ] **async state 의존 금지** — 출력에 쓰는 데이터 소스가 비동기 load() state 단독 의존이면 안 됨. (a) 로드 게이트(`billingReady`)로 출력 차단 또는 (b) print 시점 fresh 조회(`fbStale`) 폴백.
4. [ ] **L-006 단일경로 유지** — 우회 `print()`/복제 `{{}}` 바인딩 신규 0건. 양식은 무조건 `bindHtmlTemplate` 경유.
5. [ ] **회귀 스펙 green** — `npx playwright test tests/e2e/T-20260611-foot-DOC-FEATURE-AUDIT-HARDENING.spec.ts --project=unit` PASS.
6. [ ] **운영 번들 반영 검증** — 배포 후 `/version.json` buildId + index asset 해시로 prod 반영 확인(pending-vercel 재발 방지).

---

*last updated: 2026-06-12 · owner: dev-foot · 본 문서는 회귀방지 가드의 정본 체크리스트. 서류 티켓마다 갱신.*
