---
id: T-20260525-foot-RESV-CANCEL-ANYDATE
domain: foot
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: true
e2e_spec_added: true
summary: "예약관리 전일자 취소 허용. resv-card 외부 div에 onContextMenu 추가 → 이름 span 외 영역 우클릭도 취소메뉴 접근 가능. isToday 제한 없음 코드 분석 확인. 빌드 3.33s OK. E2E spec auth 표준화(localhost:5173→storageState/helpers, /admin/dashboard→/admin) FIX 후 5/5 PASS. QA build cmd: npm run build:verify (cross-platform, scripts/build.sh wrapper)."
qa_result: pending
qa_grade: Yellow
deploy_commit: 2a2d3dd
deployed_at: 2026-05-26T05:39:00+09:00
bundle_hash: Reservations-CAU9yxco.js
field_soak_until: 2026-05-27T05:39:00+09:00
qa_build_cmd: "npm run build:verify 2>&1 | tail -30"
qa_fail_history: "MSG-20260531-044143-v77i phase2 spec_fail_new (E2E /auth 리다이렉트 4 fail) → spec auth 표준화로 해소"
---

## T-20260525-foot-RESV-CANCEL-ANYDATE — 예약관리 전일자 예약 취소 허용

### 조사 결과

**날짜 제한(isToday) 코드 분석 결과: 제한 없음 확인**

- `handleResvCancelRequest` — 날짜 비교 없음. `rows.find(r.id)` + `status !== 'cancelled'` 만 체크
- `handleResvCancelConfirm` — DB update 날짜 조건 없음
- `CustomerQuickMenu.onCancelReservation` — 조건 없이 always 제공

**실제 UX 문제 발견 (Root cause)**

| 영역 | 이전 동작 | 변경 후 |
|------|-----------|---------|
| 이름 span 위 우클릭 | ✅ CustomerQuickMenu 표시 | ✅ 유지 |
| 상태·전화·메모 영역 우클릭 | ❌ 컨텍스트메뉴 미표시 | ✅ 표시됨 |
| 전일자·미래일 이동 후 우클릭 | ❌ 동작 불명확 | ✅ 날짜 무관 동작 |

Dashboard.tsx의 `!isPast` 조건(타임라인 컨텍스트메뉴 past 날짜 비활성)과 혼동한 것이 "당일만 취소 가능"으로 인식된 원인.

### 구현 (commit 1건)

**변경 파일**: `src/pages/Reservations.tsx`

```tsx
// T-20260525-foot-RESV-CANCEL-ANYDATE: 카드 전체 영역 우클릭 → 컨텍스트메뉴
// (이름 span 밖 클릭도 취소 메뉴 접근 가능 — 전일자 포함 날짜 무관 동작)
onContextMenu={(e) => {
  if (r.customer_id && r.status !== 'cancelled') {
    e.preventDefault();
    e.stopPropagation();
    setResvContextMenu({ resv: r, pos: { x: e.clientX, y: e.clientY } });
  }
}}
```

- 카드 외부 div에 `onContextMenu` 핸들러 추가
- `CustomerHoverCard` 내부 span의 `e.stopPropagation()` 덕분에 이름 영역 우클릭은 기존 동작 유지 (이중 트리거 없음)
- 조건: `r.customer_id && r.status !== 'cancelled'` — 기존 CustomerHoverCard 렌더 조건과 동일

### AC 검증

- **AC-1**: 예약관리 비당일 예약에도 취소 버튼/컨텍스트메뉴 활성화 ✅ (카드 전체 영역)
- **AC-2**: 기존 취소 흐름(사유 입력 → cancelled_at/cancel_reason/cancelled_by) 동일 적용 ✅ (코드 불변)
- **AC-3**: 대시보드 영향 없음 ✅ (Dashboard.tsx 미수정)

### DB 변경

없음 (FE only)

### 빌드

```
✓ built in 3.30s
```

### E2E spec

`tests/e2e/T-20260525-foot-RESV-CANCEL-ANYDATE.spec.ts` — 5개 테스트
- AC-1: 카드 전체 영역 우클릭 → 컨텍스트메뉴
- AC-1: 이전 주 이동 후 취소 접근
- AC-2: 취소 모달 날짜 무관 동작
- AC-3: 대시보드 영향 없음
- 회귀: 예약관리 JS 에러 없음

---

### QA 빌드 재검증 (FIX-REQUEST MSG-20260527-161622-en44 대응)

**원인**: supervisor 환경(macOS)에 GNU `timeout` 명령 없음 → `timeout 60 npm run build` 실패

**이미 구현된 cross-platform 해결책**:
- `scripts/build.sh` — GNU `timeout` → `gtimeout` → no-timeout 3단계 fallback wrapper (기존 파일)
- `npm run build:verify` — `bash scripts/build.sh 60` 호출 (package.json에 이미 등록)

**QA 올바른 빌드 명령** (supervisor Phase 1):
```bash
npm run build:verify 2>&1 | tail -30
```
(`timeout 60 npm run build 2>&1 | tail -30` 대체)

**재검증 빌드 결과** (2026-05-27):
```
[build.sh] WARNING: timeout/gtimeout not found — running build without time limit
✓ built in 3.31s
```

**결론**: 코드 변경 없음. `scripts/build.sh` wrapper 기존 구현 확인. QA Phase 1은 `npm run build:verify`로 재실행 가능.

---

### E2E spec 인증 FIX (FIX-REQUEST MSG-20260531-044143-v77i 대응)

**qa_fail**: phase2 / spec_fail_new — Playwright 4 fail / 1 skip / 1 pass. 전 실패가 `/auth` 리다이렉트로 URL 검증 실패 (`Expected /reservations/ but Received http://localhost:5173/auth`).

**Root cause (spec only — 프로덕션 코드 무관)**:
1. spec이 `BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'` 하드코딩 → config `baseURL=http://localhost:8089` 와 origin 불일치. storageState(`.auth/user.json`)는 8089 origin localStorage 기준이라 5173에서 세션 미인식 → `/auth` 리다이렉트.
2. 커스텀 `loginIfNeeded`(getByPlaceholder('이메일') + test@test.com/testpass)는 실제 인증 불가 — 표준 storageState 패턴(`tests/helpers.loginAndWaitForDashboard`) 미사용.
3. AC-3가 `/admin/dashboard`로 이동 후 `toHaveURL(/dashboard/)` 검증 → 실제 대시보드는 `/admin` index 라우트(App.tsx:171). `/admin/dashboard`는 `*` → `/admin` 리다이렉트라 URL 검증 영구 실패.

**수정** (`tests/e2e/T-20260525-foot-RESV-CANCEL-ANYDATE.spec.ts`):
- `BASE_URL`/`loginIfNeeded` 제거 → `import { loginAndWaitForDashboard } from '../helpers'` 사용 (storageState 재사용, desktop-chrome project의 `dependencies: ['setup']` + `storageState: AUTH_FILE` 경유).
- 모든 `page.goto` 절대 URL → 상대경로 (`/admin/reservations`, `/admin`) — config baseURL(8089) 적용.
- AC-3: `/admin/dashboard` → `/admin`, `toHaveURL(/dashboard/)` → `toHaveURL(/\/admin/)` + 대시보드 텍스트 visible 검증.

**재실행 결과** (2026-05-31, `npx playwright test ...--project=desktop-chrome`):
```
[setup] authenticate ✓ (962ms)
AC-1: 카드 전체 영역 우클릭 ✓ (4.7s)
AC-1: 이전 주 이동 후 취소 ✓ (5.2s)
AC-2: ReservationCancelModal ✓ (5.6s)
AC-3: 대시보드 영향 없음 ✓ (3.2s)
회귀: JS 에러 없음 ✓ (4.3s)
6 passed (36.6s)
```
빌드 `npm run build:verify` ✓ built in 3.33s.

**결론**: 프로덕션 코드 무변경(spec-only fix). status deploy-ready / qa_result pending 재갱신, supervisor 재QA 요청.
