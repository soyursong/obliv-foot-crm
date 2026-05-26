---
id: T-20260526-foot-CAMERA-FOCUS-BUG
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
spec_added: tests/e2e/T-20260526-foot-CAMERA-FOCUS-BUG.spec.ts
regression_risk: low
created: 2026-05-26
deadline: 2026-05-28
risk_verdict: GO_WARN
---

# T-20260526-foot-CAMERA-FOCUS-BUG — 2번차트 진료이미지 카메라 auto-focus 미작동

## 증상

2번차트(CustomerChartPage) 진료이미지 섹션에서 사진촬영 시 카메라 auto-focus가 작동하지 않음.
영상 증거: `~/file_inbox/20260526/093919_F0B62SVLRT4_IMG_8070.MOV`
슬랙 스레드: C0ATE5P6JTH / 1779755915.878279

## 근본 원인

`applyConstraints`에서 `focusMode: 'continuous'`를 `advanced[]` 배열 안에만 지정.

**W3C MediaCapture spec**: `advanced` 배열은 "전체 constraint set이 충족 가능한 경우에만 적용"되는 optional hint.
Galaxy Tab (Android WebView / Chrome) 환경에서 조건 불일치 시 **전체 set 무시** → 카메라가 `manual` 또는 `none` 상태 유지 → 초점 고정(흐림).

## 수정 내용

`src/pages/CustomerChartPage.tsx` — `selectTypeAndStart` 함수 내 `applyConstraints` 블록:

### 변경 전
```js
await videoTrack.applyConstraints({
  width: { min: 1280 },
  advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
});
```

### 변경 후
```js
// getCapabilities()로 기기 지원 AF 모드 확인
const caps = (videoTrack.getCapabilities?.() ?? {}) as ExtCaps;
const supportedModes = caps.focusMode ?? [];
const bestMode =
  supportedModes.includes('continuous') ? 'continuous' :
  supportedModes.includes('single-shot') ? 'single-shot' :
  null;

// top-level constraint로 적용 (advanced[] 단독 대비 Galaxy Tab 호환성 향상)
const extraConstraints = bestMode ? { focusMode: bestMode } : {};
await videoTrack.applyConstraints({
  width: { min: 1280 },
  ...extraConstraints,
  ...(bestMode ? { advanced: [{ focusMode: bestMode }] } : {}),
});
```

## 핵심 개선

| 항목 | 구버전 | 수정 |
|------|--------|------|
| focusMode 위치 | `advanced[]`만 | top-level + `advanced[]` 보조 |
| 기기 지원 확인 | 없음 | `getCapabilities()` 사전 확인 |
| continuous 폴백 | 없음 | `single-shot` 폴백 지원 |
| 미지원 기기 | silent ignore | 동일 (try/catch) |

## 수용기준 충족

- [x] AC-1: applyConstraints top-level focusMode 적용 → continuous AF 활성화
- [x] AC-2: getCapabilities()로 기기 지원 모드 확인 후 최적 모드 적용
- [ ] AC-3: 김주연 총괄 현장 검증 (현장 사용 후 확인 필요)
- [x] AC-4: 빌드 통과 + E2E spec 회귀 없음

## E2E spec

`tests/e2e/T-20260526-foot-CAMERA-FOCUS-BUG.spec.ts`
- AC-1/AC-2: top-level focusMode:continuous 적용 검증 (getUserMedia mock)
- AC-2: single-shot 폴백 검증
- AC-2: focusMode 미지원 기기에서도 카메라 정상 열림
- AC-4: CustomerChartPage 진료이미지 탭 렌더 회귀 없음
- UNIT: advanced[]만 방식(구버전) vs top-level(수정) 구조 차이 문서화

## 관련 티켓

- T-20260522-foot-MEDIMG-CAMERA (사진촬영 기능 확장, P2) — 기존 기능 내 초점 버그
