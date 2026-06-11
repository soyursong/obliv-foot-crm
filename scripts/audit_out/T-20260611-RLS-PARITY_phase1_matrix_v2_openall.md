# Phase 1 매트릭스 v2 — open-all-except-3 재분류 (READ-ONLY, 변경 0)

- **티켓**: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY
- **모델**: open-all-except-3 (MSG-...112151-fbfq fold 확정 / INFO MSG-20260611-113027-4rx4)
- **분류축 변경**: (v1) '메뉴 공유여부' SELECT 정책 semantics(OPEN/PARITY/OTHER) → **(v2) 제외3카테고리(통계/매출집계/계정관리) → EXCL / OPEN / AMBIGUOUS**
- **원천 데이터**: `T-20260611-RLS-PARITY_phase1_audit.txt` (97 base table + 11 view) + `_dump.txt` (정책 USING절) + `src/App.tsx` RoleGuard 맵
- **불변 원칙**: 개방=staff READ-only(INSERT/UPDATE/DELETE 불변) + clinic_id 스코프 유지. EXCL=staff SELECT 잠금 + FE 메뉴 숨김.
- ⚠ **본 문서는 read-only 산출물. Phase1 게이트(planner+supervisor) 통과 전 어떤 RLS·FE 변경도 없음.**

## staff role 판정 기준 (SELECT USING절 → 직원 가시성)

| USING 패턴 | 직원(coordinator/therapist/technician/staff/part_lead) SELECT |
|---|---|
| `is_approved_user()` / `is_floor_staff()` / `USING true` | ✅ YES (parity OK) |
| `clinic_id = current_user_clinic_id()` / `= get_user_clinic_id()` | ✅ YES |
| `EXISTS user_profiles ... approved+active` (role 무필터) | ✅ YES |
| `is_admin_or_manager()` / `current_user_is_admin_or_manager()` | ❌ NO (관리자 전용) |
| `current_user_role() IN (admin,director)` | ❌ NO |
| `staff.id = auth.uid()` (staff 테이블 신원) | ⚠ BROKEN (staff.user_id 희소 → 직원 0건, OUTLIER) |
| SELECT 정책 부재(NO_SELECT_POLICY) | ❌ NO (staff·mgmt 모두 deny) |

---

## 요약 카운트 (base table 97 + view 11)

| v2 분류 | 수 | 의미 |
|---|---|---|
| **EXCL-확정** | 통계 view 10 + 매출/정산 2 + 계정 0(아래 AMB) | 직원 잠금 유지 대상 |
| **OPEN-이미 parity (변경없음)** | ~58 | 직원 이미 관리자와 동일 SELECT |
| **OPEN-수정필요 (직원 현재 차단)** | 4 (health_q×2 fix중, clinic_events, check_in_room_logs) | parity-fix 대상 |
| **AMBIGUOUS (게이트 확정 필요)** | 9 | 경계 — planner/supervisor 판정 |
| **비메뉴/통합/백업 (N/A)** | 7 | UI 메뉴 없음 → 조치 없음 |

---

## A. EXCL-확정 (제외 3카테고리 — 직원 잠금 유지)

### A-1. 통계 (statistics) — FE `stats` route = RoleGuard[admin,manager,part_lead,tm]
| 뷰/테이블 | 카테고리 | 현재 직원 SELECT | 현재 FE 직원노출 | 조치 |
|---|---|---|---|---|
| v_daily_revenue | 통계/매출 | (view, invoker TBD) | stats 메뉴 staff 차단✓ | EXCL 유지 |
| v_daily_avg_spend | 통계 | TBD | 차단✓ | EXCL 유지 |
| v_daily_visits / v_daily_visit_rate | 통계 | TBD | 차단✓ | EXCL 유지 |
| v_daily_stay_duration / v_daily_consult_wait | 통계 | TBD | 차단✓ | EXCL 유지 |
| v_monthly_consultant_perf | 통계/실적 | TBD | 차단✓ | EXCL 유지 |
| v_monthly_technician_perf | 통계/실적 | TBD | 차단✓ | EXCL 유지 |
| v_monthly_therapist_perf | 통계/실적 | TBD | 차단✓ | EXCL 유지 |
| v_monthly_tm_perf | 통계/실적 | TBD | 차단✓ | EXCL 유지 |
- ⚠ **게이트 질문 G-통계-1**: `stats` RoleGuard에 `part_lead`·`tm` 포함 — 이 둘은 staff성 role인데 통계 노출 허용 중. 제외 정책상 직원이면 차단해야 하나? (현행 유지/추가 차단 확정 필요)
- ⚠ view security_invoker 여부는 Phase2 진입 시 별도 확인 — invoker면 하위 테이블 RLS 따름.

### A-2. 매출집계 (정산/매출/급여/수익)
| 테이블 | 카테고리 | 현재 직원 SELECT | 현재 FE | 조치 |
|---|---|---|---|---|
| daily_closings | 일마감/정산=매출집계 | ✅ **YES** (`daily_closings_read USING true` + `_staff_read is_floor_staff()` + `_therapist_read`) | `closing` route = RoleGuard[admin,manager,consultant,coordinator,therapist] → **직원 일부 노출** | ⚠ **LEAK — EXCL이면 staff SELECT 회수 + FE 직원 차단 필요**. (단 closing=일마감 운영체크 측면 有 → AMBIGUOUS 경계, A-2/AMB 동시 표기) |
| closing_manual_payments | 마감 수기결제=매출집계 | ✅ YES (`closing_manual_read[SELECT]:OPEN`) | closing 화면 내부 | ⚠ LEAK 후보 — EXCL이면 잠금 |
- `sales` route = RoleGuard[admin,manager] → 직원 차단✓ (매출 메뉴 FE는 이미 정합).

### A-3. 계정관리 — FE `accounts` route = RoleGuard[admin] (직원·매니저도 차단✓)
- 계정관리 *메뉴*(accounts)는 admin 전용 — FE 정합. 단 그 뒤 테이블(user_profiles/staff)의 SELECT parity는 AMBIGUOUS(아래 D) — '계정 CRUD 페이지'와 '이름표시용 프로필 read'가 같은 테이블을 공유하기 때문.

---

## B. OPEN — 이미 parity (직원 = 관리자 동일 SELECT, **변경없음**)

`is_approved_user` / `is_floor_staff` / `approved_read` / clinic-scope SELECT 보유 → 직원 이미 정상 노출. (대표 목록, 일반 진료/예약/패키지/처방/방/알림 동선)

```
customers, check_ins, check_in_services, checklists, reservations, reservation_logs,
reservation_memo_history, reservation_registrars, medical_charts, medications,
prescriptions, prescription_items, prescription_codes, prescription_code_folders,
prescription_folders, prescription_sets, prescription_contraindications, quick_rx_buttons,
super_phrases, phrase_templates, document_templates, consent_forms, consent_templates,
clinical_images, claim_diagnoses, diagnosis_folders, diagnosis_set_items, diagnosis_sets,
services, service_charges, service_menu_order, service_payment_codes, packages,
package_sessions, package_tiers, package_templates, package_progress_plans, rooms,
room_assignments, room_role_mapping, daily_room_status, patient_room_daily_log, duty_roster,
clinic_doctors, clinic_holidays, clinic_schedules, clinic_memos, clinic_dashboard_layouts,
notices, notifications, notification_logs, notification_templates, notification_opt_outs,
message_logs, handover_notes, handover_checklist_items, timer_records, status_transitions,
customer_special_notes, customer_treatment_memos, form_submissions, form_templates,
fee_set_templates, treatment_sets, treatment_set_items, receipt_ocr_results, call_type_codes,
clinics, clinic_messaging_capability, user_dashboard_layout_overrides(own-only)
```
- 조치: **변경없음** (이미 직원=관리자). Phase2 대상 아님.

---

## C. OPEN — 직원 현재 차단, parity-fix 필요 (★Phase2 2-A 핵심★)

| 테이블 | 카테고리 | 현재 직원 SELECT | RC | 조치 |
|---|---|---|---|---|
| health_q_results | 일반(설문지) | ❌ → ✅ (수정중) | OUTLIER `staff.user_id=auth.uid` | **ROW-0** — 20260611150000 마이그 작성됨, DB-gate 대기(point-fix) |
| health_q_tokens | 일반(설문지) | ❌ → ✅ (수정중) | 동일 OUTLIER | 20260611150000 동봉 |
| clinic_events | 일반(일정/이벤트) | ⚠ BROKEN | `staff.id=auth.uid` 비정규 신원 → staff 테이블 미연결 직원 0건 | parity-fix 후보: 정규 신원(`is_approved_user()+clinic_id`)로 전환 |
| check_in_room_logs | 일반(체크인 방 로그) | ⚠ BROKEN | `clinic_id IN (staff WHERE staff.id=auth.uid)` 동일 비정규 | parity-fix 후보: 정규 신원 전환 |
- C는 health_q와 **동일 RC(비정규 staff 신원 소스)** — 정규 패턴(`is_approved_user() AND clinic_id=current_user_clinic_id()`)으로 통일 후보.

---

## D. AMBIGUOUS — 게이트 확정 필요 (planner/supervisor 판정, 추정 금지)

| # | 테이블/메뉴 | 경계 질문 | 현재 직원 SELECT | 현재 FE |
|---|---|---|---|---|
| D-1 | payments | 환자 결제내역 = 매출집계(EXCL)? 일반 진료결제(OPEN)? | ✅ YES (`payments_read`+`approved_read`) | 차트/결제 동선 내 노출 |
| D-2 | package_payments | 동상 (패키지 결제내역) | ✅ YES | 패키지 동선 |
| D-3 | payment_code_claims / payment_codes / service_payment_codes | 수가코드 master는 config(일반)? 청구내역은 매출? | ✅ YES | 결제/수가 화면 |
| D-4 | payment_audit_logs | 결제 감사로그 = 매출집계/감사(EXCL)? | ✅ YES (`_open[ALL]`) | UI 직접 노출 없음(추정) |
| D-5 | insurance_receipts / insurance_documents | 실손보험 영수증·서류 = 환자 진료부수(OPEN)? 매출(EXCL)? | ✅ YES (PARITY) | 보험서류 화면 |
| D-6 | insurance_sync_runs | HIRA 동기화 실행로그 — 현재 admin/manager only | ❌ NO (MGMT_ONLY) | clinic 관리? |
| D-7 | daily_closings | **A-2와 중복**: 일마감=운영체크(OPEN)? 정산매출(EXCL)? | ✅ YES | closing route 직원 일부 노출 |
| D-8 | user_profiles / staff | 계정관리 페이지(EXCL)지만 이름표시용 프로필 read는 일반. SELECT parity 유지 vs 잠금? | ✅ YES (PARITY) | accounts=admin전용✓ / staff route=직원노출 |
| D-9 | chart_doctor_memos | 의사 비공개 메모 — 3카테고리 아님이나 임상 민감. open-all-except-3 적용 시 직원 개방? 현행 director/admin 유지? | ❌ NO (director/admin only) | doctor-tools |
| D-10 | medical_chart_signer_audit | 차트 서명 감사로그 — 감사로그=EXCL? 진료기록 부수(OPEN)? | ✅ YES (PARITY) | 차트 동선 |
| D-11 | consultation_notes | 상담노트 — RLS NO_SELECT_POLICY(staff·mgmt 모두 deny). 메뉴 사용처/접근경로 확인 필요(RPC?). 일반이면 SELECT 추가? | ❌ NO (전원 deny) | ? |
| D-12 | leads / tm_call_logs | TM/리드 — TM 도메인 경계 + NO_SELECT. 본 티켓(풋 CRM 메뉴) 범위 내인가? | ❌ NO | TM/도파민 연계 |

> **게이트 핵심**: D-1~D-5, D-7(매출 경계) 및 D-9, D-10(감사/민감) 오분류 시 PHI/매출 사고(AC-4 위반). 특히 D-7 daily_closings 는 **현재 직원이 SELECT 가능** → EXCL 확정 시 **회수(LOCK)** 가 필요한 유일한 역방향 조치라 우선 판정 요망.

---

## E. 비메뉴 / 통합 / 백업 (UI 메뉴 없음 → 조치 없음)

| 테이블 | 사유 |
|---|---|
| dopamine_callback_config / dopamine_callback_outbox | service_role 통합 테이블, UI 메뉴 없음 |
| dopamine_outbound_log | service_role only |
| nhis_idor_audit_logs | service_role only (IDOR 감사) |
| _backup_staff_user_id_20260426 | 백업 테이블 |
| _rollback_room_max_occ_20260602 | 롤백 백업 테이블 |

---

## Phase 1 게이트 요청 사항 (planner + supervisor)

1. **D-1~D-12 AMBIGUOUS 12건 EXCL/OPEN 확정** (특히 매출 경계 D-1~D-7, 민감 D-9/D-10).
2. **D-7 daily_closings LOCK 여부 확정** — 현재 직원 SELECT 가능. EXCL이면 staff SELECT 회수 + closing FE route에서 coordinator/therapist 제거 필요(역방향 조치, 운영 영향 검토).
3. **G-통계-1**: stats RoleGuard `part_lead`/`tm` 노출 — 제외 정책상 유지/차단 확정.
4. **D-8 user_profiles/staff**: 이름표시용 read parity 유지(권장) vs 계정관리 잠금 — 확정. (잠금 시 차트 담당자명 등 표시 회귀 위험 → 유지 권장 의견.)
5. **C 그룹 parity-fix 범위 확정**: clinic_events / check_in_room_logs 를 health_q와 동일 정규화 진행 승인.

게이트 통과(분류 확정) 후에만 Phase2 진입:
- **2-A (RLS)**: 확정 OPEN-수정필요(C) 테이블별 staff SELECT 정규화 SQL + 롤백 → supervisor DB게이트, 단계 적용.
- **2-B (FE)**: 확정 EXCL 메뉴(통계/매출집계/계정관리) 직원 숨김/비활성 + D-7 등 leak route 보정.

*작성: agent-fdd-dev-foot · v2 재분류(open-all-except-3) · READ-ONLY · 변경 0*
