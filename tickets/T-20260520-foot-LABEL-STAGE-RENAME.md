---
id: T-20260520-foot-LABEL-STAGE-RENAME
title: "풋센터 대시보드 진행단계 라벨 통일 (치료대기·치료실)"
status: deployed
priority: P2
domain: foot
assigned_to: dev-foot
deploy_ready: true
build_passed: true
db_migration: false
e2e_spec_exempt: true
e2e_spec_reason: "라벨 텍스트 정정만 (typo fix), e2e_spec_exempt 승인"
commit: 4dfa7d0
qa_result: pass
qa_grade: Green
deployed_at: "2026-05-21T00:06:00+09:00"
deploy_commit: fac47a45f4bf6222b13db541fe35f8247d0eead7
bundle_hash: Dashboard-xf6RTBbA
field_soak_until: "2026-05-22T00:06:00+09:00"
created_at: 2026-05-20
completed_at: 2026-05-20
deadline: 2026-05-27
---

## 개요

`STATUS_KO` 객체의 두 상태값 한글 라벨을 현장 용어에 맞게 통일.

## 변경 내역

| 키 | 이전 | 이후 |
|----|------|------|
| `treatment_waiting` | 관리대기 | **치료대기** |
| `preconditioning` | 관리 | **치료실** |

## 파일

- `src/lib/status.ts` — STATUS_KO 값 수정 + 주석 동기화

## 영향 범위

STATUS_KO를 참조하는 모든 UI 자동 반영:
- StatusContextMenu, CheckInDetailSheet, DoctorPatientList
- Dashboard toast/badge, DailyHistory 이력 뷰
- Waiting, Closing, TreatmentTable

Dashboard.tsx KANBAN_GROUP_LABELS(`treatment_waiting_col`, `treatment_rooms`)는 이미 올바른 값('치료대기', '치료실')으로 유지됨.

## DB

변경 없음 — DB 영문 enum 불변.

## 빌드

```
✓ tsc -b 통과
✓ vite build 완료 (3.17s)
✓ push → main (commit 4dfa7d0)
```
