# Round 2 수정 완료 — 2026-04-10

## 보안 (CRITICAL)

### RLS 정책 수정
- `public_select_customers` 제거 → 익명 고객 DB 접근 차단
- `public_select_reservations`, `public_update_reservations` 제거
- `check_ins public_insert`에 clinic_id 존재 확인 추가
- RPC 함수 4개 생성:
  - `find_customer_by_phone(p_clinic_id, p_phone)` — 셀프 체크인 시 고객 조회
  - `match_reservation_for_checkin(p_customer_id, p_date)` — 예약 매칭+상태 변경 atomic
  - `get_checkin_data(p_check_in_id)` — 대기화면 데이터 조회
  - `get_queue_summary(p_clinic_id, p_queue_number)` — 대기 통계 (PII 없음)
  - `ose_query(query_text)` — DB 조회용 헬퍼
- CheckIn.tsx: 직접 테이블 접근 → RPC 전환

### 입력 보안
- 검색 입력 sanitize: `%_(),.` 특수문자 제거 (AdminLayout, AdminCustomers)

### DB 인덱스 (10개)
- `idx_check_ins_clinic_date`, `idx_check_ins_customer`
- `idx_reservations_clinic_date`, `idx_reservations_customer_date`
- `idx_payments_check_in`, `idx_payments_customer`
- `idx_check_in_services_check_in`
- `idx_staff_clinic_active`, `idx_services_clinic_active`, `idx_notifications_check_in`

## UIUX 수정

### 시각적 일관성
- 로그인 버튼: `bg-primary` → `bg-accent` (브랜드 색상 통일)
- label-input htmlFor 연결 (AdminLogin)
- NotFound 페이지 한국어화

### 정보 계층
- 상태 라벨 한국어화: AdminLayout, AdminCustomers, AdminHistory에서 영문 raw값 → 한국어 뱃지
- `status-colors.ts` 생성: STATUS_COLORS, STATUS_KO 중앙 관리
- AdminHistory STATUS_BADGE → 중앙 status-colors 사용
- nav 버튼 active 상태 하이라이트 (bg-accent)

### 색상
- `--status-treatment-waiting` CSS 변수 추가 (노란색)
- `.status-treatment-waiting` 유틸리티 클래스 추가
- green/emerald 혼용 → green 통일

### 모바일
- 국번 select: `w-[110px]` → `w-[120px]`, `text-sm` → `text-base`
- 체크인 취소 버튼: `text-xs` → `text-sm min-h-[44px]` (Apple HIG 터치 타겟)
- 방문경로 라벨에 필수 마크 `*` 추가
- 호출 알림 확인 버튼: 반투명 → 불투명 흰색 (대비 개선)

### 대시보드
- 예약 사이드바: `w-44` → `w-56` (정보 가독성 개선)
- 빈 시술실: 축소 (`w-20 opacity-50`)
- 드롭존 강조: `ring-accent bg-accent/15 scale-[1.02] shadow-md`
- DragOverlay: `border-2 border-accent rotate-2 opacity-90`
- 마취 pulse 애니메이션 → 정적 `bg-green-50 rounded` 강조
- 컨텍스트 메뉴 위치: 화면 경계 보정

### 인터랙션
- 토스트 위치: bottom-right → `top-right`, duration 3초
- 빈 상태 CTA: AdminCustomers에 "첫 고객 등록하기" 버튼
- 로딩 스피너: CheckIn, WaitingScreen, AdminCustomers

## 프론트엔드

### 검색 디바운스
- AdminLayout: setTimeout 300ms + sanitize
- AdminCustomers: debounced search state + sanitize

### 에러 처리
- AdminReservations: 예약 등록 실패 시 에러 토스트
- AdminClosing: 마감 저장 실패 시 에러 토스트
- AdminStaff: 직원 등록 실패 시 에러 토스트
- AdminLayout: 고객 수정 실패 시 에러 토스트

## 신규 기능

### 결제대기 컬럼
- `payment_waiting` 상태 추가 (i18n, status-colors, CSS)
- 칸반에 시술실과 완료 사이에 결제대기 컬럼 (보라색 테마)
- 플로우: 시술 → 결제대기 → 결제 처리 → 완료
- 선결제 고객: 시술 → 바로 완료 (결제대기 건너뛰기)
- 상세 시트에 "결제 처리" 버튼 추가

### 상담실 2인 배치
- maxPerRoom: 1 → 2 (상담실도 시술실과 동일)
- 상담실 getRoomOccupant → getRoomOccupants 전환
- 2인 표시 UI (`N/2` 카운터)

### 노쇼 처리 개선
- 사이드바: 노쇼 예약에 취소선 + 투명도 적용
- "복원" 버튼: 노쇼 → reserved로 되돌리기
- 칸반 컨텍스트 메뉴: 이미 노쇼인 경우 노쇼 버튼 숨김

### 방 이름 설정
- `clinics.room_names` JSONB 컬럼 추가
- Clinic 인터페이스 확장 (`room_names: Record<string, string> | null`)
- 대시보드: `c1`/`t1` 키로 커스텀 방명 표시 (미설정 시 기본값)

## 커밋
- `48701e5` — `fix: Round 2 — security + UIUX + frontend improvements`
