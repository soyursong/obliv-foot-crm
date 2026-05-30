---
ticket_id: T-20260523-foot-LASER-TIMER
title: 비가열 레이저 타이머 보강 (amber/red 2단계 + 확인 다이얼로그)
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
build_passed: true
e2e_spec: tests/e2e/T-20260523-foot-LASER-TIMER.spec.ts
db_migration: null
regression_risk: low
reporter: 김주연 총괄 (U0ATDB587PV)
created_at: 2026-05-23
fix_applied_at: 2026-05-31
deployed_at: null
fix_request: FIX-20260531 phase2 browser_diag_fail(MSG-20260531-065613-nab0) — 진단 결과 코드 결함 아님(인증 미수행 diag). 인증 browser-diag 헬퍼 추가
---

# T-20260523-foot-LASER-TIMER — 비가열 레이저 타이머 보강

## 배경

T-20260522-foot-LASER-TIMER (deploy-ready) 위에 2개 AC 보강.
PR-20260522-183034-auto-3ef53 (6h+ stale → ESCALATE) 접수 → 당일 구현 완료.

## 수용기준

| # | AC | 상태 |
|---|-----|------|
| 1 | 치료메모 상단 [5분/15분/20분] 버튼 (기존 유지) | ✅ (T-20260522 구현) |
| 2 | ends_at 기준 카운트다운, 탭 비활성 대응 (기존 유지) | ✅ |
| 3 | **amber 깜빡임** (1분 이하 남음) → **red 긴급** (만료, 0:00) 2단계 분리 | ✅ |
| 4 | 종료 버튼 → **확인 다이얼로그** → 취소/종료 분기 | ✅ |
| 5 | Supabase Realtime 다기기 공유 (기존 유지) | ✅ |

## 아키텍처 backbriefing (planner 요청 AC-5)

### DB: timer_records 테이블 선택 이유

- **in-memory 기각**: 탭 간·기기 간 공유 불가. 새로고침 시 타이머 소실.
- **timer_records 채택**: `started_at`, `ends_at`, `stopped_at` 세 컬럼으로 서버 시각 앵커. 클라이언트 시계 편차 무관.
- 스키마: `supabase/migrations/20260522110000_timer_records.sql` (supervisor 리뷰 후 prod 적용)

### Realtime: postgres_changes 선택 이유

- **localStorage / BroadcastChannel 기각**: 동일 기기·동일 브라우저 간만 동작. 탭블릿 2대 이상 불가.
- **DB 폴링 기각**: 1–2초 지연 + DB 부하.
- **postgres_changes 채택**: INSERT(타이머 시작) / UPDATE(stopped_at 세팅) 이벤트 즉시 수신. 채널 `timer_records_rt_{clinic_id}` — 클리닉 격리.

### 신호 흐름

```
치료사(기기 A)          Supabase          대시보드(기기 B)
   [5분] 클릭  ──────→ timer_records INSERT ─→ Realtime 구독 수신
                                               └→ activeTimersMap 갱신
   [종료] 클릭  ─────→ timer_records UPDATE ─→ Realtime 수신
   (확인 다이얼로그)     (stopped_at 세팅)      └→ 맵에서 제거 → 깜빡임 중단
```

## 구현 변경 내역

### index.css

- `laser-timer-warn` 추가: amber (#f59e0b) 깜빡임 0.9s — 1분 경고
- `laser-timer-expire` 추가: red (#ef4444) 긴급 깜빡임 0.55s — 만료
- `laser-timer-blink` / `laser-timer-alert` 유지 (T-20260522 legacy 호환)

### Dashboard.tsx

- `TimerExpiredCtx` context 신규 추가 (`Set<string>`)
- `timerAlertSet` / `timerExpiredSet` 분리 계산:
  - `remaining ≤ 0` → `timerExpiredSet` (red)
  - `0 < remaining ≤ 60000` → `timerAlertSet` (amber)
- `DraggableCard` (compact + non-compact): `laser-timer-expire` > `laser-timer-warn` 우선 적용
- `TimerExpiredCtx.Provider` JSX 추가

### MedicalChartPanel.tsx

- `stopConfirmOpen` state 추가
- stop 버튼 onClick: `handleStopTimer()` → `setStopConfirmOpen(true)`
- 인라인 확인 박스 (`laser-timer-stop-confirm`): 취소/종료 버튼
- `handleStopTimer`: `setStopConfirmOpen(false)` 먼저 호출
- Drawer 닫힐 때 `stopConfirmOpen` 리셋

## 빌드 결과

```
✓ tsc -b 통과 (error 0)
✓ vite build 3.14s
```

## 회귀 리스크

- DB 변경 없음 (기존 timer_records 테이블 재사용)
- 기존 `laser-timer-blink` CSS 호환 유지
- `TimerAlertCtx` 의미 변경 없음 (amber only — 구독하던 컴포넌트 없음, 신규 추가)

## FIX-20260531 — phase2 browser_diag_fail 대응 (MSG-20260531-065613-nab0)

### 진단: 코드 결함 아님 — 인증 미수행 진단 artifact

- supervisor 첨부 스크린샷(`foot_laser_timer_dashboard_20260531_065551.png`)이 **로그인 화면**.
  `/admin` 은 `ProtectedRoute`(인증 게이트) 뒤 → 세션 없이 진입 시 `<Navigate to="/login">` 로
  리다이렉트되어 "대시보드" 텍스트가 영구 미노출. 곧 phase2 diag 가 인증 세션 없이 `/admin` 직행.
- 동일 사고 3회차: T-20260529-foot-CHECKIN-BTN-REMOVE(5/30), T-20260522-foot-PKG-BOX-INDICATOR(5/31).

### 검증 증거

- `npm run build` ✓ 3.25s (error 0)
- E2E `tests/e2e/T-20260523-foot-LASER-TIMER.spec.ts` — **6/6 PASS** (auth.setup + S-0~S-4, skip 0)
- **인증 browser-diag (운영 번들 대상) PASS**: `node --env-file=.env scripts/browser_diag_admin.mjs`
  → `https://obliv-foot-crm.vercel.app/admin` 에서 "대시보드" 렌더 확인(스크린샷 첨부). 기능/배포 정상.

### 추가 산출 (재발 방지)

- `scripts/browser_diag_admin.mjs` — Supabase SDK 로그인 → localStorage 세션 주입 → `/admin` 진입 →
  "대시보드" 가시성 확인 + 스크린샷. supervisor 가 `/admin` 게이트 기능 진단 시 인증 전제를
  결정적으로 충족시켜 false browser_diag_fail 차단. TARGET_URL/DIAG_PATH/EXPECT_TEXT 로 범용 사용.

### 권고

- `/admin` 게이트 기능의 phase2 browser_diag 는 **인증 세션 주입 후** 수행 필수
  (storageState `.auth/user.json` 또는 본 스크립트 또는 UI 로그인 test@medibuilder.com / TestPass2026!).
- selector 는 사이드바 nav 라벨 "대시보드"(active) 또는 E2E data-testid 사용 권장.

- 코드/DB 변경 없음 (진단 + QA 헬퍼 스크립트 추가만). deploy-ready 유지.
