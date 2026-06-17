---
ticket_id: T-20260618-foot-MEDIMG-PINCH-ZOOM
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-18
owner: agent-fdd-dev-foot
requester: 김주연 총괄 (#풋센터)
approved_by: planner NEW-TASK MSG-20260618-072621-gwop
parent: T-20260617-foot-MEDIMG-CAMERA-ZOOM-FOCUS (commit 5ecd08c2)
build_ok: true
spec_added: tests/e2e/T-20260618-foot-MEDIMG-PINCH-ZOOM.spec.ts
db_changed: false
data_architect_consult: 불요 — FE 입력경로(Pointer Events) 추가만. 신규 컬럼·테이블·enum·필드매핑 0. 신규 npm 0.
risk_level: GO (2/5 — 부모 zoom state/applyZoom 재사용, 두 번째 입력경로만 추가. zoom↔focusMode 분리 무회귀)
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-18
commit_sha: afe74716
qa_result: self-pass-pending-supervisor
field_soak_gate: 실 Galaxy Tab 멀티터치 + 김주연 총괄 현장 confirm (최종 게이트)
---

# T-20260618-foot-MEDIMG-PINCH-ZOOM — 진료이미지 촬영 프리뷰 핀치투줌

## 요청 (NEW-TASK, planner P2 — MSG-20260618-072621-gwop)

reporter 김주연 총괄: "손가락으로! 갤럭시탭으로" — 핀치 선호 확정.
부모 티켓(T-20260617-foot-MEDIMG-CAMERA-ZOOM-FOCUS, deployed commit 5ecd08c2) confirm 게이트의 예정된 후속 분리.

## 구현 (CustomerChartPage.tsx)

진료이미지 촬영(TreatmentImagesSection) 카메라 프리뷰에 **핀치투줌**을 두 번째 입력경로로 추가.

### 핵심 가드 (전부 준수)
- **부모 zoom state 재사용**: `zoom`(1~MAX_ZOOM=3)·`hwZoomActive`·`zoomCapsRef`·`applyZoom()` 그대로. 별도 줌 파이프라인 신설 안 함 — 핀치는 `applyZoom()`을 호출하는 두 번째 입력경로일 뿐.
- **zoom 제약 ↔ focusMode applyConstraints 분리 원칙 무회귀**(부모 AC-3): 줌은 `applyZoom()` 내부의 독립 `advanced:[{zoom}]` 호출만 사용. focusMode와 절대 동일 호출에 혼합 안 함. atomic OverconstrainedError 함정 회피.
- **+/− 버튼 병행 유지**(제거 안 함): 핀치/버튼이 동일 `zoom` state·`applyZoom()` 공유.
- **native Pointer Events**(2-pointer 거리 추적): 제스처 라이브러리 신규 npm 0. `activePointersRef`(Map)·`pinchStartDistRef`·`pinchStartZoomRef` 추가.
- **1-pointer 보존**: 1-pointer는 기존 탭-투-포커스(`handleVideoTap`) 그대로. 2-pointer일 때만 줌.
- `touchAction: 'none'`을 프리뷰 video에 부여 → 브라우저 기본 2-finger 페이지 줌 가로채기 차단(핀치 신뢰성).

### 매핑 수식 (UNIT spec)
`nextZoom = pinchStartZoom × (curDist / pinchStartDist)` → `applyZoom()`이 [1, MAX_ZOOM] clamp + 0.1 round + 하드웨어/디지털 분기 일원화.

## AC
- [x] 핀치(spread)로 프리뷰 확대, 핀치(in)로 축소 — 배율 표시 동기화
- [x] 캡처본 배율 반영 (부모 applyZoom 하드웨어/디지털 경로 그대로 → 캡처 crop·scale 재사용)
- [x] +/− 버튼 병행 동작 (동일 state 공유)
- [x] 1-pointer 탭-투-포커스·focus·연속촬영·자동업로드·회전 무회귀
- [x] zoom↔focusMode 분리 무회귀 (혼합 호출 0건)

## 검증
- 빌드: `tsc -b && vite build` PASS
- spec: tests/e2e/T-20260618-foot-MEDIMG-PINCH-ZOOM.spec.ts (UNIT 매핑/clamp PASS, 합성 PointerEvent 핀치 E2E + AC-3 분리 가드 + 회귀)
- ⚠ **최종 게이트**: 실 Galaxy Tab 멀티터치 field-soak + 김주연 총괄 현장 confirm. headless는 매핑·구조·분리만 코드가드.
