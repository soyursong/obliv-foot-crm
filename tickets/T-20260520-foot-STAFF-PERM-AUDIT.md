---
id: T-20260520-foot-STAFF-PERM-AUDIT
domain: foot
priority: P2
status: in-progress
title: 스태프 vs 관리자 권한 범위 비교 분석
created: 2026-05-20
assignee: dev-foot
db-change: false
deploy-ready: false
build-ok: true
regression-risk: none
e2e-spec: none
---

# T-20260520-foot-STAFF-PERM-AUDIT — 스태프 vs 관리자 권한 범위 비교 분석

## 배경

"스태프 계정 권한 범위가 너무 적다" — 현장 피드백.
스태프(`role='staff'`) 계정과 관리자(`role='admin'`) 계정의 DB RLS 및 FE 기능 접근 권한을 디테일하게 비교 분석.

## 조사 범위

- **DB 레이어**: `supabase/migrations/` 전수 분석 (RLS 정책 36개 테이블)
- **FE 레이어**: `App.tsx` RoleGuard + `AdminLayout.tsx` NAV_ITEMS + 컴포넌트별 인라인 role check
- **헬퍼 함수**: `is_admin_or_manager()`, `is_floor_staff()`, `is_approved_user()` 등

## 역할 계층 정의

```
admin/manager/director → is_admin_or_manager()
  └─ consultant          → is_consultant_or_above()
  └─ coordinator         → is_coordinator_or_above()
  └─ therapist/technician → is_therapist_or_technician()
  └─ staff/part_lead/tm  → is_floor_staff()  [2026-05-20 신규 추가]
  └─ 모든 approved 유저  → is_approved_user()
```

> `staff` 역할은 `is_floor_staff()`에 포함되지만,
> `is_consultant_or_above()` / `is_coordinator_or_above()` / `is_therapist_or_technician()`에는 **포함되지 않음**.

---

## AC-1: RLS 정책 전수 비교표

> 마지막 적용 마이그레이션 기준: `20260520000060_check_ins_staff_update_rls.sql`

### 범례
- `ALL` = SELECT + INSERT + UPDATE + DELETE
- `S` = SELECT only
- `S+U` = SELECT + UPDATE
- `S+I` = SELECT + INSERT
- `❌` = 접근 불가 (0 row 반환)

| 테이블 | admin/manager | staff (role='staff') | 차이 |
|--------|--------------|---------------------|------|
| **clinics** | ALL | S (is_approved_user) | INSERT/UPDATE/DELETE 없음 |
| **services** | ALL | S (is_approved_user) | INSERT/UPDATE/DELETE 없음 |
| **staff** | ALL | S (is_approved_user) | INSERT/UPDATE/DELETE 없음 |
| **rooms** | ALL | S (is_approved_user) | INSERT/UPDATE/DELETE 없음 |
| **user_profiles** | ALL | 본인 S+U (role/approved/clinic_id 변경 차단) | 타인 프로필 수정 불가, role 변경 불가 |
| **clinic_schedules** | ALL | S (is_approved_user) | 스케줄 변경 불가 |
| **clinic_holidays** | ALL | S (is_approved_user) | 휴무일 변경 불가 |
| **customers** | ALL | **S only** | ⚠️ INSERT/UPDATE/DELETE 없음 (고객 정보 수정 불가) |
| **reservations** | ALL | S+U (is_approved_user) | INSERT/DELETE 없음 — 예약 수정은 가능 |
| **reservation_logs** | ALL | S+I (is_approved_user) | DELETE 없음 |
| **check_ins** | ALL | S+U (is_floor_staff) | ⚠️ INSERT/DELETE 없음 — 체크인 등록·삭제 불가 |
| **check_in_services** | ALL | **S only** | ⚠️ INSERT/UPDATE/DELETE 없음 |
| **packages** | ALL | **S only** | ⚠️ INSERT/UPDATE/DELETE 없음 (패키지 생성·수정 불가) |
| **package_sessions** | ALL | **S only** | INSERT/UPDATE 없음 (회차 소진 기록 불가) |
| **package_payments** | ALL | **S only** | INSERT/UPDATE 없음 |
| **payments** | ALL | **S only** | ⚠️ INSERT/UPDATE/DELETE 없음 (결제 등록 불가) |
| **consent_forms** | ALL | **S only** | INSERT 불가 (동의서 생성 불가) |
| **consent_templates** | ALL | S (is_approved_user) | INSERT/UPDATE/DELETE 없음 |
| **checklists** | ALL | **S only** | INSERT/UPDATE 없음 (체크리스트 기록 불가) |
| **insurance_documents** | ALL | **S only** | INSERT/UPDATE 없음 |
| **insurance_receipts** | ALL | **S only** | INSERT/UPDATE 없음 |
| **status_transitions** | ALL | S+I (is_approved_user) | DELETE 없음 |
| **room_assignments** | ALL | **S only** | ⚠️ UPDATE 없음 (공간 배정 변경 불가) |
| **daily_closings** | ALL | **❌ 접근 불가** | ⚠️ is_consultant_or_above() OR is_coordinator_or_above() 조건 — staff 완전 차단 |
| **notifications** | ALL | S only | INSERT 불가 |
| **prescriptions** | ALL | S (is_approved_user) | INSERT/UPDATE 없음 |
| **prescription_items** | ALL | S (is_approved_user) | INSERT/UPDATE 없음 |
| **prescription_codes** | ALL | S (is_approved_user) | INSERT/UPDATE 없음 |
| **medications** | ALL | S (is_approved_user) | INSERT/UPDATE 없음 |
| **payment_codes** | ALL | S (is_approved_user) | INSERT/UPDATE 없음 |
| **payment_code_claims** | ALL | S (is_approved_user) | INSERT 없음 |
| **service_payment_codes** | ALL | S (is_approved_user) | INSERT/UPDATE 없음 |
| **form_templates** | ALL | S (is_approved_user) | INSERT/UPDATE 없음 |
| **form_submissions** | ALL | S only | ⚠️ INSERT 없음 (is_consultant_or_above 또는 coordinator_or_above 필요) |
| **notices** | ALL | ALL (authenticated 전체 허용) | = 동일 |
| **medical_charts** | ALL (clinic 격리) | ALL (clinic 격리) | = 동일 (클리닉 내 전체 허용) |
| **chart_doctor_memos** | ALL (admin+director만) | **❌ 접근 불가** | director/admin 전용 |

---

## AC-2: FE 기능별 접근 가능 여부

### 2-1. 페이지 접근 (RoleGuard + NAV_ITEMS)

| 페이지 | admin | manager | staff | 근거 |
|--------|-------|---------|-------|------|
| 대시보드 `/admin` | ✅ | ✅ | ✅ | RoleGuard 없음 |
| 예약관리 `/admin/reservations` | ✅ | ✅ | ✅ | RoleGuard 없음 |
| 고객관리 `/admin/customers` | ✅ | ✅ | ✅ | RoleGuard 없음 |
| 패키지 `/admin/packages` | ✅ | ✅ | ❌ | RoleGuard: admin/manager/consultant/coordinator |
| 직원·공간 `/admin/staff` | ✅ | ✅ | ❌ | RoleGuard: admin/manager |
| 일마감 `/admin/closing` | ✅ | ✅ | ❌ | RoleGuard: admin/manager |
| 일일 이력 `/admin/history` | ✅ | ✅ | ✅ | RoleGuard 없음 |
| 통계 `/admin/stats` | ✅ | ✅ | ❌ | RoleGuard: admin/manager/part_lead |
| 서비스관리 `/admin/services` | ✅ | ✅ | ❌ | RoleGuard: admin/manager |
| 진료 도구 `/admin/doctor-tools` | ✅ | ✅ | ❌ | RoleGuard: admin/manager/director/therapist/technician/part_lead |
| 치료 테이블 `/admin/treatment-table` | ✅ | ✅ | ✅ | RoleGuard 없음 |
| 공지사항 `/admin/notices` | ✅ | ✅ | ✅ | RoleGuard 없음 |
| 매출집계 `/admin/sales` | ✅ | ✅ | ❌ | RoleGuard: admin/manager |
| 병원·원장 정보 `/admin/clinic-settings` | ✅ | ✅ | ❌ | RoleGuard: admin/manager |
| 계정관리 `/admin/accounts` | ✅ | ❌ | ❌ | RoleGuard: admin only |
| 셀프체크인 `/checkin/:slug` | — | — | — | 인증 불필요 (anon) |

### 2-2. 페이지 내 기능별 권한 (인라인 role check)

| 기능 | admin | staff | 근거 |
|------|-------|-------|------|
| **대시보드 — 레이아웃 편집** | ✅ | ❌ | `profile?.role === 'admin'` |
| **대시보드 — 공간 배정 변경** | ✅ | ❌ (DB 차단) | room_assignments RLS |
| **대시보드 — 칸반 드래그 (check_ins 상태 변경)** | ✅ | ✅ | is_floor_staff() 신규 정책 (20260520) |
| **예약관리 — 예약 슬롯 드래그** | ✅ | ✅ | is_approved_user() 신규 정책 (20260520) |
| **예약관리 — 예약 삭제** | ✅ | ❌ | reservations DELETE = admin only |
| **예약 상세 — 예약 삭제** | ✅ | ❌ | `isAdmin` prop guard |
| **고객관리 — 고객 정보 수정** | ✅ | ❌ (DB 차단) | customers RLS: staff는 S only |
| **고객관리 — 고객 삭제** | ✅ | ❌ | `isAdmin = role === 'admin'` |
| **체크인 상세 — 삭제 버튼** | ✅ | ❌ | `isAdmin = role === 'admin'` |
| **패키지 — 삭제/환불** | ✅ | ❌ (페이지 차단) | RoleGuard + `isAdmin` |
| **서비스관리 — 추가/편집/비활성화** | ✅ | ❌ (페이지 차단) | RoleGuard + `isAdmin` |
| **직원·공간 — 직원 추가/편집** | ✅ | ❌ (페이지 차단) | RoleGuard + `isAdmin = admin\|manager` |
| **진료 도구 — 상용구 탭** | ✅ | ❌ (페이지 차단) | `isAdminOrManager` |
| **공지사항 — 작성/수정/삭제** | ✅ | ✅ | notices RLS: authenticated ALL |

---

## AC-3: 권한 부족 항목 요약 + 확장 권고안

### ⚠️ 현장 영향도 높은 항목 (P1 후속 티켓 추천)

| # | 항목 | 현재 | 영향 | 권고 |
|---|------|------|------|------|
| 1 | **고객 정보 수정** | staff = S only (customers) | 데스크 업무 불가 — 고객 전화·주소 업데이트 불가 | staff에게 customers UPDATE 부여 (비금융 컬럼 한정) |
| 2 | **패키지 페이지 접근** | RoleGuard 차단 | 잔여 회차 확인조차 불가 | RoleGuard에 'staff' 추가 (SELECT 조회 목적) |
| 3 | **공간(room) 배정 변경** | room_assignments = S only | 치료실/레이저실 배정 변경 불가 | room_assignments에 is_floor_staff() UPDATE 정책 추가 |
| 4 | **체크인 등록 (INSERT)** | check_ins INSERT = consultant/coordinator만 | staff는 check_in 등록 불가 | check_ins_insert 정책에 is_floor_staff() 추가 |
| 5 | **일일 이력 (daily_closings)** | 완전 차단 (❌) | 일일 매출 현황 열람 불가 | daily_closings SELECT에 is_approved_user() 추가 (READ 전용) |

### 🟡 현장 영향도 중간 항목 (P2 검토)

| # | 항목 | 현재 | 영향 | 권고 |
|---|------|------|------|------|
| 6 | **check_in_services 기록** | staff = S only | 시술 내역 기록 불가 | is_floor_staff() INSERT 정책 추가 |
| 7 | **통계 페이지 접근** | RoleGuard 차단 | 일부 현장 리더(데스크장)가 통계 열람 필요 | RoleGuard에 'part_lead'는 이미 있음; 'staff' 추가 여부 현장 결정 필요 |
| 8 | **동의서/체크리스트 INSERT** | consultant/coordinator만 | 스태프가 직접 동의서 체크 불가 | is_coordinator_or_above에 staff 포함 또는 별도 정책 |

### 🟢 현재 정상 동작 (변경 불필요)

| 항목 | 상태 | 설명 |
|------|------|------|
| 칸반 드래그 (check_ins) | ✅ 정상 | 20260520 is_floor_staff() 정책으로 수정 완료 |
| 예약 슬롯 드래그 | ✅ 정상 | 20260520 is_approved_user() UPDATE 정책으로 수정 완료 |
| 공지사항 CRUD | ✅ 정상 | notices RLS authenticated 전체 허용 |
| 고객 차트 열람 | ✅ 정상 | medical_charts = clinic 내 authenticated ALL |
| 대시보드·예약·고객 열람 | ✅ 정상 | is_approved_user() SELECT 허용 |

---

## AC-4: 후속 티켓 제안

planner 판단 후 우선순위 배정 요청.

1. **T-20260520-foot-STAFF-CUSTOMER-UPDATE** (P1)
   - customers 테이블에 staff UPDATE 정책 추가 (비금융 컬럼 한정)
   - 고객 전화번호·메모 수정 불가 이슈 해결

2. **T-20260520-foot-STAFF-PKG-ACCESS** (P1)
   - Packages 페이지 RoleGuard에 'staff' 추가
   - 패키지 잔여 회차 조회 허용 (INSERT/DELETE는 여전히 차단)

3. **T-20260520-foot-STAFF-ROOM-ASSIGN** (P2)
   - room_assignments UPDATE 정책에 is_floor_staff() 추가
   - 치료실 공간 배정 변경 허용

4. **T-20260520-foot-STAFF-CHECKIN-INSERT** (P2)
   - check_ins INSERT 정책에 is_floor_staff() 추가
   - 스태프가 체크인 직접 등록 가능하도록

5. **T-20260520-foot-STAFF-DAILY-READ** (P2)
   - daily_closings SELECT에 is_approved_user() 추가
   - 일일 매출 현황 열람 허용 (WRITE는 여전히 admin/manager만)

---

## 참고: role 분류

```
user_profiles.role 값:
  admin, manager, director         → 관리직 (is_admin_or_manager)
  consultant                       → 상담직
  coordinator                      → 코디
  therapist, technician            → 시술직
  staff, part_lead, tm             → 운영 직군 (is_floor_staff 포함)
  
staff.role 값 (임상직 한정):
  director, consultant, coordinator, therapist, technician
  (admin/manager/tm/staff는 staff 테이블 row 없음)
```

---

*분석 완료: 2026-05-20. dev-foot.*
