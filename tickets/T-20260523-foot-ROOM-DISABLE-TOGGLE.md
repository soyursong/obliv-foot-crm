---
id: T-20260523-foot-ROOM-DISABLE-TOGGLE
domain: foot
priority: P2
status: deployed
deploy_ready: true
deploy_ready_at: "2026-05-24 17:00 KST"
fix_commit: c7662bb
build_status: OK
build_time: 3.24s
db_change: true
db_migration: supabase/migrations/20260524010000_daily_room_status.sql
db_migration_down: supabase/migrations/20260524010000_daily_room_status.down.sql
e2e_spec: tests/e2e/T-20260523-foot-ROOM-DISABLE-TOGGLE.spec.ts
qa_result: pass
qa_grade: Yellow
deployed_at: "2026-05-24T04:06:16+09:00"
deploy_commit: 53ea0ebe942c86f2ac3747f57e7f579c12947fe1
bundle_hash: BnV8Af6e
field_soak_until: "2026-05-25T04:06:16+09:00"
---

# T-20260523-foot-ROOM-DISABLE-TOGGLE — 대시보드 슬롯 방별 비활성화 토글

## 요약

대시보드 슬롯 뷰에서 **상담실 / 치료실 / 레이저실** 각 방(room)마다 비활성화 토글을 제공한다. 특정 방 담당자 휴무 시 해당 방을 비활성화하면 대시보드에서 grayed-out / 숨김 처리되어 금일 출근자를 한눈에 파악할 수 있다.

## 구현 요약

### FE (Dashboard.tsx)
- `RoomSlot` 컴포넌트: `isInactive`, `canToggle`, `onToggle` props 추가
  - 비활성 시 `opacity-50 bg-gray-100/60 border-dashed border-gray-300` 적용
  - `data-inactive="true"` 어트리뷰트 → E2E 타게팅
  - "끄기" / "활성화" 토글 버튼 (admin/manager + 오늘만)
  - 비활성 방에 기존 환자 있을 시 `⚠️ {n}명` 경고 배지
- `RoomSection` 컴포넌트: `inactiveRooms`, `canToggle`, `onToggleRoom` props 추가
- `inactiveRooms` state (`Set<string>`) — 비활성 방 이름 집합
- `fetchInactiveRooms()` — Supabase daily_room_status 조회
- `handleToggleRoom()` — 낙관적 UI + upsert + 실패 시 롤백
- `canToggleRoom` — `isToday && (admin || manager)` (AC-6, AC-3)

### DB
- `daily_room_status` 테이블 신규 생성
  - `UNIQUE(clinic_id, date, room_name)` → upsert 안전
  - RLS: 읽기 = 승인 사용자 전체 / 쓰기 = admin/manager
  - 인덱스: `(clinic_id, date)`
- 마이그레이션: `20260524010000_daily_room_status.sql` (적용 완료)
- 롤백: `20260524010000_daily_room_status.down.sql`

## 수용 기준 충족 현황

| AC | 상태 | 구현 위치 |
|----|------|----------|
| AC-1 방 헤더 토글 버튼 | ✅ | RoomSlot canToggle + "끄기"/"활성화" 버튼 |
| AC-2 비활성 시 grayed-out | ✅ | opacity-50 + bg-gray-100/60 + data-inactive |
| AC-3 당일 한정 | ✅ | canToggleRoom = isToday && admin/manager |
| AC-4 기존 예약 경고 | ✅ | ⚠️{n}명 배지 + pointer-events-none (카드 삭제 X) |
| AC-5 DB 테이블 | ✅ | daily_room_status 마이그레이션 적용 완료 |
| AC-6 권한 제한 | ✅ | canToggleRoom profile role 검사 |
