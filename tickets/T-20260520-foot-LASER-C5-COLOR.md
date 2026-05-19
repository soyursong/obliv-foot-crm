---
id: T-20260520-foot-LASER-C5-COLOR
domain: foot
priority: P2
status: deploy-ready
title: 대시보드 치료실 C5 보라색 표기 — 공간배정 일관성
hotfix: false
created: 2026-05-20
deadline: 2026-05-25
deploy_ready: true
commit_sha: pending
db_changed: false
e2e_spec: tests/e2e/T-20260520-foot-LASER-C5-COLOR.spec.ts
build_passed: true
---

# 대시보드 치료실 C5 보라색 표기 — 공간배정 일관성

## 배경
- 공간배정(Staff.tsx): C5 치료실에 `border-2 border-purple-400` + "원장실" 라벨 표기
- 대시보드(Dashboard.tsx) RoomSlot: 동일 조건 미적용 → 보라색 없음
- 현장 요청: 두 화면의 C5 색상 일관성 확보

## 변경 내용
**파일**: `src/pages/Dashboard.tsx` — `RoomSlot` 컴포넌트

1. `isC5 = roomName === 'C5' && roomType === 'treatment'` 조건 추가
2. className에 `isC5 && !isOver && 'border-2 border-purple-400'` 추가
3. 룸 이름 옆에 "원장실" 라벨 표시 (`text-purple-600`)
4. Staff.tsx의 동일 조건과 exact match

## AC 완료
- [x] AC-1: 대시보드 C5 슬롯에 보라색 테두리 + "원장실" 라벨 표시
- [x] AC-2: 다른 칸(C1~C4, C6~C10, L1~L12) 영향 없음
- [x] AC-3: 공간배정(Staff.tsx)과 동일 조건 (`room.name === 'C5' && room.room_type === 'treatment'`)

## DB 변경
없음
