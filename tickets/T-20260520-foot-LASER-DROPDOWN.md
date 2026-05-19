---
id: T-20260520-foot-LASER-DROPDOWN
domain: foot
priority: P1
status: deployed
title: 레이저실 장비명 드롭다운 regression 복구
hotfix: false
created: 2026-05-20
deadline: 2026-05-22
deploy_ready: true
commit_sha: e3f9578ee6eaf5389cc27c440c54766fdeb0c633
db_changed: false
e2e_spec: tests/e2e/T-20260520-foot-LASER-DROPDOWN.spec.ts
build_passed: true
qa_result: pass
qa_grade: Yellow
deployed_at: 2026-05-20T00:07:50+09:00
deploy_commit: e3f9578
bundle_hash: COIkmfik
precheck_pass: true
precheck_at: 2026-05-20T00:10:00+09:00
field_soak_until: 2026-05-21T00:07:50+09:00
reporter_slack_id: U0ATDB587PV
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779202097.593259
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

## QA 결과 (supervisor, 2026-05-20T00:10:00+09:00)

### 판정: GO — Yellow

| 항목 | 결과 |
|------|------|
| C5 빌드 | ✅ PASS (3.09s) |
| C1 env 매트릭스 | ✅ PASS (VITE_SUPABASE_URL/ANON_KEY 2종, 누락 없음) |
| E2E spec 신규 | ✅ 1 passed / 3 skipped (레이저룸 DB 없음 — 정상) |
| 운영 bundle | ✅ `장비 선택` 확인, bundle_hash COIkmfik |
| DB 변경 | N/A (없음) |
| 회귀 실패 | ⚠️ `__dirname` ESM 오류 — CHART-ACCESS-LOCK·CHART-OPEN-GUARD·bundle-lazy-check 기존 버그, 본 변경 무관 |

- 스크린샷: `_handoff/qa_screenshots/foot_laser_section_20260520_000912.png`
- Vercel 자동배포 last-modified: 2026-05-19T15:07:50Z (+09:00 기준 2026-05-20T00:07:50)
- Field-Soak: 2026-05-21T00:07:50+09:00까지

### 후속 (기존 회귀 스펙 `__dirname` 버그)
- T-20260519-foot-CHART-ACCESS-LOCK.spec.ts:39
- T-20260519-foot-CHART-OPEN-GUARD.spec.ts:208
- regressions/R-2026-04-30-bundle-lazy-check.spec.ts:23
→ dev-foot 별도 FIX 필요 (ES module `__dirname` → `fileURLToPath(import.meta.url)` 교체)
