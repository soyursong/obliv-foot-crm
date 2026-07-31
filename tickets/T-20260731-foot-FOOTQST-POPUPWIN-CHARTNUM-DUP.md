---
id: T-20260731-foot-FOOTQST-POPUPWIN-CHARTNUM-DUP
domain: foot
priority: P1
type: BUG
status: deploy-ready
deploy-ready: true
assignee: dev-foot
reporter: planner (origin C0ATE5P6JTH 정본, 재현 스샷 F0BM70SNWBE / 20260731_145252.png)
created: 2026-07-31
build: pass (npm run build ✓ built in 6.41s)
db_change: false
db_migration: none
db_gate: N/A — FE-only 표시 레이어 수정(별도창 진입점 chartNumber 값 계산 2곳). 신규 컬럼·테이블·enum·RLS 0. chart_number 조회/저장/발번 무변경 → §S2.4 데이터 정책 자문 게이트 비해당.
risk_verdict: GO
risk_reason: "FE-only, 표시 레이어만. 변경 격리 = src/pages/CustomerChartPage.tsx 별도창 진입점 2곳(L7915·L10099)의 chartNumber 인자 계산. RC=chart_number 는 DB 트리거 assign_foot_customer_chart_number() 가 'F-'||LPAD(next_no,4,'0')로 이미 'F-NNNN'(F- 접두 포함) 발번하는데, 별도창 진입점이 `F-${String(chart_number).padStart(6,'0')}`로 'F-'를 재부착 → 'F-F-NNNN'(별도창 'F - F') 이중접두. 메인 차트 화면은 chartNoDisplay(chart_number)로 저장값 그대로 렌더 → 별도창만 렌더 경로 분기가 원인. 수정=두 호출부 모두 메인 화면과 동일 포맷터 chartNoDisplay(customer.chart_number) 재사용으로 수렴, F- 재부착 로직 제거. chart_number 값·발번(트리거)·저장 무변경, read/DDL/supabase write 0. POPUPWIN(c0f93235) 창 열기 로직(healthQDocument.ts openHealthQDocumentWindow) 무접촉 → 오픈 동작 회귀 없음(sibling BROKEN 스펙 6 passed 재확인). 롤백=브랜치 미머지(origin/main 무접촉)."
scenario_count: 8 (AC-1 chartNoDisplay 저장값 F- 이중접두 무생성 / AC-1b 과거 버그식 F-F- 이중접두 대조 / AC-2 별도창 호출부 F- 재부착 금지·chartNoDisplay 재사용 소스가드 / AC-2b 메인 화면 동일 포맷터 파리티 / AC-1c 문서 템플릿 chartNumber 1회 렌더 / AC-3 chartNoDisplay 순수 표시함수 값 무변경 / AC-4 window.open noopener 미재유입 오픈경로 유지) — 8 passed + sibling BROKEN 6 passed
e2e_spec: tests/e2e/T-20260731-foot-FOOTQST-POPUPWIN-CHARTNUM-DUP.spec.ts
spec: tests/e2e/T-20260731-foot-FOOTQST-POPUPWIN-CHARTNUM-DUP.spec.ts
commit: aeeb737785bec33f65a341931dbdec9c6a7cd466 (branch ticket/T-20260731-foot-FOOTQST-POPUPWIN-CHARTNUM-DUP) — origin/main merge = supervisor QA 게이트 대기
origin_ticket: T-20260731-foot-FOOTQST-POPUPWIN-BROKEN (deployed 13:41 KST, commit c0f93235) — 배포 직후 회귀
---

# T-20260731-foot-FOOTQST-POPUPWIN-CHARTNUM-DUP — 별도창 차트번호 'F - F' 이중접두 중복

## 회귀 버그 (P1)
발건강 질문지 [별도창 보기]에서 차트번호가 'F - F' 형태로 중복 표시.
기대 = 'F-XXXXX' 1회. 원인 티켓 POPUPWIN-BROKEN 배포 직후 발생(창은 열리나 차트번호 표시 오류).

## 근본원인
`customers.chart_number` 는 DB 트리거 `assign_foot_customer_chart_number()` 가
`'F-' || LPAD(next_no,4,'0')` → 이미 `F-NNNN`(F- 접두 포함) 형태로 발번한다.

별도창 진입점(`src/pages/CustomerChartPage.tsx` L7915·L10099)이:
```
chartNumber: customer.chart_number != null ? `F-${String(customer.chart_number).padStart(6,'0')}` : null
```
로 `F-`를 한 번 더 재부착 → `F-F-NNNN`(별도창 화면상 'F - F') 이중접두.

메인 차트 화면은 `chartNoDisplay(customer.chart_number)`로 저장값을 그대로 렌더(접두 재부착 없음).
POPUPWIN(c0f93235)에서 별도창 렌더 경로가 메인 화면과 갈라진 것이 회귀 원인.

## 수정
별도창 진입점 2곳 모두 메인 차트 화면과 동일 포맷터 `chartNoDisplay(customer.chart_number)`
재사용으로 수렴. `F-` 재부착 로직 제거 → 저장값 그대로 1회 표기. 표시 레이어만 변경.

## AC 검증
1. ✅ 별도창 차트번호 'F-XXXXX' 1회만(이중접두 없음) — AC-1/AC-1b
2. ✅ 메인 차트 화면 표기(chartNoDisplay)와 동일 포맷 일치 — AC-2/AC-2b
3. ✅ chart_number 값·발번·저장 무변경, 표시 레이어만 — AC-3, db_change=false
4. ✅ POPUPWIN(c0f93235) 창 열기 동작 회귀 없이 유지 — AC-4 + sibling BROKEN 6 passed

## 게이트
- db_change=false, MIG-GATE 비대상, FE-only
- E2E: 8 passed (본 스펙) + 6 passed (sibling BROKEN 회귀 재확인)
