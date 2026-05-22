---
id: T-20260522-foot-MEDIMG-CAMERA
title: "진료이미지 [사진촬영] 버튼 — 시술 전/후 선택 + 연속촬영 + 자동업로드 + 편집/회전"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-22
deadline: 2026-05-27
go_warn: true
deploy_ready: true
deploy_ready_at: 2026-05-22T14:45:00+09:00
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.16s"
commit_sha: pending
e2e_spec: tests/e2e/T-20260522-foot-MEDIMG-CAMERA.spec.ts
signals_recorded: true
fix_applied: "flickering+autofocus — useCallback([])+RAF+getUserMedia-constraints+GPU-layer+applyConstraints(focusMode:continuous)"
---

## 개요

고객차트(2번차트) 진료이미지 탭에 [사진촬영] 버튼을 추가.
S Pen 태블릿에서 원내에서 직접 시술 전/후 사진 촬영 → Supabase Storage 자동업로드.
편집/회전 기능까지 Canvas API로 구현 (신규 npm 패키지 없음).

## 구현 (이미 배포됨: commit 1d6634a)

### AC-1: [사진촬영] 버튼
- `TreatmentImagesSection` 업로드 바에 teal-600 강조 버튼 추가

### AC-2: 시술 전/후 선택 (fullscreen 모달)
- black 배경, 시술 전(blue) / 시술 후(emerald) 대형 버튼
- `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`

### AC-3: 연속촬영
- 셔터 버튼 (큰 원형, S Pen 대응)
- 촬영된 사진 우상단 썸네일 + 개별 취소 가능
- 완료(N장) 버튼으로 일괄 업로드

### AC-4: 자동업로드 + 프로그레스
- Supabase Storage `photos` 버킷 → `customer/{id}/treatment-images/{type}_{ts}_{rand}.jpg`
- 업로드 중 프로그레스바 (done/total)

### AC-5: 편집/회전
- 이미지 hover → RotateCw 버튼 → 편집 모달
- Canvas API로 90도 단위 좌/우 회전 → 원본 삭제 후 회전본 재업로드

### AC-6: 태블릿(S Pen) 대응
- `video ref callback` 방식으로 DOM 마운트 직후 스트림 연결
- `playsInline muted autoPlay` 속성

## FIX (2026-05-22 flickering 재발)

**field-soak 버그**: Galaxy Tab 카메라 프리뷰 flickering (김주연 총괄 01:29 보고, P2→P1 승격)

### 근본 원인 (3가지 복합)

1. **주원인 — `videoRefCallback` 미메모이제이션**
   - `capturedBlobs` 상태 변경(썸네일 추가)마다 새 함수 참조 생성
   - React가 old→null / new→el 반복 호출 → `srcObject` 재설정 + `play()` 재실행
   - → 화면 깜빡임(flickering)

2. **`getUserMedia` 해상도 제약**
   - `width: { ideal: 1920 }, height: { ideal: 1080 }` 강제 → Galaxy Tab 카메라 해상도 재협상 유발

3. **play() 동기 호출**
   - Android WebView에서 `srcObject` 직후 즉시 `play()` → 프레임 드롭

### 수정 내용

- `videoRefCallback` → `useCallback([], [])` 메모이제이션 (렌더 전체에 동일 함수 참조)
- `play()` → `requestAnimationFrame(() => { if (el.srcObject) el.play() })` RAF 지연
- `getUserMedia` constraints에서 `width/height` 제거 (device 네이티브 해상도 사용)
- video element에 `disablePictureInPicture` + `style={{ transform: 'translateZ(0)', willChange: 'transform' }}` (GPU 컴포지팅 레이어 고정)

### FIX AC 충족

- FIX-AC-1: 영상 증거(012855_F0B5F5FC281) 기반 원인 특정 ✅
- FIX-AC-2: `videoRefCallback` 미메모이제이션 + constraints + RAF 3가지 원인 특정 ✅
- FIX-AC-3: useCallback+RAF+GPU 레이어로 안정적 프리뷰 ✅
- FIX-AC-4: 기존 업로드·편집·연속촬영 로직 무변경 (regression 없음) ✅
- FIX-AC-5: 초점(autofocus) 정상 동작 — `applyConstraints({ advanced: [{ focusMode: 'continuous' }] })` 명시 설정 ✅

### FIX-AC-5 — autofocus 초점 미잡힘 (2026-05-22 23:25 추가 보고)

**증상**: "2번차트 진료 이미지 촬영 시 초점이 정상적으로 잡히지 않아 이미지 화질 저하" (김주연 총괄)

**원인 분석**:
- flickering fix에서 `width/height` constraints 제거 후 `getUserMedia` constraint이 `facingMode`만 남음
- `focusMode` 미지정 시 Galaxy Tab Android WebView는 기기 기본값(`manual` 또는 `none`)이 적용될 수 있음
- `videoRefCallback useCallback([])` 및 RAF play() 지연은 autofocus에 영향 없음 (AF는 MediaStreamTrack 레벨)
- `getUserMedia` 자체에 `focusMode` 추가 불가 (Chrome 미지원) → `applyConstraints` 사후 적용

**수정 내용** (`selectTypeAndStart` 함수):
```typescript
const videoTrack = stream.getVideoTracks()[0];
if (videoTrack) {
  await videoTrack.applyConstraints({
    advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
  });
}
```
- `try/catch`로 미지원 기기(iOS Safari 등) graceful ignore
- flickering fix (useCallback+RAF+GPU layer) 완전 유지

**E2E Spec 추가**:
- `FIX-AC-5`: `applyConstraints` mock으로 `focusMode: 'continuous'` 호출 검증
- `FIX-AC-5-GRACEFUL`: `applyConstraints` throw 시에도 capture phase 정상 진입

### E2E Regression spec 추가

`FIX-REGRESSION: 썸네일 추가 후 video srcObject 안정 유지` — play() 재호출 횟수 ≤1 검증
`FIX-AC-5: getUserMedia 후 applyConstraints focusMode:continuous 호출 검증`
`FIX-AC-5-GRACEFUL: applyConstraints throw 시에도 카메라 정상 진입`

## 참고

GO_WARN: 브라우저 카메라 권한 팝업이 최초 1회 발생. 현장 안내 필요.
CheckInDetailSheet(1번차트)는 파일 업로드만 유지 (카메라 미적용 — 별도 P3 판단).
