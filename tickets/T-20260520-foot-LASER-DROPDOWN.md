---
id: T-20260520-foot-LASER-DROPDOWN
domain: foot
priority: P1
status: deploy-ready
title: 레이저실 장비명 드롭다운 regression 복구
hotfix: false
created: 2026-05-20
deadline: 2026-05-22
deploy_ready: true
commit_sha: e3f9578ee6eaf5389cc27c440c54766fdeb0c633
db_changed: false
e2e_spec: tests/e2e/T-20260520-foot-LASER-DROPDOWN.spec.ts
build_passed: true
---

# 레이저실 장비명 드롭다운 regression 복구

## 배경
레이저실 장비명 드롭다운이 사라진 regression 수정.

## Regression 원인
- `RoomSlot.showStaffDropdown` 조건에 `roomType === 'laser'` 미포함
- `laser_rooms` RoomSection에 `therapists` / `onTherapistChange` props 미전달

## 변경 내용
- `RoomSlot.showStaffDropdown`: `laser` 조건 추가 (AC-1)
- `RoomSlot` placeholder: laser일 때 "장비 선택" 표시 (AC-4)
- `handleLaserTechChange`: `room_type='laser'`로 DB 저장 핸들러 추가
- `laser_rooms` RoomSection: `therapists(technician only)` + `onTherapistChange` 전달 (AC-2/AC-3)

## AC 완료
- [x] AC-1: 드롭다운 노출
- [x] AC-2: 선택 반영 (DB 저장)
- [x] AC-3: 기존 데이터 표시
- [x] AC-4: regression 원인 커밋 특정 + placeholder "장비 선택"
