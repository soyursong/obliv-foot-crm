---
id: T-20260521-foot-STAFF-PKG-ROLLBACK
domain: foot
priority: P0
status: deploy-ready
title: staff 권한 롤백 + 3역할(상담실장·코디·치료사) 패키지 조회 오픈
created: 2026-05-21
assignee: dev-foot
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260521-foot-STAFF-PKG-ROLLBACK.spec.ts
---

# T-20260521-foot-STAFF-PKG-ROLLBACK — staff 권한 롤백 + 3역할 패키지 조회 오픈

## 배경

T-20260520-foot-STAFF-PKG-ACCESS에서 generic `staff`/`part_lead`에 packages 접근을 허용했으나,
김주연 총괄 지시로 해당 역할 차단 + 3역할(consultant/coordinator/therapist)만 READ 오픈.

## 변경 사항

### App.tsx
- packages RoleGuard: `staff`, `part_lead` 제거
- 유지 역할: `['admin', 'manager', 'consultant', 'coordinator', 'therapist']`

### Packages.tsx (comment 정비)
- canWritePackage 주석: `therapist=READ-only` 명시 (로직 변경 없음)
- 쓰기 버튼 관련 주석 갱신 (therapist 기준으로 통일)

## AC 결과

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 상담실장(consultant) → /packages 접근 + 잔여회차 조회 | ✅ RoleGuard 포함 |
| AC-2 | 코디(coordinator) → /packages 접근 + 잔여회차 조회 | ✅ RoleGuard 포함 |
| AC-3 | 치료사(therapist) → /packages 접근, 쓰기 버튼 비노출 (READ-only) | ✅ RoleGuard 포함, canWritePackage 미포함 |
| AC-4 | staff(범용) → /packages 접근 차단 | ✅ RoleGuard에서 제거됨 |
| AC-5 | admin/manager CRUD 기존 유지 (회귀 없음) | ✅ 변경 없음 |

## role enum 확인 (types.ts)

```
UserRole = 'admin' | 'manager' | 'director' | 'part_lead' | 'consultant' | 'coordinator' | 'therapist' | 'technician' | 'tm' | 'staff'
```

- 상담실장 → `consultant` ✓
- 코디 → `coordinator` ✓
- 치료사 → `therapist` ✓

## DB 변경

없음 — FE RoleGuard만 수정.

## 빌드

✅ built in 3.14s (에러 없음)
