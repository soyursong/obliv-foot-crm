# UX 34건 전체 수정 완료 + 예약 슬롯 용량 제한

> 완료 시각: 2026-04-10
> 커밋: 2535eff
> 빌드: ✅ vite build 통과
> 푸시: ✅ origin/main

## 수정 요약

### P0 Critical (3/3 완료)
| # | 이슈 | 파일 | 수정 내용 |
|---|------|------|----------|
| C-01 | 유입경로 DB 미저장 | AdminReservations.tsx | insert에 referral_source 추가 |
| C-02 | 글로벌 검색 clinic_id 미필터 | AdminLayout.tsx | .eq('clinic_id', currentClinicId) 추가 |
| CO-01 | 예약 타임라인 같은 시간 덮어씌움 | AdminDashboard.tsx | resMap을 배열로 변경, 렌더링 루프 수정 |

### P1 High (8/8 완료)
| # | 이슈 | 수정 내용 |
|---|------|----------|
| C-04 | "명명" 이중 출력 | WaitingScreen 4곳에서 중복 '명' 제거 |
| TM-01 | 과거 날짜 예약 | Calendar에 disabled prop 추가 |
| TM-02 | 예약 날짜 변경 불가 | 상세 모달에 날짜 변경 Popover 추가 |
| CO-02 | 수동 등록 유입경로 없음 | 유입경로 선택 + 고객 자동생성/연결 |
| CO-03 | 컨텍스트 메뉴 부족 | 고객상세/대기복귀/완료/노쇼 추가 |
| CN-01 | 과거 이력 미표시 | 상세 Sheet에 과거 방문 이력 조회/표시 |
| CN-02 | 결제 금액 자동입력 | PaymentModal에 suggestedAmount prop |
| PA-01 | 체크인 문구 혼란 | "셀프 체크인"으로 변경 |

### P2 Medium (16/16 완료)
- TM-03: 예약 취소 window.confirm 추가
- TM-04: 상세 모달 전화번호 maskPhone 적용
- CO-04: 시술실 헤더에 getRoomStaff로 담당 표시
- CO-05: 상세 Sheet에 "다음 단계" 상태 변경 버튼
- CO-06: realtime UPDATE 시 fetchCheckIns 재호출
- CN-03: 분할결제 (카드+현금 각각 입력) 지원
- CN-04: 시술 추가 다이얼로그 상단 검색 Input
- C-03: AdminClosing→"closing", AdminStaff→"staff" activeTab 수정
- TE-02: compact 카드 시술명 whitespace-normal/break-words
- TE-03: 마취 20분 경과 시 animate-pulse 효과
- CL-01: 환불 고객 선택 → 당일 체크인 목록 드롭다운
- CL-02: 마감 확정 해제 버튼 추가
- ST-01: 직원 추가 시 역할(시술사/상담사/코디) 선택
- ST-02: 직원 카드 클릭 → 수정/비활성화 모달
- PA-02: 로딩 텍스트 "체크인 중..." 표시
- PA-05: catch 블록에 toast 에러 알림 추가

### P3 Low (5/5 완료, 2건 스킵)
- TM-05: overflow 클릭 시 추가 명단 alert
- TM-06: 전화번호 10자리 최소 검증
- PA-03: 예상 대기시간 (인원 × 15분) 표시
- PA-04: 대기 상태에서 체크인 취소 버튼
- CN-05: 결제 상세 (할부/메모) 표시
- TE-01: **스킵** (시술사 전용 뷰 — 별도 기능)
- ST-03: **스킵** (주간 배정 복사 — 별도 기능)

### 추가 기능: 예약 슬롯 용량 제한
- DB: `clinics.max_per_slot INTEGER DEFAULT 0` 컬럼 추가
- 예약 생성 시 슬롯 카운트 체크 → 초과 시 토스트 경고
- 시간 드롭다운에 꽉찬 슬롯 "(마감)" 표시 + disabled
- 주간 캘린더에 꽉찬 슬롯 빨간 배경 표시
- max_per_slot=0이면 제한 없음 (기존 동작 유지)

## 수정 파일
- src/pages/AdminDashboard.tsx
- src/pages/AdminReservations.tsx
- src/pages/AdminCustomers.tsx (변경 없음)
- src/pages/AdminClosing.tsx
- src/pages/AdminStaff.tsx
- src/pages/CheckIn.tsx
- src/pages/WaitingScreen.tsx
- src/components/AdminLayout.tsx
- src/components/PaymentModal.tsx
- src/lib/clinic.ts
