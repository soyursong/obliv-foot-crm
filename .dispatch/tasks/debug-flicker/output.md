# 완료 요약 — 번쩍거림 수정 + 계정 관리

## 번쩍거림(Flicker) 수정

### 예약관리 (AdminReservations.tsx)
- `fetchWeekData`: useRef로 이전 데이터 JSON을 캐시, 동일 데이터면 setState 스킵
- 주간 stats (weekReserved/weekWalkins/weekRevenue): useMemo로 감싸 불필요한 재계산 방지
- 대상: reservations, checkIns, payments, noShowCounts 4개 상태

### 대시보드 (AdminDashboard.tsx)
- `fetchCheckIns`: checkIns, dayPayments, cardServices 3개 상태에 useRef 비교 적용
- `fetchTodayReservations`: todayReservations에 useRef 비교 적용
- Realtime INSERT는 기존 optimistic update 유지 (즉시 반영 필요), UPDATE 시에만 full refetch

### 휴무일 표시
- schedulesLoaded 가드 정상 작동 확인 — clinicId 변경 시 1회만 fetch, 리셋 없음

## 직원 계정 관리 시스템

### /admin/register (AdminRegister.tsx) — 신규
- admin 역할만 접근 가능
- 직원 계정 생성: 이름/이메일/비밀번호/역할 (admin/manager/coordinator/tm/viewer)
- 관리자 생성 계정은 즉시 승인 (approved=true)
- 승인 대기 섹션: 자체 가입 계정 승인/거부 UI
- 기존 계정: 역할 변경, 활성화/비활성화

### 회원가입 승인 (AdminLogin.tsx)
- user_profiles.approved 컬럼 추가 (DEFAULT false)
- 자체 가입 시 approved=false로 저장
- 로그인 시 미승인 계정 차단: "관리자 승인 대기 중" 메시지
- admin 역할은 승인 없이 로그인 가능

### AdminLayout
- "계정관리" 버튼 추가 → /admin/register 링크

## 커밋
- ec19a01 — `fix: 번쩍거림 근본 수정 + 직원 계정 관리 시스템`
