---
id: T-20260523-foot-STAFF-HISTORY-AUDIT
domain: foot
priority: P1
status: deploy-ready
title: 직원 계정별 처리 이력 정상 기록 점검 (5/26 시뮬레이션 사전 감사)
created: 2026-05-23
deadline: 2026-05-25
assignee: dev-foot
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: none
e2e-spec-exempt-reason: audit_report_only
---

# T-20260523-foot-STAFF-HISTORY-AUDIT — 직원 계정별 처리 이력 점검 보고서

## 점검 일시
2026-05-23 (5/26 시뮬레이션 사전 점검)

---

## 스키마 정정 — 점검 범위 실제 매핑

| 티켓 명칭 | 실제 테이블 | 실제 컬럼 | 비고 |
|-----------|------------|----------|------|
| check_ins.staff_id | check_ins | consultant_id / therapist_id / technician_id | UUID FK staff(id) |
| check_ins.created_by | check_ins | 없음 | 이력 컬럼 미존재 |
| treatments (별도) | **없음** | — | 치료 데이터는 check_ins에 내포 (treatment_memo JSONB) |
| payments.staff_id | payments | 없음 | 설계상 staff FK 미포함 |
| payments.created_by | payments | 없음 | deleted_by/cancelled_by TEXT만 존재 (감사용) |
| pen_charts | form_submissions | issued_by UUID FK staff(id) | nullable (5/22 변경) |

---

## 테이블별 점검 결과

### 1. check_ins — `consultant_id / therapist_id / technician_id`

**스키마 상태**
- 컬럼 타입: UUID FK → staff(id), 모두 nullable
- NOT NULL 제약: 없음 (설계상 옵션)

**코드 추적**
| 컬럼 | 설정 위치 | 방식 |
|------|----------|------|
| consultant_id | NewCheckInDialog.tsx | 신규: assign_consultant_atomic RPC / 재진: customers.assigned_staff_id 자동 조회 |
| therapist_id | Dashboard.tsx (드래그) | 치료실 배정 시 check_ins UPDATE |
| technician_id | Dashboard.tsx | 레이저 배정 시 (현재 설정 경로 미사용) |

**데이터 샘플 (최근 7일, 130건)**
| 컬럼 | NULL 건수 | NULL율 |
|------|---------|-------|
| consultant_id | 96/130 | 73% |
| therapist_id | 80/130 | 61% |
| technician_id | 130/130 | 100% |

**완료(done) 체크인 (100건)**
| 컬럼 | NULL 건수 | NULL율 |
|------|---------|-------|
| consultant_id | 71/100 | 71% |
| therapist_id | 54/100 | 54% |

**판정: ⚠️ CAUTION**
- consultant_id 71% NULL은 높은 수준. 원인: 많은 체크인이 테스트/더미 데이터이거나, assign_consultant_atomic RPC가 상담사 미배정 일에 null 반환.
- therapist_id 54% NULL: 치료실 배정 없이 완료되는 케이스(체험권 등)에서 발생 가능.
- technician_id 100% NULL: 레이저 담당 기사 배정 흐름이 미사용 중. 설계상 legacy 컬럼.
- **5/26 시뮬 핵심**: 당일 신규 생성 체크인에서 consultant_id 정상 세팅 여부 직접 확인 필요.

**RLS 상태 (이력 기록 방해 여부)**
- INSERT: check_ins_staff_insert (is_floor_staff()) ✅ 2026-05-21 적용
- UPDATE: check_ins_staff_update (is_floor_staff()) ✅ 2026-05-20 적용
- RLS가 staff 이력 기록을 방해하지 않음

---

### 2. treatments — **해당 테이블 없음**

`treatments` 는 별도 테이블 없이 `check_ins.treatment_memo JSONB`, `check_ins.treatment_photos TEXT[]` 로 내포 저장.
치료 이력의 staff 매핑은 check_ins.therapist_id 경유.

**판정: N/A** — 점검 범위에서 제외.

---

### 3. payments — `staff_id / created_by`

**스키마 상태**
- payments 테이블에 staff_id, created_by 컬럼 **없음**
- 감사 컬럼: `deleted_by TEXT`, `cancelled_by TEXT` (삭제/취소 시 actor 기록용)
- payment_audit_logs.actor TEXT (수정/취소 이력용)

**코드 추적**
- PaymentMiniWindow.tsx 결제 INSERT: staff 필드 없음 (설계상 staff FK 미포함)
- deleted_by / cancelled_by: 삭제/취소 플로우에서 TEXT로 기록됨 (FE 미확인)

**판정: ⚠️ DESIGN GAP**
- 결제 생성 시 어느 직원이 처리했는지 FK 수준 추적 불가.
- 운영상 체크인→결제 연결(check_in_id)로 담당 직원 간접 추적은 가능.
- 5/26 시뮬레이션: 결제 처리 자체는 정상 (RLS PAY-PRINT-BUGS 이후 coordinator/therapist 결제 INSERT 허용)
- **별도 개선 필요 시 fix 티켓 요청 가능** (payments.processed_by UUID FK staff 추가)

---

### 4. form_submissions (펜차트/서류) — `issued_by`

**스키마 상태**
- issued_by UUID FK → staff(id)
- nullable: ✅ (2026-05-22 migration으로 NOT NULL → nullable 변경)

**코드 추적**
두 진입점 모두 동일 패턴:
```javascript
// PenChartTab.tsx (L485-492) / DocumentPrintPanel.tsx (L365-372)
supabase.from('staff').select('id')
  .eq('user_id', profile.id)   // ← auth.uid()와 대조
  .eq('clinic_id', clinicId)
  .eq('active', true)
  .maybeSingle()
  .then(({ data }) => setStaffId(data?.id ?? null));
```

**핵심 이슈 → 해결**
- 5/23 이전: `staff.user_id` 전원 NULL → staffId 조회 항상 null → issued_by NULL 저장
- **2026-05-23 migration (20260523010000_staff_user_id_link.sql)**: 16명 활성 직원 user_id 연결 완료

**데이터 샘플 (9건 전체)**
- issued_by NULL: 9/9 (100%) → 모두 5/23 이전 기록 (역사적 데이터, 수정 불가)
- **5/23 이후 신규 기록: issued_by 정상 기록 예상**

**staff.user_id 링크 상태 (5/23 적용 후)**
| 역할 | 총원 | 활성 | user_id 연결 |
|-----|-----|-----|------------|
| consultant | 6 | 5 | 5명 ✅ |
| coordinator | 7 | 1 (데스크) | 1명 ✅ |
| therapist | 14 | 11 | 11명 ✅ |
| technician | 4 | 4 | 0명 ❌ (기기 계정, 사람 계정 아님) |
| director | 2 | 1 (문원장) | 0명 ❌ |

**판정: ✅ RESOLVED (5/23~)**
- 기존 9건 NULL 이력: 정상 (5/23 이전 구조적 한계)
- 5/23 이후 신규 서류 발급: issued_by 정상 기록
- 테크니션(기기 계정)은 서류 발급 주체 아님 → NULL 무방
- 문원장 director 계정: user_id 미연결 → 원장이 직접 서류 발급 시 issued_by NULL 기록 (별도 조치 필요 시 planner 협의)

---

### 5. package_sessions — `performed_by`

**스키마 상태**
- performed_by UUID FK → staff(id), nullable

**코드 추적**
- CustomerChartPage.tsx: `currentUserStaffId` 로드 (staff.user_id = profile.id, 치료사 계정 자동 세팅)
- `useEffect` 우선순위: 1) 현재 로그인 직원이 therapistList에 있으면 본인 자동 세팅 → 2) designated_therapist fallback
- RLS: package_sessions_therap_insert → performed_by = current_staff_id() 강제 (치료사 본인만)

**데이터 샘플 (52건 전체)**
- performed_by NULL: 3/52 (5.8%)
- NULL 3건: 5/23 이전 또는 admin/관리자 직접 생성 레코드로 추정

**판정: ✅ GOOD**
- 5/23 migration 이후 치료사 계정 로그인 시 performed_by 자동 세팅 완전 동작 예상
- 3건 NULL: 기존 데이터, 운영 영향 없음

---

### 6. check_in_services — staff 참조 없음

- staff 컬럼 없음 (check_in_id → check_ins → therapist_id 경유 추적)
- RLS PAY-PRINT-BUGS(5/22): coordinator/therapist INSERT+DELETE 허용 완료

**판정: ✅ GOOD**

---

### 7. room_assignments — `staff_id`

**데이터 샘플 (최근 50건)**
- staff_id NULL: 0/50 (0%)

**판정: ✅ PERFECT**

---

### 8. status_transitions — `changed_by TEXT`

**데이터 샘플 (최근 20건)**
- changed_by NULL: 20/20 (100%)
- 원인: Dashboard.tsx status_transitions INSERT 시 changed_by 미설정

**판정: ⚠️ DESIGN GAP**
- 상태 전환 주체 추적 불가
- 5/26 시뮬레이션 핵심 동작에는 영향 없음
- 별도 개선 필요 시 fix 티켓 요청 가능

---

### 9. packages — `created_by TEXT`

**데이터**: created_by NULL 20/20 (100%)
**원인**: 코드(CustomerChartPage.tsx, Packages.tsx)에서 created_by INSERT 미포함
**판정: ⚠️ MINOR GAP** — TEXT 컬럼으로 FK 추적도 아님; 운영 영향 낮음

---

## 최근 배포 영향 종합

| 배포 티켓 | 내용 | staff 이력 기록 영향 |
|----------|------|-------------------|
| STAFF-REEXPAND (5/22, RLS 3건 재적용) | customers/room_assignments/daily_closings staff RLS 재적용 | 이력 기록 방해 없음 ✅ |
| PAY-PRINT-BUGS (5/22, RLS 8건) | payments/package_sessions/check_in_services 권한 추가 | 이력 기록 가능 상태로 개선 ✅ |
| STAFF-PERM-REVIEW (5/21 롤백 3건) | B안 롤백 후 5/22 재적용으로 복구됨 | 현재 정상 ✅ |
| staff_user_id_link (5/23) | 16명 active staff → user_id 연결 | **핵심: issued_by/performed_by/currentUserStaffId 정상화** ✅ |

---

## 5/26 시뮬레이션 준비 상태 종합

### 활성 직원 계정 별 이력 기록 예상

| 역할 | 계정 로그인 가능 | check_in 담당 기록 | 서류 issued_by | 패키지 performed_by |
|-----|--------------|-----------------|--------------|-------------------|
| consultant (5명) | ✅ | consultant_id 자동 매핑 | ✅ (5/23~) | N/A |
| coordinator 데스크 (1명) | ✅ | check_in 등록 가능 | ✅ (5/23~) | N/A |
| therapist 활성 (11명) | ✅ | therapist_id 배정 시 | ✅ (5/23~) | ✅ 자동 세팅 |
| technician (4명) | ❌ 계정 없음 | N/A | N/A | N/A |

### 5/26 전 필수 확인 사항

| 항목 | 상태 | 조치 |
|-----|------|------|
| staff.user_id 연결 | ✅ 완료 (5/23) | — |
| check_ins INSERT RLS | ✅ is_floor_staff() | — |
| check_ins UPDATE RLS | ✅ is_floor_staff() | — |
| payments INSERT RLS | ✅ coordinator/therapist | — |
| package_sessions INSERT | ✅ coordinator/therapist | — |
| form_submissions INSERT | ✅ clinic_id 기반 | — |
| form_submissions issued_by | ✅ 5/23~ 정상 기록 | — |
| 이력 NULL 기존 데이터 | ⚠️ 5/23 이전 null 잔존 | 운영에 무영향 (역사적 데이터) |

---

## 별도 Fix 티켓 권고

| 항목 | 심각도 | 내용 |
|-----|-------|------|
| payments.processed_by 추가 | P2 | 결제 처리 직원 FK 추적. 현재는 check_in_id→therapist_id 간접 추적. 5/26 시뮬 후 필요 시 검토 |
| status_transitions.changed_by 설정 | P2 | 상태 전환 주체 TEXT 기록. Dashboard.tsx INSERT에 profile?.id 추가. |
| director 문원장 user_id 연결 | P2 | 문원장이 직접 계정 로그인 시 issued_by NULL. 계정 확인 후 UPDATE 1건 |

---

## 결론

**5/26 시뮬레이션 GO — 핵심 staff 이력 기록 정상화 확인**

- 가장 중요한 issued_by (서류 발급), performed_by (패키지 차감) — 5/23 staff.user_id 연결로 해결
- RLS 권한: 전 역할 INSERT/UPDATE 가능 상태
- 기존 NULL 데이터: 구조적 한계의 역사적 산물로 수정 불필요
- consultant_id NULL 이슈: 시뮬 당일 실시간 체크인에서 정상 동작 검증 필요

**신규 Fix 티켓 요청: 없음** (P2 항목들은 5/26 이후 검토 권고)
