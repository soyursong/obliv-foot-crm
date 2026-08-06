# STEP1 CENSUS — foot HARD lockout (READ-ONLY, 게이트 불요)

- **Ticket**: T-20260806-foot-RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP
- **Phase**: STEP1 (BLOCKING · READ-ONLY · 순수 SELECT introspection)
- **DB**: foot prod (rxlomoozakkjesdqjtvd) — 물리 분리·자기 LIVE 계정공간·자기 role-set
- **방법**: Management API `POST /database/query` (pure SELECT). 계정 email/name 미출력(role/flag/count만).
- **raw evidence**: `scripts/_evidence/census_foot_RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP_T-20260806.out`
- **census script**: `scripts/T-20260806-foot-RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP_census.mjs`
- ⚠️ body(parent) C1~C6 패턴 **참조하되 재사용 안 함** — foot 독립 실측. **결론: foot 지형은 body와 유의미하게 상이.**

---

## C1 — 공유 함수 계열 + 게이팅 여부

boolean authz 헬퍼 **10개** 실재. 게이트 = `is_approved_user()`(=approved∧active) conjunct 포함 여부.

### ★UNGATED (3) — 누수 벡터
| 함수 | role-set | 정의 | 위치 |
|------|----------|------|------|
| `current_user_is_admin_or_manager()` | **{admin,manager}** (director 미포함) | `role IN ('admin','manager')` — 게이트 없음 | 공유 계보 `20260423000000_rls_role_policies.sql` |
| `is_admin()` | {admin} (UPPER 매칭) | `UPPER(current_user_role())='ADMIN'` — 게이트 없음 | 동 |
| `is_manager_or_above()` | role_level>=1 | `role_level(current_user_role())>=1` — 게이트 없음 | 동 |

### GATED (7) — 이미 is_approved_user() wrap (무접촉 대상)
`is_admin_or_manager()`={admin,manager,**director**}∧gated · `is_consultant_or_above()` · `is_coordinator_or_above()` · `is_doctor_role()`={director,doctor} · `is_floor_staff()` · `is_therapist_or_technician()` · `can_assign_rooms()` (+ 게이트 함수 `is_approved_user()` 자체).

### ★foot ≠ body 지형 (fork divergence)
- body의 5헬퍼 중 foot에 **존재하는 건 `current_user_is_admin_or_manager` 하나뿐**. body의 `is_director_or_admin`/`is_director_admin_or_manager`/`is_medical_chart_reader`/`is_coordinator_read` = **foot 부재**.
- foot는 대신 **병렬 gated 계열**(`is_admin_or_manager` 등 7종)을 이미 보유 + body에 없는 **ungated 2종 추가**(`is_admin`, `is_manager_or_above`).
- **C2 per-fork 질문(DA)**: `current_user_is_admin_or_manager`(ungated·{admin,manager}) 옆에 **이미 gated superset `is_admin_or_manager`({admin,manager,director})가 존재**. → **in-place 게이팅**(body식, {admin,manager} 보존·director 미추가)이 정답인가, 아니면 참조 정책을 `is_admin_or_manager`로 **repoint**인가? **repoint = director silent widening → C3 위반**. 따라서 in-place 게이팅이 안전 analog로 보이나 **판정은 DA**.

---

## C2 — 참조 정책·테이블 전수 (delete 3정책 + daily_closings_write)

지정 대상 전건 **ungated 확인**:

| 테이블 | 정책 | cmd | 술어 | 게이트 |
|--------|------|-----|------|--------|
| check_ins | `check_ins_delete_admin` | DELETE | `current_user_is_admin_or_manager() AND clinic_id=…` | ❌ ungated |
| packages | `packages_delete_admin` | DELETE | `current_user_is_admin_or_manager()` | ❌ ungated |
| payments | `payments_delete_admin` | DELETE | `current_user_is_admin_or_manager() AND clinic_id=…` | ❌ ungated |
| daily_closings | `daily_closings_write` | ALL | `current_user_is_admin_or_manager()` (USING+WITH CHECK) | ❌ ungated (finance DESTRUCTIVE) |
| user_profiles | `user_profiles_delete_admin` | DELETE | `current_user_role()='admin'` (bare role) | ❌ ungated |
| insurance_sync_runs | `insurance_sync_runs_read_admin` | SELECT | `current_user_is_admin_or_manager()` | ❌ ungated (read) |

**director-parity 확인**: check_ins/packages/payments/daily_closings **각각 병렬 gated `*_admin_all`**(`is_admin_or_manager()` = {admin,manager,director}∧approved∧active) 보유 → `current_user_is_admin_or_manager`를 {admin,manager} 보존·게이팅해도 **director lockout=0**(body C3와 동형). → destructive DELETE는 director를 admin_all이 커버.

---

## C3 — 제2 인라인 계열 + 3분류

ungated bare `current_user_role()` 술어 총 **29건**(self-test oracle 예비치) + ungated 헬퍼 참조. 3분류(자동분류 후 수기보정 필요분 명시):

### ① SELF_SCOPED_CARVE (own-row∧role — wrap 제외 대상)
- `check_ins_update_therapist_own` : `role='therapist' AND therapist_id=current_user_staff_id() AND clinic_id=…` (staff_id 앵커·전체 술어 own-scoped). **무접촉**(body ① analog).

### ③ HYBRID (own-leg OR privileged-role — role leg만 gate, own-leg 보존)
- `user_profiles_read_own` / `user_profiles_update_own_or_admin` / `user_profiles_insert_admin` : `id=auth.uid() OR current_user_role()='admin'`.
- `manage_update_ccm` / `manage_update_crm` / `manage_update_ctm` (customer_*_memos) : `created_by=auth.jwt()->>'email' OR role IN (admin,manager,director)` — **own-authorship(email) leg** = own-leg. ★자동분류는 auth.uid() 부재로 ②로 표기됨 → **DA 수기 재분류 필요**(미승인 유저 자기저작 메모 편집 허용 여부 = policy 판단).
- `cdm_director_clinic_v2` (chart_doctor_memos) : clinic-scoped EXISTS(auth.uid()∧role) OR (clinic_id IS NULL ∧ role IN admin/director) — **ambiguous, DA 분류 필요**.
- `mc_clinic_isolated_v3` / `mc_deleted_rows_director_only` (medical_charts) : clinic-null-fallback privileged leg — DA 분류 필요.

### ② UNGATED_PRIVILEGED (pure role-list — wrap 대상)
check_ins_insert · check_ins_update_privileged · check_ins_delete_admin · customers_therap_update_6menu · package_payments_write · package_sessions_write · packages_insert · packages_update · payments_insert · payments_update · ppp_write · prescription_contraindications(rx_contra_admin_write) · staff_coordinator_insert_staffcrud · staff_coordinator_update_staffcrud · saaa_admin_read · treatment_photos_insert_staff · treatment_photos_update_staff · user_profiles_delete_admin · fs_deleted_rows_director_only · fsal_select_director_admin · insurance_sync_runs_read_admin · daily_closings_write.

### ★foot-native 계열 (body 부재) — `*_staff_unlock_6menu`
`daily_closings_staff_unlock_6menu` · `daily_room_status_staff_unlock_6menu` · `package_payments_staff_unlock_6menu` · `packages_staff_unlock_6menu` · `services_staff_unlock_6menu` (모두 ungated bare role `{consultant,coordinator,therapist}`). **foot 일마감 6-menu unlock 기능** = body에 없는 별도 축. finance/운영 write를 floor staff에 ungated 확장 → **DA 별도 분류 필수**(② wrap인가, 별도 취급인가).

---

## C4 — 노출 계정 SET-DIFF + role-set parity

### 특권 role(admin/manager/director) 중 ¬(approved∧active)
| role | approved | active | n |
|------|----------|--------|---|
| **admin** | true | **false** | **1** |

→ **HARD-lockout 대상 = admin 1계정**(approved∧inactive). 현재 `current_user_is_admin_or_manager()`가 active/approved 무시 → 이 계정이 **payments/packages/check_ins DELETE + daily_closings ALL** 여전히 통과 = **live PHI/finance 누수**. manager(3)·director(2) = 전건 approved∧active(clean).

### 인라인 ② surface 전체 노출셋 (role∈ungated정책 ∧ ¬(approved∧active))
| role | 상태 | n |
|------|------|---|
| admin | approved∧inactive | 1 |
| consultant | approved∧inactive | 2 |
| coordinator | ¬approved∧inactive | 4 |
| therapist | approved∧inactive | 4 |
| **합계** | | **11** |

→ ② 인라인 write surface(payments_insert·package writes·6menu unlock 등) 초과 노출 계정 = **11**. remediation 후 이 11계정은 fail-closed narrowing(INTENDED). director/manager/staff/tm = clean.

### role-set parity (director)
- 존재 role: `admin, consultant, coordinator, director, manager, staff, tm`, therapist. (body의 part_lead/technician은 정책엔 등장하나 계정 0 — dead-ref 여부 DA F3 analog 확인 요).
- `current_user_is_admin_or_manager`={admin,manager}(director 無) ↔ 병렬 `is_admin_or_manager`={admin,manager,director}. **director는 destructive를 admin_all로 커버** → in-place 게이팅 시 director parity intact.

---

## C5 — finance-tier 커플링

- **daily_closings**: `daily_closings_write`(ALL, ungated current_user_is_admin_or_manager) + `daily_closings_staff_unlock_6menu`(ALL, ungated bare role) = **ungated 쓰기 2경로**. gated 커버: `daily_closings_admin_all`(is_admin_or_manager,+director) · read 계열(finance_read/staff_read/therapist_read/read = 전부 gated 헬퍼 경유).
- **payments**: `payments_delete_admin`(ungated) · `payments_insert`/`payments_update`(ungated bare role). gated 커버: `payments_admin_all`(+director) · insert 계열(consult/coord/therap = gated 헬퍼) · read 계열 gated.
- **package_payments**: `package_payments_write`(ungated) · `package_payments_staff_unlock_6menu`(ungated). gated: `package_payments_admin_all`(+director) · approved_read. ⚠️**별건 관찰**: `package_payments_read` qual=`true`(authenticated 전체 SELECT 개방) — 본 티켓 ungated-helper scope 밖이나 PHI-인접 관찰로 기록.

**커플링 결론**: ungated `current_user_is_admin_or_manager`가 finance DESTRUCTIVE 3경로(daily_closings_write ALL·payments_delete_admin·packages_delete_admin — 여기선 packages는 finance 인접)에 결합 + foot-native `*_staff_unlock_6menu` ungated 계열이 floor staff에 finance write 확장. body 대비 **foot는 6menu 축이 추가된 넓은 finance 커플링**.

---

## STEP2~4 게이트 발주용 요약 (planner→DA)

1. **C2 함수-게이팅 vs repoint 분기**: `current_user_is_admin_or_manager` in-place 게이팅(body식, {admin,manager} 보존) vs `is_admin_or_manager` repoint(director widening=NO-GO 우려). + 추가 ungated 헬퍼 `is_admin`·`is_manager_or_above` 처리 방침.
2. **C3 role-set / 3분류 확정**: 특히 ③ 재분류 후보(customer_*_memos authorship leg·cdm_director_clinic_v2·medical_charts clinic-null leg) + **foot-native `*_staff_unlock_6menu`(5정책) 분류** = 신규 DA 판단축.
3. **C5 SET-DIFF foot 계정 exact**: 특권 노출 admin=1(dispositive) + ② surface 11계정 fail-closed narrowing 정직성.
4. **C6 finance-tier**: daily_closings/payments/package_payments ungated 쓰기 경로 + 6menu 축.
5. **forward-only 하드가드**: 3 ungated 헬퍼 전부 공유 계보 `20260423000000_rls_role_policies.sql` 정의 → **in-place mutate 절대 금지**, STEP3 = 신규 foot 타임스탬프 마이그.

⛔ DA per-fork GO 前 마이그 write / deploy-ready 금지. 본 STEP1 = census only.
