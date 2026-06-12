---
id: T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: true
created: 2026-06-11 13:27
completed: 2026-06-11
db_changed: false
db_migration: none
db_gate: N/A
scenario_count: 2
commit: 4fadfdc
spec: tests/e2e/T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW.spec.ts
build: pass
e2e_executed: true
e2e_result: 6 passed (0 skipped) — desktop-chrome, 26.2s
e2e_evidence: evidence/T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW_H1_desktop.png, evidence/T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW_H2_mobile.png
qa_fix: phase2 insufficient_verification 대응 — seed-free HARNESS 2종 추가(항상 실행) + 실측 스크린샷 첨부
---

# T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW

풋센터 CRM 2번차트(CustomerChartSheet) 미저장 가드 confirm 팝업 레이아웃 회귀 수정.

## 문제

배포 직후(T-20260609-foot-CHART2-SAVE-CLOSE-BTN, a821d0f로 1→3버튼 확장
[저장 후 닫기 / 저장하지 않고 닫기 / 취소]) "취소" 버튼이 다이얼로그 경계(border/box) 밖으로 overflow.

## 원인

`DialogContent`가 `max-w-sm`(384px)인데 `DialogFooter`가 `sm:flex-row`로 3개 한국어 버튼을
가로 배치 → 필요 폭(≈459px)이 384px 초과. `sm:justify-end` 라 맨 왼쪽 "취소" 버튼이
박스 왼쪽 경계 밖으로 밀려나 overflow.

## 수정 (CSS only — 핸들러/로직 무변경)

- `DialogContent`: `max-w-sm` → `max-w-lg` (512px, 3버튼 가로 수용)
- `DialogFooter`: `sm:flex-wrap` 추가 (안전망. 좁은 폭은 기존 `flex-col-reverse` 세로 스택 유지)
- 파일: `src/components/CustomerChartSheet.tsx`

## AC

1. 모든 버튼(저장 후 닫기/저장하지 않고 닫기/취소) 팝업 경계 안에 온전히 위치 — overflow 없음 ✅
2. 팝업 width 3버튼 수용하도록 조정. 버튼 클릭 액션 핸들러 무변경(레이아웃 CSS만) ✅
3. 모바일/좁은 폭 해상도에서도 overflow 없음 (col-reverse 세로 스택 + flex-wrap) ✅

## 범위 가드

CustomerChartSheet 미저장 가드 confirm 다이얼로그 한정. 저장/미저장닫기/취소 핸들러·로직 무변경.
DB 변경 없음.

## 현장 클릭 시나리오 (2종)

- **S1 (데스크톱/태블릿 폭)**: 차트 작성 중 닫기(ESC) → confirm 노출 → 3버튼이 팝업 경계
  안에 가로로 온전히 표시. "취소"가 박스 밖으로 나가지 않음.
- **S2 (모바일/좁은 폭)**: 동일 confirm 노출 → 3버튼이 세로 스택(또는 wrap)으로 경계 안에 표시.
  어떤 버튼도 overflow 없음. 라벨·동작은 기존 그대로(회귀 없음).

## 검증

- 빌드: `npm run build` ✅ built in 3.67s
- E2E 실행: `npx playwright test tests/e2e/T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW.spec.ts --project=desktop-chrome`
  → **6 passed (0 skipped), 26.2s** (2026-06-12 09:27, macstudio)
  - HARNESS H1 (1280px) ✅ / HARNESS H2 (390px) ✅ — 시드 무관, 실 CSS 주입 후 boundingBox 경계 검증
  - S1 데스크톱 ✅ / S2 모바일 ✅ / REG 라벨 무변경 ✅ — 실 시드 플로우(이 환경에 시드 존재, skip 없이 실행)
- 브라우저 시뮬레이션 근거(스크린샷):
  - `evidence/T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW_H1_desktop.png` — 3버튼 우측 정렬, 경계 내, overflow 없음
  - `evidence/T-20260611-foot-CHART2-CONFIRM-BTN-OVERFLOW_H2_mobile.png` — 3버튼 세로 스택, 경계 내, overflow 없음
  - 확인 스텝: `/admin/customers` 로 앱 CSS 로드 → 정본 클래스(dialog.tsx/button.tsx/Footer className) 복제 DOM 주입
    → 각 버튼 boundingBox 가 다이얼로그 box 의 L/R/T/B 경계 내(1px tol) 임을 단언.

## QA FIX (supervisor FIX-REQUEST, qa_fail_phase=phase2, insufficient_verification)

- 원인: 기존 spec 3종(S1/S2/REG)이 모두 실서버 시드 의존 → 시드 미존재 환경에서 전부 graceful skip → "실측 0건".
- 조치: 시드와 무관하게 **항상 실행되는 HARNESS 2종**(H1 데스크톱 / H2 모바일)을 추가.
  구동 중 앱의 실 Tailwind CSS 를 로드한 뒤 정본 클래스 복제 DOM 을 주입해 실제 레이아웃 boundingBox 로 검증 + 스크린샷 저장.
- 결과: 6 passed / 0 skipped. 스크린샷 2종 첨부. CSS-only 수정(핸들러·로직·DB 무변경) 유지.
