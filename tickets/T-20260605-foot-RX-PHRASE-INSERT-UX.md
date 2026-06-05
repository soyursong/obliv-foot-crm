---
id: T-20260605-foot-RX-PHRASE-INSERT-UX
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260605-foot-RX-PHRASE-INSERT-UX.spec.ts
e2e_spec_exempt_reason: null
qa_result: pass
deploy_commit: a16193f
created: 2026-06-05
commit: 1e4959b
ac6_status: reverted
ac6_revert_reason: "현장 정정 2026-06-05 20:28 (MSG-20260605-203408-o0dw) — '// < 공간 확장'은 planner 오독. 본의=상용구 로딩 버그(별건 T-...-SUPER-PHRASE-LOAD-FIX). AC-6 패널확장(w-80/max-h-72) → w-64/max-h-56 원복, 시나리오4·4b spec 삭제."
correction_log: "2026-06-05 20:34 — AC-6 + 시나리오4 삭제. 본 티켓 AC-1~5 한정 유지. P2 불변."
---

# T-20260605-foot-RX-PHRASE-INSERT-UX — 펜차트 상용구 인라인 ✓ 즉시삽입 전환

## 요청
문지은 대표원장. 펜차트(PenChartTab) 상용구 패널 인터랙션 변경:
체크박스 복수선택 + 하단 "삽입" 버튼 → 행 클릭 시 그 행 좌측에 인라인 ✓ 버튼 노출 → ✓ 클릭 즉시삽입.

## 충돌 분석 (진행 가능)
- 대상 = **PenChartTab.tsx (캔버스 펜차트)**. 직전 동선 = T-20260603-foot-PHRASE-MULTISELECT(체크박스 누적 복수선택 → 하단 삽입 결합 1개 배치, 604e4fc deployed).
- T-20260605-foot-RX-PHRASE-CLICK-INSERT(9f57699)는 **MedicalChartPanel.tsx(텍스트 진료차트)** 의 동형 인라인 ✓ 동선 — 별도 컴포넌트·별도 state. 무영향.
- 삽입 본질 차이: 펜차트는 입력필드 concat 아님 → pendingBoilerplate → boilerplate-placing 진입 → 캔버스 1클릭 = PlacedItem 1개 배치.

## 구현 (PenChartTab.tsx)
- AC-1: row 체크박스(순번 배지) + 하단 일괄 삽입 푸터(`phrase-select-footer`/`phrase-insert-btn`/`phrase-clear-btn`/`phrase-select-count`) 제거.
- AC-2: `revealedPhraseId: number | null` 단일 활성 state. 행 클릭(`revealPhraseInsert`) → 그 행에만 좌측 인라인 ✓(`phrase-insert-{id}`) 노출(한 번에 한 행). 같은 행 재클릭 = 닫힘(null). 다른 행 클릭 = 교체. 카테고리 전환/패널 토글·닫기/차트 초기화 시 `setRevealedPhraseId(null)`.
- AC-3: ✓ 클릭(`insertPhraseImmediate`) → `handleBoilerplateSelect(단일 content)` → boilerplate-placing 진입 + 패널 닫힘 → 캔버스 클릭 시 `placeBoilerplate`로 1개 PlacedItem 배치. content 없으면 무동작(방어).
- AC-4 (GUARD): `placeBoilerplate`/카테고리 필터/이동·삭제(select tool)/빈 상태(`phrase-empty-state`) 불변. phrase_templates read-only(쓰기 0).
- AC-5: ✓ 버튼 `aria-label="{name} 삽입"` + `title="삽입"` + Check 아이콘 `aria-hidden`. 행은 `role="button"` `tabIndex={0}` + Enter/Space 키보드 토글 + focus ring.
- ~~AC-6 (현장 추가요청): 상용구 패널 영역 확장~~ — **취소·원복(현장 정정 2026-06-05 20:28, MSG-20260605-203408-o0dw)**. "`// <` 공간 확장" 발언은 planner 오독이었고, 본의는 *"상용구가 안 불러와져 로딩이 안 됨"*(로딩 버그). 패널 폭 `w-80`→`w-64`, 목록 높이 `max-h-72`→`max-h-56` 원복. 로딩 버그는 별건 `T-20260605-foot-SUPER-PHRASE-LOAD-FIX`로 분리 처리. 본 티켓은 AC-1~5 한정.
- Q1 (planner 비차단): 단건 즉시삽입 dev 기본안 착수. 복수결합 헬퍼/상수(`PHRASE_JOIN_SEPARATOR`·`combineBoilerplate`·`selectedPhraseIds`·`togglePhraseSelect`·`confirmPhraseSelection`·`clearPhraseSelection`)는 제거하지 않고 `[DEACTIVATED]` 주석으로 비활성 보존 → 현장 복수재요청 시 주석 해제로 복원. 현장 confirm은 responder 병행.

## 검증
- `npm run build` (tsc -b + vite) ✅ 통과 (noUnusedLocals strict) — AC-6 원복 후 재통과
- 신규 E2E `tests/e2e/T-20260605-foot-RX-PHRASE-INSERT-UX.spec.ts` — **17/17 passed** (AC-1~5 + 현장 시나리오 3종: 인라인 ✓ 즉시삽입 / 행 전환 / GUARD 회귀). 시나리오4·4b(패널 확장)는 AC-6 취소로 삭제.
- 관련 phrase 회귀(MULTISELECT·PEN-PASSTHROUGH·MOVE-RESTORE) 41 passed
- DB 변경 없음

## 참고 (supervisor)
- `tests/e2e/T-20260522-foot-PENCHART-PHRASE.spec.ts`의 AC-1/AC-2/AC-2b/AC-5는 **본 작업 이전부터 stale + flaky**. HEAD(미적용) 동일 조합 실행에서도 동일 실패 재현 확인. 원인: 버튼 라벨 `불러오기`(현 코드 `상용구`)·활성 클래스 `bg-emerald-600`(현 teal 테마) 등 V3 리네임/테마 드리프트 + 고객 데이터 의존 cross-spec 오염. 본 티켓 범위 밖(별도 스펙 갱신 티켓 권장).
