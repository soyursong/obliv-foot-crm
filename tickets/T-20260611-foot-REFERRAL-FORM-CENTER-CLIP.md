---
id: T-20260611-foot-REFERRAL-FORM-CENTER-CLIP
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-06-11
completed: 2026-06-11
db_changed: false
db_migration: none
db_gate: N/A
scenario_count: 1
commit: ad0a851
spec: tests/e2e/T-20260611-foot-REFERRAL-FORM-CENTER-CLIP.spec.ts
build: pass
---

# T-20260611-foot-REFERRAL-FORM-CENTER-CLIP — 진료의뢰서 양식 짤림/중앙배치 수정

## 증상 (현장 스크린샷)
인쇄된 진료의뢰서에서 (1) 상단 제목 중앙정렬 어긋남, (2) 상·하단이 A4 인쇄영역을 벗어나 짤림.

## 원인
직전 수정(T-20260611-foot-REFERRAL-PRINT-CLIP-CENTER)이 **좌우 여백만**(margin:0 auto, 좌우 11mm)
적용해 form-wrap이 A4 page 최상단(top 0mm)에 붙음. 프린터 unprintable 상단영역(~5mm)이
제목/상단 테두리를 잘라냄(상단 짤림). 슬랙 30mm는 전부 하단에 낭비. 제목은 Chromium(=window.print
엔진)에서 이미 정확 중앙정렬이나, 상단 짤림으로 시각적으로 어긋나 보였음.

## 수정
좌우와 동일 논리로 **상하 12mm 여백 추가**: `margin:0 auto` → `margin:12mm auto`
(src/lib/htmlFormTemplates.ts, REFERRAL_LETTER_HTML form-wrap 인라인 1줄).
COMMON_STYLE 무변경 → 다른 6종 양식·DOC-FORM-7FIX 회귀 영향 없음.

## 검증 (A4 실측 @96dpi, print media)
- 제목 잉크 중심 offset **0.02px** (≈0.00mm) — 중앙정렬 ✅ (AC-1)
- 상단 여백 12mm / 하단 클리어런스 18mm — 둘 다 프린터 비인쇄 5mm 초과, 짤림 0 ✅ (AC-2)
- 좌/우 여백 11mm 대칭, overflow 클립 없음 ✅ (AC-3)
- 단계별 브라우저(인쇄 preview) 렌더 시각 확인 완료 (evidence/referral_render_AFTER.png)

## 산출물
- 코드: src/lib/htmlFormTemplates.ts (commit ad0a851)
- spec: tests/e2e/T-20260611-foot-REFERRAL-FORM-CENTER-CLIP.spec.ts (2 passed)
- 하니스: scripts/T-20260611-foot-REFERRAL-FORM-CENTER-CLIP_render.mjs
- evidence: evidence/referral_render_BEFORE.png / referral_render_AFTER.png

## FOLLOWUP (별건, 범위 외)
의뢰서 외 6종 HTML 양식(의무기록사본발급신청서·진단서 등)은 기본 form-wrap(190mm)이 좌측정렬
(margin auto 미적용)이라 제목이 page 중앙보다 **약 10mm 좌측**으로 측정됨. 의뢰서가 직전 수정
전에 가졌던 동일 패턴 — 현장이 추후 동일 인쇄 짤림/미중앙을 제기할 가능성. planner에 FOLLOWUP 보고.
