---
id: T-20260522-foot-DOC-PRINT-LOCK-L006
domain: foot
status: deploy-ready
priority: P0
deploy-ready: true
build-ok: true
db-change: false
regression-risk: none
e2e_spec_exempt_reason: "주석+문서만, UI/로직 변경 없음"
created: 2026-05-22
---

# T-20260522-foot-DOC-PRINT-LOCK-L006 — 서류출력 경로 통일 코드 보호 락 (L-006)

## 배경

김주연 총괄 직접 지시:
> "락 걸어달라고 요청하는게 언제나 최우선 순위고 그 어떤 요청보다 제일 중요해."

T-20260521-foot-DOC-PRINT-UNIFY (commit 9b0c36b) 배포 + 현장 확인 완료 후,
서류 4개 출력 경로 통일 구조를 코드 변경으로부터 보호하는 LOGIC-LOCK L-006 등록.

## 작업 내용

### 1. LOGIC-LOCK-REGISTRY.md — L-006 항목 추가

- 상태: ACTIVE · 잠금일: 2026-05-22
- 원칙: DocumentPrintPanel 기준 단일 렌더링 경로 (PATH-1/2/3: DocumentPrintPanel, PATH-4: PaymentMiniWindow printViaIframe)
- 변경 시 E2E regression 56종 통과 필수

### 2. 대상 파일 `// LOGIC-LOCK: L-006` 주석 삽입

| 파일 | 삽입 위치 |
|------|----------|
| `src/components/DocumentPrintPanel.tsx` | 파일 상단 |
| `src/lib/htmlFormTemplates.ts` | 파일 상단 + `bindHtmlTemplate()` 직전 |
| `src/lib/formTemplates.ts` | 파일 상단 + `AUTO_BIND_KEYS` 직전 + `FALLBACK_TEMPLATES` 직전 |
| `src/components/PaymentMiniWindow.tsx` | 파일 상단 + `buildHtmlPageDiv()` 직전 + `buildPageHtml()` 직전 |

## 참조

- 기배포: T-20260521-foot-DOC-PRINT-UNIFY (commit 9b0c36b, 현장 확인 완료)
- L-001~L-004: T-20260519-foot-LOGIC-LOCK-REGISTRY
- DB 변경: 없음
- 빌드: ✅ 3.41s

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `LOGIC-LOCK-REGISTRY.md` | L-006 섹션 추가 |
| `src/components/DocumentPrintPanel.tsx` | 파일 상단 LOGIC-LOCK 주석 |
| `src/lib/htmlFormTemplates.ts` | 파일 상단 + bindHtmlTemplate LOGIC-LOCK 주석 |
| `src/lib/formTemplates.ts` | 파일 상단 + AUTO_BIND_KEYS + FALLBACK_TEMPLATES LOGIC-LOCK 주석 |
| `src/components/PaymentMiniWindow.tsx` | 파일 상단 + buildHtmlPageDiv + buildPageHtml LOGIC-LOCK 주석 |
| `tickets/T-20260522-foot-DOC-PRINT-LOCK-L006.md` | 신규 티켓 |
