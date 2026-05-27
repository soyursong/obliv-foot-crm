---
id: T-20260522-foot-TABLET-DUAL-LAYOUT
status: deploy-ready
deploy_ready: true
build_ok: true
db_migration: false
e2e_spec: tests/e2e/T-20260522-foot-TABLET-DUAL-LAYOUT.spec.ts
summary: "SM-X400 태블릿 가로/세로 이중 레이아웃 최적화 Phase 1 (대시보드). useOrientation 훅 + portrait 타임라인 자동 fold + landscape 터치 최적화 CSS."
qa_result: pass
qa_grade: Green
deployed_at: "2026-05-22T05:19:42+09:00"
deploy_commit: ec5dfb6f09071c25e695a78e97ed9e767c51ee31
bundle_hash: DEXomt-X
field_soak_until: "2026-05-23T05:19:42+09:00"
field_validation_slack_ts: "1779394877.098519"
fix_request: MSG-20260527-184913-04r5
fix_applied: "2026-05-27T19:20:00+09:00"
fix_summary: "playwright.config.ts unit testMatch에 TABLET-DUAL-LAYOUT 추가 — 정적 스펙 auth.setup 의존 제거. --project=unit 17/17 pass, --project=desktop-chrome 18/18 pass(setup+17 TC). VITE_DISABLE_AUTH_LOCK=1 webServer.env 주입 확인."
---

# T-20260522-foot-TABLET-DUAL-LAYOUT: 태블릿 가로/세로 이중 레이아웃 (Phase 1 대시보드)

## AC 체크리스트

- [x] AC-1: landscape → PC레이아웃 기반 터치최적화 (`@media (orientation:landscape) and (pointer:coarse)` — 44px 터치 타겟)
- [x] AC-2: portrait → 사이드바 자동 최소화 + 차트영역 최대화 (useOrientation + setTimelineFolded(true) + AdminLayout useEffect)
- [x] AC-3: orientation 전환 시 작성 중 데이터 유지 (rows/payments/formData 등 건드리지 않음, fold state만 조정)
- [x] AC-4: Phase 1 대시보드 양 모드 정상 렌더링 (data-orientation 속성, E2E spec 정적 검증)
- [x] AC-5: 빌드 에러 없음 + 기존 E2E 깨짐 없음

## 구현 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/hooks/useOrientation.ts` | 신규 — matchMedia 기반 orientation 훅 |
| `src/pages/Dashboard.tsx` | useOrientation 사용 + portrait 자동 fold useEffect + data 속성 |
| `src/components/AdminLayout.tsx` | orientation 훅 + portrait 사이드바 자동 최소화 + data-sidebar-nav |
| `src/index.css` | landscape+coarse 터치 타겟 44px CSS + portrait 타임라인 fallback |

## 기술 노트

- `useOrientation()`: `window.matchMedia('(orientation: landscape)')` 기반, SSR-safe
- portrait 진입 시 `setTimelineFolded(true)` → 칸반 영역 최대화
- landscape 복귀 시 localStorage 값 복원 → 사용자 수동 설정 보존 (AC-3)
- AdminLayout portrait 자동 최소화: `window.innerWidth >= 1024` 조건 (SM-X400 portrait ~800px은 desktop sidebar가 `hidden lg:flex`로 이미 숨겨지므로 무해)
- CSS 터치 타겟: `data-dashboard-header` / `data-sidebar-nav` 속성 타겟 — 다른 페이지에 영향 없음
- CSS portrait fallback (`max-width: 2rem`): JS fold보다 약간 늦는 경우 시각 보완용

## 선행 티켓

- T-20260515-foot-RESPONSIVE-UI-SHELL (deployed, commit ade2a6b)
- T-20260522-foot-TIMETABLE-FOLD (deployed — timelineFolded 기반 재사용)

## deadline

2026-06-05

## supervisor QA 결과 (2026-05-22)

| 항목 | 결과 | 비고 |
|------|------|------|
| Phase 1 빌드 | ✅ PASS | npm run build 3.21s exit 0 |
| 기존 기능 영향 | ✅ PASS | FE-only CSS/layout, 비즈로직 미변경 |
| DB 호환성 | ✅ N/A | db_changed: false |
| 권한/RLS | ✅ N/A | FE only |
| 롤백 SQL | ✅ N/A | FE only, no DB |
| Phase 1.5 env 매트릭스 | ✅ PASS | VITE_SUPABASE_URL/ANON_KEY 운영 bundle 매치 확인 |
| Runtime Safety Gate | ✅ PASS | 신규 코드: matchMedia/localStorage/state setter만 사용 — 직접 nullable 접근 없음 |
| E2E spec | ✅ 18/18 PASS | T-20260522-foot-TABLET-DUAL-LAYOUT.spec.ts (8.1s) |
| 브라우저 시뮬레이션 | ✅ PASS | 운영 URL 정상 로드 (로그인 화면 렌더, white-screen 없음) |
| Cross-CRM Contract | ✅ N/A | db_changed: false |

**판정: GO — Green**
- origin/main `ec5dfb6` 포함 배포 완료 (Vercel 자동 배포, 운영 bundle `index-CEKBe316.js` 확인)

## re-QA 재검증 (2026-05-23)

field_soak_until 경과(05:19) 후 재검증 요청. 전항목 재확인.

| 항목 | 결과 | 비고 |
|------|------|------|
| 빌드 | ✅ PASS | npm run build 3.25s exit 0 |
| Phase 1.5 env 매트릭스 | ✅ PASS | 운영 bundle `index-DEXomt-X.js` — `https://rxlomoozakkjesdqjtvd.supabase.co` 매치 확인 |
| Runtime Safety Gate | ✅ PASS | useOrientation/Dashboard/AdminLayout 신규 코드 null-access 없음 |
| E2E 18/18 | ✅ PASS | 8.4s — 기존 spec 회귀 없음 |
| 브라우저 시뮬레이션 | ✅ PASS | 운영 URL 정상 로드 (로그인 화면 렌더, white-screen 없음, auth 리다이렉트 정상) |
| Cross-CRM Contract | ✅ N/A | db_changed: false |

**재판정: GO — Green 유지**
- 운영 bundle `DEXomt-X` (이후 타 티켓 커밋으로 해시 갱신, orientation 코드 포함 확인)
- field_soak 경과 17h. 🔴 반응 없음. 48h 자동 done 대기 (2026-05-24T05:19:42+09:00)
