# Round 6 완료 보고

**커밋**: e631246 `fix: Round 6 — 담당자 기록, TM메모, P1/P2 반영`
**파일 변경**: AdminDashboard.tsx, AdminCustomers.tsx, AdminClosing.tsx (3파일, +132/-21)

## 누락 수정 (4건)

| 항목 | 내용 |
|------|------|
| technician_id | updateStatus에서 treatment + finalRoom 시 room_assignments 조회 → staff_id 저장 |
| created_by | 수동등록/예약체크인 시 session.user.email 저장 |
| 담당 섹션 | 상세 패널에 TM(created_by), 상담(consultant→staff.name), 시술(technician→staff.name) 표시 |
| TM 메모 | AdminCustomers 상세에 주황 Textarea + 저장 버튼 추가 |

## P1 (6건 — 5건 기존 확인, 1건 신규)

| 항목 | 상태 |
|------|------|
| 과거 날짜 읽기전용 | 신규 — DnD 비활성, 수동등록/상태변경 숨김, "읽기 전용" 배너 |
| 사이드바 accordion | 기존 확인 |
| 빈 시술실 추천 | 기존 확인 |
| 노쇼 뱃지 | 기존 확인 |
| 예약 날짜 변경 | 기존 확인 |
| 셀프체크인 메시지 | 기존 확인 |

## P2 (4건)

| 항목 | 내용 |
|------|------|
| 리콜 필터 | AdminCustomers에 "리콜 대상만" 토글 버튼 (60일+ 미방문) |
| 미결제→대시보드 | AdminClosing 미결제 배너에 고객별 클릭 → /admin/dashboard 이동 |
| 사이드바 자동접힘 | 30초마다 현재 시간대로 자동 이동 (지난 시간 접힘) |
| 예상 종료시간 | 시술실 카드에 notes 파싱 + service duration_min 기반 "~HH:MM 종료 예정" 표시 |
