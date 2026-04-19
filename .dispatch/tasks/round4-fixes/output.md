# Round 4 실행 결과

## DB 변경
- `check_ins.consultant_id` UUID 컬럼 추가 (staff FK)
- `services.duration_min` INT 컬럼 추가 (기본값 30)

## 파일 변경 (6개)

### AdminStaff.tsx
- 상담실 배정 그리드 추가 (room_type='consultation', 시술실과 동일 구조)
- 상담실장별 월매출 섹션 추가 (consultant_id 기준 집계)
- 배정 모달에 type 구분 (treatment/consultation)

### AdminDashboard.tsx
- **날짜 네비게이터**: ◀ [오늘] ▶ 과거/미래 일자 전환
- **사이드바 아코디언**: 시간대별 접이식 (현재 시간 자동 펼침)
- **지연 뱃지**: 예약+30분 경과 미체크인에 빨간 "지연"
- **노쇼 뱃지**: 🔴N 실시간 집계
- **빈 시술실**: 연한 초록 하이라이트 + 추천 표시
- **결제대기 배너**: 보라색 상단 배너 + 클릭 스크롤
- **결제대기 카드**: 선결제 금액 표시
- **consultant_id**: 상담실 드래그 시 자동 기록
- **마취 자동**: 시술대기 이동 시 anesthesia_at 자동 설정
- **예약 메모 fallback**: check_in_services 없으면 reservation memo 표시
- **과거 시술 추가**: "같은 시술 추가" 원클릭 버튼
- **다중 결제**: 선결제+잔금 합산, 잔금 표시, 추가 결제 버튼
- **수동등록**: 010 자동입력 + 하이픈 포맷

### AdminReservations.tsx
- **시술 소요시간**: "(30분/50만)" 표시
- **고객 검색 원스텝**: 결과 없음 → 인라인 신규 등록
- **노쇼 뱃지**: 예약 그리드에 🔴N 표시
- **과거 시간 비활성**: 오늘이면 지난 슬롯 disabled
- **고객명 클릭**: 고객 상세 페이지 이동

### AdminCustomers.tsx
- URL ?q= 파라미터로 검색어 자동 설정

### WaitingScreen.tsx
- 예약 매칭 피드백: "XX:XX 예약이 확인되었습니다"

### PaymentModal.tsx
- 시술 미선택 시 안내 메시지
- 시술 내역 표시

## 커밋
- a6b32df: 체크인→대기 즉시 반영 + 전체 Round 4 변경
- 5da18bc: 결제대기 선결제 표시, 다중 결제 지원
- c015fe4: 대시보드 날짜 네비게이터
