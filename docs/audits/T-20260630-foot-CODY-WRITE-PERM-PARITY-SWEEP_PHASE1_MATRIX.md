# Phase 1 — coordinator WRITE 권한 parity 전수 감사 매트릭스
ticket: T-20260630-foot-CODY-WRITE-PERM-PARITY-SWEEP
audited_by: agent-fdd-dev-foot
audited_at: 2026-06-30
scope: 6MENU(①패키지 ②일마감 ③메시지 ④직원·공간 ⑤서비스항목 ⑥고객관리), 역할=coordinator
method: (a) FE 저장버튼 role-gate(src/lib/permissions.ts + 컴포넌트) + (b) PROD RLS write policy 실측(Management API, pg_policies 326 policies / write 223 / 99 tables) + (c) 현장 증상

## 역할 헬퍼 함수 실측 (PROD, SECURITY DEFINER)
- `is_coordinator_or_above()` = approved ∧ role∈{admin,manager,director,**coordinator**} → **coordinator YES**
- `is_consultant_or_above()` = {admin,manager,director,consultant} → coordinator **NO**
- `is_admin_or_manager()` = {admin,manager,director} → coordinator **NO**
- `is_floor_staff()` = {admin,manager,director,staff,part_lead,tm} → coordinator **NO**
- `can_assign_rooms()` = approved ∧ 8역할 전체 → coordinator **YES**
- `is_approved_user()` = role-agnostic(approved∧active) → coordinator **YES**
- `current_user_is_admin_or_manager()` = {admin,manager} → coordinator **NO**
- FE `isStaffUnlockRole()` = {admin,manager,director,consultant,**coordinator**,therapist} → coordinator **YES**

## 매트릭스 (coordinator 기준)

| # | surface(테이블) | FE 저장 게이트 | FE coord? | PROD write RLS (coord 경로) | RLS coord? | 판정 |
|---|---|---|---|---|---|---|
| ① | package_templates | isStaffUnlockRole | ✓ | auth_all(true) | ✓ | **OK** |
| ① | package_tiers | isStaffUnlockRole | ✓ | is_approved_user | ✓ | **OK** |
| ① | package_sessions | isStaffUnlockRole | ✓ | coord_insert/coord_update + write(coord) | ✓ | **OK** |
| ① | package_payments | isStaffUnlockRole | ✓ | write(coord) + staff_unlock_6menu(coord) | ✓ | **OK** |
| ① | packages (insert/update) | isStaffUnlockRole | ✓ | packages_insert/update(coord) + staff_unlock_6menu | ✓ | **OK** |
| ① | packages DELETE | isStaffUnlockRole(isAdmin) | ✓ | RPC `delete_package_safe`(**SECDEF**, RLS우회) | ✓(RPC) | **OK** |
| ① | package_progress_plans | canEditClinicMgmt | ✗ | admin/manager/director | ✗ | OK(FE=RLS, 진료관리 영역 §11) |
| ② | daily_closings | isStaffUnlockRole | ✓ | daily_closings_staff_unlock_6menu(coord) | ✓ | **OK** |
| ② | closing_manual_payments | (no role gate) | ✓ | clinic-active-user(role무관) | ✓ | **OK** |
| ② | payments(insert/update) | isStaffUnlockRole(refund=RPC) | ✓ | payments_insert/update(coord) + coord_insert | ✓ | **OK** |
| ② | payments refund | isStaffUnlockRole | ✓ | RPC `refund_*`(**SECDEF**) | ✓(RPC) | **OK** |
| ③ | notification_templates | isStaffUnlockRole(messaging) | ✓ | **admin/manager/director only** | **✗** | **GAP → 타티켓 MSGSETTINGS** |
| ③ | notification_opt_outs | (no role gate, messaging섹션) | ✓ | **admin/manager/director only** | **✗** | **GAP → 타티켓 MSGSETTINGS(인접)** |
| ③ | clinic_messaging_capability(Solapi 연결) | isAdmin(=admin only) | ✗ | RPC admin-only | ✗ | OK(설계상 DEFER — 자격증명 경계, FE=RLS) |
| ④ | staff (근무자 CRUD) | admin\|\|manager\|\|director | ✗ | admin/manager/director | ✗ | **타티켓 STAFFCRUD-CODY-PERM** |
| ④ | room_assignments | (no gate) RPC save | ✓ | RPC `save_room_assignments`(**SECDEF**) + can_assign_rooms(coord) | ✓ | **OK** |
| ④ | **daily_room_status** (방 토글) | **(no gate, 직원·공간 진입 5역할 노출)** | **✓** | **staff-own + admin/manager only** | **✗** | **★잔여 GAP → Phase2 ADDITIVE★** |
| ④ | duty_roster | (전직원, history패턴) | ✓ | clinic-active-user(role무관) | ✓ | **OK** |
| ④ | staff_temp_off | — | ✓ | is_approved_user + clinic | ✓ | **OK** |
| ④ | clinics / clinic_doctors (병원·원장정보) | canEdit=admin\|\|manager | ✗ | is_admin_or_manager | ✗ | OK(6MENU 명시 DEFER '공간정보 편집', FE=RLS) |
| ④ | clinic_schedules / clinic_holidays / rooms | admin/manager 화면 | ✗ | is_admin_or_manager | ✗ | OK(FE=RLS, 관리자 config) |
| ⑤ | services | isStaffUnlockRole | ✓ | services_staff_unlock_6menu(coord) | ✓ | **OK** |
| ⑤ | service_charges | isStaffUnlockRole | ✓ | auth_all(true) | ✓ | **OK** |
| ⑤ | service_menu_order | isStaffUnlockRole | ✓ | clinic-isolated(role무관) | ✓ | **OK** |
| ⑤ | fee_set_templates(수가세트) | canEditStaffArea | ✓ | auth_all(true) | ✓ | **OK** |
| ⑤ | treatment_sets / treatment_set_items | (auth) | ✓ | auth_all(true) | ✓ | **OK** |
| ⑤ | phrase_templates(상용구 펜/고객차트) | canEditStaffAreaPhrase(coord포함) | ✓ | **admin/manager/director only** | **✗** | **GAP → FOLLOWUP(§11.1 phrase_type 가드 필요, 별티켓)** |
| ⑥ | customers(insert/update) | canEditCustomer(isStaffUnlockRole∪{staff,part_lead}) | ✓ | customers_coord_insert/coord_update(coord) | ✓ | **OK** |
| ⑥ | customers DELETE | admin\|\|director | ✗ | customers_admin_all only | ✗ | OK(FE=RLS aligned, PHI-destructive DEFER) |
| ⑥ | customer_*_memos (special/consult/treatment/reservation) | (clinic) | ✓(own) | INSERT=clinic(role무관) / UPDATE=own∨admin | ✓(own) | OK(own-row 모델, insert+자기수정 정상) |
| ⑥ | patient_past_history | (clinic) | ✓ | INSERT=clinic / DELETE=own | ✓ | **OK** |

## 결론
- **6MENU(read+일부write 우산, done 2026-06-21)이 coordinator write 대부분 이미 정합** — ①②⑤⑥ 핵심 surface 전부 OK.
- **잔여 coordinator write GAP = 4건**, 그중 **본 우산이 직접 ADDITIVE 처리할 잔여 = 1건(daily_room_status)**:
  1. **daily_room_status** (④ 방 활성/비활성 토글) — FE 무게이트(직원·공간 진입 5역할 노출) ↔ RLS staff-own+admin/manager. coordinator 토글 시 "토글 실패: ...RLS". **→ Phase2 ADDITIVE(본 우산)**.
  2. notification_templates / notification_opt_outs (③메시지 저장) — 현장 escalation "템플릿 저장 권한오류"의 RC. **→ 타티켓 MSGSETTINGS-STAFF-ACCESS 소유(AC6 이중정책 금지)** → planner FOLLOWUP.
  3. phrase_templates (⑤ 상용구 펜/고객차트) — canEditStaffAreaPhrase는 coord 포함하나 RLS admin/mgr/dir. ADDITIVE 해소엔 phrase_type∈{pen_chart,customer_chart} 가드 필수(§11.1 medical_chart=의사영역 무부여) → **별티켓 FOLLOWUP**(permissions.ts에 이미 'Phase2 별티켓' 명기).
- **dedup 4티켓 surface(notification_templates·phrase·staff·form_templates)는 '타티켓 담당' 표기, 본 우산 미적용(AC6).**
- **파괴 변경 0**(추가만). admin/manager/director/원장 무회귀. 제외3(통계/매출집계/계정관리) 잠금 무회귀.
