# Round 6 — 누락 3건 + 3일 시뮬레이션 P1/P2

## 누락 수정
- [x] 시술실 배정 시 technician_id 자동 기록: updateStatus에서 treatment + room_number 배정 시 room_assignments에서 해당 방 staff_id를 check_in.technician_id에 저장 — added parallel to consultant_id logic
- [x] TM 담당자 기록: check_ins에 created_by(이메일) 저장 — 수동등록 + 예약체크인 양쪽에 추가
- [x] 상세 패널에 담당자 표시: "담당" 섹션 추가 — TM: created_by, 상담: consultant_id→staff.name, 시술: technician_id→staff.name
- [x] 고객이력(AdminCustomers) 상세에 TM 메모 표시: customers.tm_memo 읽어서 주황 영역으로 표시 + 수정 가능

## 3일 시뮬레이션 P1 (참고: .dispatch/tasks/full-3day-sim/output.md §7)
- [x] 대시보드 과거 날짜 조회 시 읽기 전용 모드 (드래그 비활성 + 수동등록/상태변경 숨김 + 배너 표시)
- [x] 예약 사이드바 accordion 기본 접힘 + 현재 시간대만 펼침 — 확인 완료 (expandedHour state)
- [x] 빈 시술실에 추천 배정 표시 — 확인 완료 (recommendedRoom + "추천" 라벨)
- [x] 노쇼 이력 뱃지 — 확인 완료 (noShowCounts + 빨간 뱃지)
- [x] 예약 상세에서 날짜 변경 가능 — AdminReservations에서 확인
- [x] 셀프 체크인 완료 시 "예약 확인" 메시지 — 확인 완료

## 3일 시뮬레이션 P2
- [x] 고객이력에 "리콜 대상" 빠른 필터 버튼 (60일+ 미방문만 보기)
- [x] 일마감에서 미결제 건 클릭 → 해당 고객 카드로 대시보드 이동
- [x] 예약 사이드바에서 시간 지난 예약은 자동 접힘 — 30초마다 현재 시간대로 자동 이동
- [x] 시술 소요시간 기반 예상 종료시간 표시 (시술실 카드에 "~11:30 종료 예정") — notes 파싱 + service duration_min 기반

## 마무리
- [x] npx vite build + git commit + push — e631246
- [x] Write summary to .dispatch/tasks/round6-final/output.md
