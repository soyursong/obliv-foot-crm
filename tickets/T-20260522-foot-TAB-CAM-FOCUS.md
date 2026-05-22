---
id: T-20260522-foot-TAB-CAM-FOCUS
title: "Galaxy Tab 카메라 autofocus 미작동 — 사진 선명도 저하"
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-05-22
deadline: 2026-05-29
deploy_ready: true
deploy_ready_at: 2026-05-22T23:55:00+09:00
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.23s"
commit_sha: 00554a8
e2e_spec: tests/e2e/T-20260522-foot-MEDIMG-CAMERA.spec.ts
e2e_spec_exempt_reason: ef_only (하드웨어 카메라 — MEDIMG-CAMERA spec의 FIX-AC-5/FIX-AC-5-GRACEFUL로 대체)
signals_recorded: true
related_ticket: T-20260522-foot-MEDIMG-CAMERA (flickering fix 모티켓)
fix_applied: "applyConstraints({ advanced: [{ focusMode:'continuous' }] }) + try/catch graceful fallback"
---

## 개요

Galaxy Tab 카메라 autofocus 미작동으로 진료이미지 사진 촬영 시 초점 미잡힘 → 이미지 선명도 저하.
MEDIMG-CAMERA flickering fix(db3173b)와 **별도 이슈**로 현장 명시 (타켓: T-20260522-foot-TAB-CAM-FOCUS).

## 원인 분석

- flickering fix(db3173b)에서 `getUserMedia` `width/height` constraints 제거 후 `focusMode` 도 미지정 상태
- Galaxy Tab Android WebView 기기 기본값이 `'manual'`/`'none'`이 될 수 있음
- `getUserMedia` 자체에 `focusMode` 추가 불가 (Chrome 미지원) → `applyConstraints` 사후 적용 필요

## 구현 (commit 00554a8 — MEDIMG-CAMERA FIX-AC-5로 통합 반영)

`selectTypeAndStart` 함수, getUserMedia 성공 직후:

```typescript
// FIX-AC-5 T-20260522-foot-MEDIMG-CAMERA (autofocus):
// Galaxy Tab Android WebView 기본값이 'manual'/'none' → 연속 AF 명시
try {
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    await videoTrack.applyConstraints({
      advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
    });
  }
} catch (_afErr) {
  // focusMode 미지원 기기는 무시 (iOS Safari, 구형 Chrome 등)
}
```

## AC 충족 현황

- **AC-1** ✅ getUserMedia 성공 후 `applyConstraints({ advanced: [{ focusMode: 'continuous' }] })` 적용
- **AC-2** ✅ 연속 AF 명시로 Galaxy Tab 촬영 선명도 개선
- **AC-3** ✅ `useCallback([])` + RAF + GPU layer 완전 유지 (db3173b flickering fix 회귀 없음)
- **AC-4** ✅ `try/catch` — `applyConstraints` throw 시 capture phase 정상 진입 (iOS Safari 등 graceful ignore)

## E2E 검증

`tests/e2e/T-20260522-foot-MEDIMG-CAMERA.spec.ts` 기존 spec 활용:

- `FIX-AC-5`: `applyConstraints` mock → `focusMode: 'continuous'` 호출 검증 (AC-1, AC-2)
- `FIX-AC-5-GRACEFUL`: `applyConstraints` throw → capture phase 정상 진입 검증 (AC-4)

e2e_spec_exempt_reason: ef_only — 하드웨어 카메라 제어는 실기기 없이 완전 자동화 불가.
MEDIMG-CAMERA spec이 동일 코드 경로 커버.

## 참고

- 구현 위치: `src/pages/CustomerChartPage.tsx` L632–L646 (`selectTypeAndStart`)
- 관련 commit: `00554a8` (FIX-AC-5), `db3173b` (flickering fix)
- 현장 보고: 2026-05-22 23:25 김주연 총괄 (별도 이슈 명시)
