---
id: T-20260525-foot-PENCHART-FORM-BLACK
domain: foot
priority: P1
status: deploy-ready
deploy_ready_at: 2026-05-26 02:10
impl_commit: 6ed19d1
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
qa_grade: ""
qa_fail_phase: ""
qa_fail_reason: ""
deployed_at: ""
deploy_commit: ""
bundle_hash: ""
field_soak_until: ""
reopen_reason: "REOPEN 2026-05-26: canvas 활성·펜 그려짐·배경 이미지 미렌더링. setBgImgLoadError(false) onload 시작 즉시 호출 버그 → drawImage 실패 시 fallback 비표시. GPU context loss + naturalWidth=0 + drawImage try-catch 추가."
reopen_fix_commit: 6ed19d1
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
