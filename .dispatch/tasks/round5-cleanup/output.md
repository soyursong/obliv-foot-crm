# Round 5 완료 요약

## 변경 커밋
- `8594afe` feat: Round 5 — 30분 하이라이트, 시술실 필터, 일마감 대사, 드래그 그립, 모바일 대응
- `7e3c6e0` feat: Round 5 추가 — 자동배정 제거, 상태 버튼 색상 강조

## 변경 파일
- `src/pages/AdminDashboard.tsx` — 주요 변경
- `src/pages/AdminClosing.tsx` — 일마감 대사 표시

## 구현 상세

### 신규 구현
1. **30분+ 하이라이트**: 대기/시술대기 상태에서 checked_in_at 기준 30분 경과 시 카드에 `bg-red-50 border-red-200` 적용
2. **시술실 내 방 필터**: "내 방" 토글 + 방 번호 선택 UI, `localStorage` 저장, 비선택 방 `opacity-30`
3. **일마감 ✅/❌**: 실제 수납액 입력 시 시스템 합계와 비교하여 일치(✅)/불일치(❌) 아이콘 표시
4. **드래그 그립**: `GripVertical` (lucide-react) 아이콘을 카드 좌측에 배치 (compact: h-3, non-compact: h-4)
5. **모바일 대응**: 768px 이하에서 사이드바 숨김 + FAB 토글 버튼, 칸반 세로 스택, 컬럼 전체 너비
6. **자동 배정 버튼 제거**: 선입선출 버튼 삭제 → 드래그로 직접 배정
7. **상태 버튼 색상**: 대기→상담(파랑), 상담→시술대기(노랑), 시술대기→시술(초록), 시술→결제대기(보라), 결제대기→결제(accent)

### 확인 완료 (변경 불필요)
- `next_queue_number_safe` RPC: 미존재 → 기존 `next_queue_number` 유지
- 태블릿 `grid-cols-3`: 이미 적용 완료
- 상담실/시술실 선생님 이름: `room_assignments + staff` 로 이미 표시
- 방 최대 인원 2명: `maxPerRoom = 2` 이미 구현
- 같은 컬럼 내 순서 변경: `overCard` 감지 + `sort_order` DB 저장 이미 구현
