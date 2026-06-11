---
id: T-20260611-foot-DOC-REISSUE-CONTENT-MISSING
domain: foot
status: deploy-ready
priority: P0
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260611-foot-DOC-REISSUE-CONTENT-MISSING.spec.ts
qa_result: pass
deploy_commit: 6ed3b0b
created: 2026-06-11
deadline: 2026-06-11
---

# T-20260611-foot-DOC-REISSUE-CONTENT-MISSING — 서류 재발급 내용 전부 누락 (P0)

보고(김주연 총괄): "고객차트 > 진료내역 > 서류 재발급 시, 당일 멀쩡히 잘 나오던 서류도
이전처럼 내용 전부 누락되어 출력됨. 엄청 심각한 버그. 원인 명확히 찾아 수정."

## 근인 (AC-3, 1줄)

PATH-3 재발급(DocumentPrintPanel.handleBatchPrint / handleReceiptReissue)의 빌링 폴백이
비동기 `load()`가 채우는 React state(`footBillingItems`·`customerInsuranceGrade`)에 의존 →
재발급 모달 mount 직후 load() 완료 전 발행 시, service_charges 미기록(=당일 PATH-4(결제
미니창)로 정상 출력한 서류는 service_charges를 안 씀) 케이스에서 폴백 미발동 → 항목·금액 공란.
**service_charges는 print 시점 fresh 조회인데 check_in_services만 state 의존이던 '비대칭'이 핵심.**

## bisect 결과 (planner PUSH 우선순위)

- **①0cbbdc2 (DOCFORM-3FIX-BINDING-DISABLE) — 배제.** placeholder({{disease_display_note}}/
  {{visit_display_note}})는 어디서도 바인딩되지 않아 항상 공란이나, ⓐ bindHtmlTemplate가
  미바인딩을 `''`로 안전 치환(전체 누락 cascade 없음), ⓑ 영향 셀 2개 한정, ⓒ
  buildFootBillDetailItems 변경은 copayInfo optional 가산(항목 드롭 없음). → 전체 누락 불가.
- **②c7090ca (DOC-REISSUE-SYNC, bundle_hash=pending) — supervisor 운영번들 검증과 병행.**
  본 수정이 c7090ca 위에 올라가 함께 재배포되므로, 미배포였더라도 6ed3b0b 배포로 동시 해소.
- **③PATH-3 vs PATH-4 — 확정.** 차이 = 빌링 데이터 소스 시점(PATH-4 in-memory vs PATH-3 state).
  PATH-3가 state 비었을 때 fresh 조회로 결정적 폴백하도록 수정.

## 수정

- `handleBatchPrint` 폴백: `else if (footBillingItems.length>0)` → `else`에서 state 비면 print
  시점 `loadFootBillingItems`/`loadCustomerInsuranceGrade` fresh 조회(`fbStale` 게이트: 로드됐으면
  state 재사용 = 무파괴).
- `handleReceiptReissue`: 동일 `fbStale` 패턴.

## AC

- AC-1 재발급 = 최초출력 동일(누락 없음) — spec `PATH-3 == PATH-4 항목 HTML`.
- AC-2 서류 7종 전반 누락 없음 — 폴백 항목 행 렌더(빈 "진료 항목 없음" 아님).
- AC-3 근인 명시 + 소스 가드(state 단독 의존 금지).

## 검증

tsc OK · vite build OK · 신규 spec 5/5 · 인접 회귀 29/29 통과.
db_change 없음(기존 테이블 fresh 조회만). L-006 단일 렌더 경로 유지.
