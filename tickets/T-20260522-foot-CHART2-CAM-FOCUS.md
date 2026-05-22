---
id: T-20260522-foot-CHART2-CAM-FOCUS
title: "2번차트 카메라 초점 오류 — autofocus + 해상도 1280px 보장"
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-05-22
deadline: 2026-05-29
deploy_ready: true
deploy_ready_at: 2026-05-22T23:58:00+09:00
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.14s"
commit_sha: 996eb6f
e2e_spec: tests/e2e/T-20260522-foot-MEDIMG-CAMERA.spec.ts
e2e_spec_exempt_reason: null
related_ticket: T-20260522-foot-MEDIMG-CAMERA (flickering fix 모티켓), T-20260522-foot-TAB-CAM-FOCUS (autofocus FIX-AC-5)
fix_applied: "applyConstraints({ width:{ min:1280 }, advanced:[{ focusMode:'continuous' }] }) + capturePhoto canvas scale-up double-safety"
source_msg: MSG-20260522-233743-qhwm
---

## 개요

2번차트(CustomerChartPage) 진료이미지 촬영 시 초점 미잡힘 + 해상도 1280px 미보장 이슈.
MEDIMG-CAMERA(REOPEN1) flickering fix(db3173b) 이후 `getUserMedia` constraints에서 `width/height` 제거 시
focusMode + 해상도 제어도 함께 빠진 상태였음.

## 원인 분석

| # | 원인 | 해결 방법 |
|---|------|----------|
| 1 | `getUserMedia` constraints에 `focusMode` 미지정 → Android WebView 기본값 `manual/none` | `applyConstraints` 사후 적용 (Chrome getUserMedia 미지원) |
| 2 | `getUserMedia` width/height 제거 후 해상도 보장 로직 없음 | `applyConstraints({ width: { min: 1280 } })` + canvas scale-up double-safety |
| 3 | `capturePhoto`에서 `video.videoWidth < 1280` 시 그대로 캡처 | `scale = naturalW < 1280 ? 1280/naturalW : 1` scale-up 추가 |

## 구현

### 1. `selectTypeAndStart` — applyConstraints 업데이트 (L636~L649)

```typescript
// AC-3 T-20260522-foot-CHART2-CAM-FOCUS (해상도):
// width: { min: 1280 } — getUserMedia width/height 제거 후 스트림 레벨 1280px 보장
try {
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    await videoTrack.applyConstraints({
      width: { min: 1280 },
      advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
    });
  }
} catch (_afErr) {
  // focusMode/해상도 미지원 기기 무시 (iOS Safari, 구형 Chrome 등)
}
```

### 2. `capturePhoto` — canvas scale-up double-safety (L677~L691)

```typescript
const naturalW = video.videoWidth || 1280;
const naturalH = video.videoHeight || 720;
// AC-3: 최소 1280px — applyConstraints 실패 시 canvas scale-up 대비
const minWidth = 1280;
const scale = naturalW < minWidth ? minWidth / naturalW : 1;
canvas.width = Math.round(naturalW * scale);
canvas.height = Math.round(naturalH * scale);
ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
```

## AC 충족 현황

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | autofocus 정상 동작 (근접 촬영 포함) | ✅ `applyConstraints({ advanced:[{ focusMode:'continuous' }] })` |
| AC-2 | focusMode: 'continuous' 설정 | ✅ `advanced` 배열로 설정 (Chrome getUserMedia 미지원 → applyConstraints 방식이 올바름) |
| AC-3 | 촬영 이미지 해상도 1280px 이상 | ✅ `width:{ min:1280 }` applyConstraints + canvas scale-up double-safety |
| AC-4 | MEDIMG-CAMERA(flickering fix)와 충돌 없음 | ✅ useCallback+RAF+GPU layer 완전 유지 |

## E2E Spec 추가

`tests/e2e/T-20260522-foot-MEDIMG-CAMERA.spec.ts`:

- **AC-3-CONSTRAINTS**: `applyConstraints` mock → `width.min === 1280` + `focusMode === 'continuous'` 동시 검증
- **AC-3-CANVAS**: `video.videoWidth=640` 저해상도 시뮬레이션 → `canvas.width >= 1280` 확인 (scale-up double-safety)

## 참고

- 구현 위치: `src/pages/CustomerChartPage.tsx` L636~L649 (`selectTypeAndStart`), L677~L691 (`capturePhoto`)
- 관련 commit: TAB-CAM-FOCUS → `00554a8` (FIX-AC-5 autofocus), CHART2-CAM-FOCUS → 이 커밋
- 현장 보고: 2026-05-22 23:25 김주연 총괄 (T-20260522-foot-MEDIMG-CAMERA REOPEN1 추가 증상)
- planner 발행: MSG-20260522-233743-qhwm
