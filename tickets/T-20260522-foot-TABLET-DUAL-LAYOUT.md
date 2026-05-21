---
id: T-20260522-foot-TABLET-DUAL-LAYOUT
status: deploy-ready
deploy_ready: true
build_ok: true
db_migration: false
e2e_spec: tests/e2e/T-20260522-foot-TABLET-DUAL-LAYOUT.spec.ts
summary: "SM-X400 태블릿 가로/세로 이중 레이아웃 최적화 Phase 1 (대시보드). useOrientation 훅 + portrait 타임라인 자동 fold + landscape 터치 최적화 CSS."
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
