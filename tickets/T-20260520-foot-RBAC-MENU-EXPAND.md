---
id: T-20260520-foot-RBAC-MENU-EXPAND
domain: foot
priority: P1
status: deploy-ready
title: consultant/coordinator/therapist 3역할 통계·매출집계·계정관리 제외 전체 메뉴 권한 열기
created: 2026-05-20
assignee: dev-foot
deploy-ready: true
build-ok: true
db-change: true
regression-risk: low
e2e-spec: tests/e2e/T-20260520-foot-RBAC-MENU-EXPAND.spec.ts
---

# T-20260520-foot-RBAC-MENU-EXPAND

## 배경

김주연 총괄 직접 요청. consultant/coordinator/therapist 3역할이 접근 못하는 메뉴를 대폭 열기.
통계·매출집계·계정관리는 계속 차단.

## 구현 내역

### FE 변경

#### AdminLayout.tsx — NAV_ITEMS roles 확장

| 메뉴 | 이전 | 이후 |
|------|------|------|
| 패키지 | admin/manager/consultant/coordinator | + **therapist** |
| 직원·공간 | admin/manager | + **consultant/coordinator/therapist** |
| 일마감 | admin/manager | + **consultant/coordinator/therapist** |
| 서비스관리 | admin/manager | + **consultant/coordinator/therapist** |
| 진료 도구 | admin/manager | + **consultant/coordinator** |
| 병원·원장 정보 | admin/manager | + **consultant/coordinator/therapist** |
| 통계 | admin/manager/part_lead | **유지** (AC-6) |
| 매출집계 | admin/manager | **유지** (AC-6) |
| 계정관리 | admin | **유지** (AC-6) |

#### App.tsx — RoleGuard 확장

동일 범위. packages, staff, closing, services, doctor-tools, clinic-settings.

#### Closing.tsx — 뷰 전용 가드 추가

- `useAuth()` + `isAdminOrManager` 추가
- 임시저장·마감 확정·재오픈·수기추가·수기수정·수기삭제 버튼: admin/manager만 표시
- consultant/coordinator/therapist: 뷰 전용 (CSV·PDF·인쇄 허용)

### DB 변경

**파일**: `supabase/migrations/20260520000080_rbac_menu_expand.sql`  
**롤백**: `supabase/migrations/20260520000080_rbac_menu_expand.down.sql`

| 테이블 | 신규 정책 | 내용 |
|--------|-----------|------|
| `daily_closings` | `daily_closings_therapist_read` | therapist/technician SELECT 허용 (WRITE = admin/manager 유지) |

기타 테이블 변경 불필요:
- `packages`: `packages_read` = FOR SELECT authenticated USING(true) → therapist 이미 접근 가능
- `staff/rooms/services/clinics`: `*_approved_read` = is_approved_user() → 이미 접근 가능

## AC 검증

| AC | 설명 | 상태 |
|----|------|------|
| AC-1 | consultant/coordinator/therapist → 직원·공간/일마감/서비스관리/병원·원장 정보 사이드바 노출+접근 | ✅ |
| AC-2 | consultant+coordinator → 진료도구 신규 접근 | ✅ |
| AC-3 | coordinator 패키지 CRUD (DB: is_coordinator_or_above 기존 포함) | ✅ 기존 RLS 충족 |
| AC-4 | therapist → 패키지/예약관리/고객관리 신규 접근 (예약·고객은 기존 제한 없음) | ✅ |
| AC-5 | therapist 슬롯 드래그 (reservations_staff_update = is_approved_user, 20260520000050) | ✅ 기존 마이그레이션 충족 |
| AC-6 | 3역할 통계·매출집계·계정관리 미노출 + 직접 URL 차단 | ✅ RoleGuard 유지 |
| AC-7 | DB 롤백 SQL 첨부 | ✅ `20260520000080_rbac_menu_expand.down.sql` |

## 파일 목록

| 파일 | 종류 | 변경 내용 |
|------|------|----------|
| `src/components/AdminLayout.tsx` | FE | NAV_ITEMS roles 6항목 확장 |
| `src/App.tsx` | FE | RoleGuard 6 route 확장 |
| `src/pages/Closing.tsx` | FE | useAuth + isAdminOrManager 가드 |
| `supabase/migrations/20260520000080_rbac_menu_expand.sql` | DB | daily_closings therapist SELECT 정책 |
| `supabase/migrations/20260520000080_rbac_menu_expand.down.sql` | DB | 롤백 SQL |
| `tests/e2e/T-20260520-foot-RBAC-MENU-EXPAND.spec.ts` | E2E | AC-1~7 검증 spec |

## 주의사항

- STAFF-PERM-AUDIT 후속 5건(staff/part_lead 대상)과 동일 코드 영역 — 머지 충돌 없음 (roles 배열 독립 수정)
- technician 역할 동일 적용 여부 현장 확인 중 — 본건 scope 외
- DB 마이그레이션 supervisor 직접 실행 필요: `supabase db push` 또는 대시보드 SQL 실행

## 빌드

```
✓ built in 3.26s (tsc -b && vite build)
```
