---
id: T-20260605-foot-RX-PHRASE-CLICK-INSERT
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260605-foot-RX-PHRASE-CLICK-INSERT.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-05
commit: 9f57699
---

# T-20260605-foot-RX-PHRASE-CLICK-INSERT — 진료차트 상용구 불러오기 클릭+✓ 즉시삽입 전환

## 요청
진료차트(MedicalChartPanel) 우측 '상용구' 탭 불러오기 인터랙션 변경:
체크박스 다중선택 + 하단 "삽입" 버튼 → 행 클릭 시 ✓ 버튼 노출 → ✓ 클릭 즉시 삽입.

## 충돌 분석 (티켓 블로커 체크 결과 — 진행 가능)
- T-20260603-foot-PHRASE-MULTISELECT(복수선택 일괄배치)는 **PenChartTab.tsx(펜차트)** 에 구현.
  대상 **MedicalChartPanel.tsx(진료차트)** 와 별도 컴포넌트·별도 state(`selectedPhraseIds:number[]` vs 진료차트의 자체 Set)·별도 패널.
- 공유 체크박스/패널 없음 → 티켓 decision tree "단순 단일 불러오기 패널만 영향 → 그대로 진행" 충족.
- 펜차트 MULTISELECT 회귀 spec(37 passed) 무영향 검증 완료. FOLLOWUP/DECISION-REQUEST 불필요.

## 구현 (MedicalChartPanel.tsx)
- AC-1: row 체크박스 + 하단 일괄 "삽입" 버튼(`phrase-insert-btn`) 제거.
  `selectedPhraseIds:Set` / `togglePhraseId` / `insertSelectedPhrases` 데드코드 제거.
- AC-2: `clickedPhraseId:number|null` 단일 활성 state. row 클릭(`togglePhraseRow`) → 그 row만 ✓ 버튼(`phrase-insert-check`) 노출. 같은 row 재클릭 = 닫힘.
- AC-3: ✓ 클릭 → `confirmInsertPhrase(p)` → 기존 `insertPhrase(p)` 재활용 → 누적(append)/대체(//query) 시맨틱 동일. 빈/공백 content GUARD 유지.
- AC-4: 슈퍼상용구(super_phrases) 별도 탭/핸들러 — 무영향. 고객 전환 시 `setClickedPhraseId(null)` 리셋.

## 검증
- build: OK (tsc -b && vite build, 3.5s)
- E2E: tests/e2e/T-20260605-foot-RX-PHRASE-CLICK-INSERT.spec.ts 9/9 pass (시나리오 클릭→✓→삽입 / 회귀)
- 회귀: MEDCHART-SUPERPHRASE-EXT · PHRASE-SLASH · PHRASE-MULTISELECT 37 passed
- DB 변경: 없음 (FE 전용)
- commit: 9f57699 (main → Vercel 자동배포)
