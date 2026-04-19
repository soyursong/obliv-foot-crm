# Round 5 — 잔여 미처리 항목 정리

- [x] 대기열 30분+ 하이라이트: isLongWait 조건 → bg-red-50 border-red-200 (compact/non-compact 모두)
- [x] 시술사 내 방 필터: selectedRoom state + localStorage, 선택 외 방 opacity-30, 방 번호 선택 UI
- [x] 일마감 자동 대사: actualTotal > 0일 때 difference === 0이면 ✅, 아니면 ❌ 표시
- [x] 드래그 힌트: GripVertical (lucide-react) 아이콘 추가, text-muted-foreground/30
- [x] 대기번호 동시성: next_queue_number_safe RPC 미존재 확인 → 기존 next_queue_number 유지
- [x] 태블릿 시술실 잘림: grid-cols-3 이미 적용 확인, w-32 각 룸 — 3×5 fit OK
- [x] 모바일 대시보드: 사이드바 hidden md:flex + 토글 FAB, 칸반 flex-col md:flex-row, 컬럼 w-full md:w-40
- [x] 자동 배정 버튼 제거: 대기→상담, 시술대기→시술 선입선출 버튼 삭제 (드래그 직접 배정)
- [x] 상태 변경 버튼 강조: 파랑(상담)/노랑(시술대기)/초록(시술)/보라(결제대기)/accent(결제)
- [x] 상담실/시술실 선생님 이름 표시 확인: 이미 구현됨 (room_assignments + staff 데이터)
- [x] 방 최대 인원 2명 유지: maxPerRoom = 2 체크 이미 구현됨 (handleDragEnd line 505)
- [x] 대기/시술대기 컬럼 내 순서 변경: 이미 구현됨 — useDraggable + overCard 감지로 같은 컬럼 내 드롭 시 sort_order 재정렬 (lines 512-538)
- [x] npx vite build + git commit + push — 8594afe, 7e3c6e0 pushed
- [x] Write summary to .dispatch/tasks/round5-cleanup/output.md
