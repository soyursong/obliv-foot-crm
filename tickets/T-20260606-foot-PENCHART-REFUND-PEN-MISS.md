---
ticket_id: T-20260606-foot-PENCHART-REFUND-PEN-MISS
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
deploy_ready_at: 2026-06-06
deploy_ready_by: agent-fdd-dev-foot
commit: 705be3b
bundle: PenChartTab-s2zNPaw9.js
db_change: false
e2e_spec: tests/e2e/T-20260606-foot-PENCHART-REFUND-PEN-MISS.spec.ts
field_soak_required: true
field_soak_owner: 김주연 총괄 (U0ATDB587PV / C0ATE5P6JTH, Galaxy Tab)
---

# T-20260606-foot-PENCHART-REFUND-PEN-MISS

환불/비급여 동의서(3p 대형 캔버스) **펜 잘 안먹음** — 스크롤 직후 첫 획 오프셋/미등록 수정.

## 루트코즈 (코드증거 인과체인 — 검증 완료)

- `strokeRectRef.current`(캔버스 viewport rect)는 `onPointerDown`(획 시작) **1회만** `getBoundingClientRect` 캐싱.
- 환불/비급여 동의서(`refund_consent`, 794×3369 논리 → DRAW_DPR=2 = **1588×6738** 물리)는
  `overflow-auto` 스크롤 컨테이너 + `touchAction:'pan-y'`(unlocked) 환경.
- 펜 획 중/직후 컨테이너가 세로 스크롤되면 캔버스 viewport `rect.top` 이 이동하지만
  캐시는 스크롤 전 값 → `handleNativePointerMove`의 `toLogical (clientY - staleRect.top)` 가
  누적 오차 → **스크롤 직후 첫 획 오프셋 / 미등록**(현장 "펜 안먹음").
- ※ latency 축("끊김·거침·느림", PEN-MISS superseded → T-20260606-REFUND-LATENCY ed87e8d 단일 path 배칭)과 **별개 축**.
- 가설②(interactive wrapper passthrough)·③(touchAction 토글)·④(DRAW_DPR2 캔버스 한계)는 1순위 stale-rect로 충분히 설명되어 비채택.

## 수정 (hot-path 비용 0 / 스크롤 회귀 0)

- `strokeRectDirtyRef` 추가. `window` 에 `scroll` 리스너(`capture:true, passive:true`) 등록 —
  **드로잉 중(`drawingRef`)일 때만** dirty 플래그 세팅(레이아웃 read 없음 → scroll jank 0).
- `handleNativePointerMove`: dirty면 `getBoundingClientRect` + scale **1회만** 재측정 후 dirty 해제
  → getBoundingClientRect 비용은 "스크롤 후 첫 이동"에서만 발생(매 move 아님).
- `onPointerDown`: fresh rect 캐싱 직후 dirty 해제(직전 스크롤 잔여 플래그 제거).

## AC

- AC-1: 전 3페이지 + 스크롤 직후 첫 획 정확 등록 (구조 검증 green; 실기기 정밀도는 field-soak).
- AC-2: 루트코즈 규명 후 수정 — 오프셋(stale-rect) 원인 규명·기록 / 완전미등록은 동일 stale-rect의 극단(획 전체가 폼 밖 좌표로 매핑)으로 포함.
- AC-3: PEN-SLOW Fix-2/3/8 성능 + REFUND-AUTOFILL 좌표 비파괴, pan-y 스크롤 비파괴(passive).

## 검증

- build PASS (3.54s) / E2E PEN-MISS **11 passed** + 회귀(LATENCY/AUTOFILL/FORM-BLACK/PEN-OFFSET) **111 passed**.
- (PEN-SLOW 1건 RED = `cancelAnimationFrame` headless eval 미정의 — 베이스라인 동일·본변경 무관)
- commit **705be3b** · DB 무변경 · FE-only.

## 클로즈 조건

- supervisor QA GO → 배포 → **field-soak**(김주연 총괄 Galaxy Tab 실펜 필기) 캡처로 AC-1 실기기 체감 클로즈.
