---
id: T-20260525-foot-PENCHART-FORM-BLACK
domain: foot
priority: P1
status: qa-pending
deploy_ready_at: null
impl_commit: dc7333b
db_changed: false
e2e_spec: tests/e2e/T-20260525-foot-PENCHART-FORM-BLACK.spec.ts
build_ok: true
hotfix: false
created: 2026-05-25 17:47
deadline: 2026-06-01
assignee: dev-foot
slack_channel: C0ATE5P6JTH
slack_thread_ts: null
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
attachments: []
e2e_spec_exempt_reason: null
risk_verdict: GO_WARN
risk_reason: "1/5 — 비즈로직(펜차트 양식 렌더링은 임상 문서 경로). 최근 PENCHART-FORM-AUTOFILL(5/24 배포) 또는 FORM-TEMPLATE-REGEN(배포) 회귀 가능성 조사 필요."
qa_result: pass
qa_grade: Yellow
qa_fail_phase: ""
qa_fail_reason: ""
deployed_at: 2026-05-27T19:45+09:00
deploy_commit: dc7333b
bundle_hash: null
field_soak_until: null
reopen_reason: "REOPEN4 2026-05-27 19:45: [진단 계측 + 타이밍 수정] AC-R4-6 번들검증 완료(REOPEN3 코드 배포됨). CSS bundle 증거: animation-duration=150ms + @keyframes enter{0%{transform:translate3d(0,0,0)}} → 50ms(구)는 GPU layer 활성 중 canvas 초기화. 수정: 50ms→200ms(애니메이션완료후). 진단추가: ?penchart_no_desync URL param + [DIAG-R4-3] alpha테스트 + [DIAG-R4-4] CSS stacking context 전수 + [DIAG-R4-5] CORS taint. deploy-ready=false — 실기기 스크린샷 필수."
reopen_fix_commit: dc7333b
reopen_count: 4
---

# T-20260525-foot-PENCHART-FORM-BLACK — 펜차트 전체 양식 검정 화면 + 튕김

## 요약

펜차트 "전체 양식" 뷰에서 검정(black) 화면이 표시되고, 이후 앱에서 튕겨나감(라우트 이탈 또는 크래시).

## Phase 1 QA (2026-05-25 supervisor)

### 빌드
- `npm run build` → 3.33s, exit 0 ✅

### 코드 변경 요약
- **핵심 수정 (검정화면 + 튕김 근본원인)**: `mode === 'select'` / `mode === 'draw'` 각각 별도 `FullscreenFormWrapper` 인스턴스 → 단일 `if (mode === 'select' || mode === 'draw')` 로 통합. 전환 시 Dialog 재마운트 → `onOpenChange(false)` → `setMode('list')` 오발화 제거.
- **AC-4 폴백 UI**: `bgImgLoadError` state + `img.onerror` (`setBgImgLoadError(true)` + `console.error`) + `img.onload` 성공 시 초기화 + `data-testid="penchart-bg-load-error"` fallback div + "다시 시도" 버튼 → `initCanvas`
- **DB 변경**: 없음
- **Runtime Safety**: for-of 3개 전량 가드 확인 (positions 배열 직접 리터럴 / events `?? [e.nativeEvent]` / `placedItems.length > 0` 선행체크) ✅
- **env vars**: 신규 없음 (VITE_SUPABASE_URL·ANON_KEY only) ✅

### Phase 1 결과: PASS (코드 품질 문제 없음)

## Phase 2 QA FAIL

### E2E spec 실패
- 13/13 tests FAIL — `ReferenceError: require is not defined`
- 원인: `tests/e2e/T-20260525-foot-PENCHART-FORM-BLACK.spec.ts` 내 각 테스트 바디에서 `const fs = require('fs')` 사용 → Playwright ESM 환경에서 CommonJS require 미지원
- 어시션 내용 자체는 현행 코드와 정합 (production 코드 검증 결과 모든 패턴 존재 확인됨)
- 수정: spec 상단에 `import * as fs from 'fs';` 추가, 각 테스트 바디의 `const fs = require('fs');` 13개 삭제

### 수정 지시 → dev-foot
→ dev MQ FIX-REQUEST 전달됨

## REOPEN 3 (2026-05-26 21:15) — 근본 원인 특정 + 최종 수정

### 근본 원인 (DevTools 증거 기반)

| 증거 | 내용 |
|------|------|
| ① 인과 타임라인 | b955a8c(5/24 PENCHART-PEN-SLOW) 배포 → 다음날(5/25) 첫 검정화면 보고 |
| ② REOPEN 1 스크린샷 | 검정 배경 위 흰 펜획 — drawCanvas 드로잉 정상, bgCanvas(이미지)만 안 보임 |
| ③ 1·2차 수정 실패 | 2f341f1·6ed19d1 drawImage/tiling 수정으로 미해결 → 레이어 차원 문제 확인 |

**원인**: b955a8c에서 `willChange:'transform'` + `desynchronized:true` 동시 추가
→ draw canvas가 별도 GPU compositor layer로 승격
→ 불투명(alpha-less) GPU 텍스처 할당
→ 투명 픽셀 = BLACK
→ bgCanvas(양식 배경 이미지)가 가려져 전체 검정화면

### 수정 (commit aac5085)
- draw canvas `<canvas>` style에서 `willChange:'transform'` 제거
- `desynchronized:true` 유지 (HW 가속 펜 응답성 보존)
- REOPEN 2 변경 누적 유지: `img.decode()` await + `createImageBitmap` 타일 분할 + stale check

### E2E spec
- spec: 45/45 pass (AC-3·4·5·R1·R2·R3·R4·R2-1·R2-2·R2-3·R3-ROOT 전체 포함)
- build: ✓ 3.39s, DB변경: 없음
