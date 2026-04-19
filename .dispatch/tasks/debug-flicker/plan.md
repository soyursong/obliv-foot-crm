# 전반적 디버그 — 번쩍거림 + 안정성

- [x] 예약관리 번쩍거림 근본 수정: useRef로 이전 JSON 비교, 데이터 변경 시에만 setState
- [x] 예약관리 stats (예약/워크인/매출) 번쩍거림: useMemo로 감싸 불필요한 재계산 방지
- [x] 대시보드 Realtime 번쩍거림: fetchCheckIns, fetchTodayReservations에 useRef JSON 비교 적용
- [x] 휴무일 표시 깜빡임: schedulesLoaded 가드 확인 — clinicId 1회만 fetch, 리셋 없음 (정상)
- [x] 전 페이지 초기 로딩 시 빈 화면: Suspense LoadingSpinner 이미 있고, useRef로 데이터 전환 중 이전값 유지됨
- [x] 직원 계정 관리 기능 구현: /admin/register 페이지 생성, admin만 접근, 계정 생성+역할 관리+활성화/비활성화
- [x] 회원가입 수락: approved 컬럼 추가, 자체가입은 approved=false, 관리자 생성은 auto-approved, 로그인 시 미승인 차단, 승인/거부 UI 구현
- [x] npx vite build + git commit + push — ec19a01
- [x] Write summary to .dispatch/tasks/debug-flicker/output.md
