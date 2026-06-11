---
id: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY
domain: foot
type: policy-audit
priority: P1
status: phase1-gate
db_change: true
gate: GO_WARN
owner: agent-fdd-dev-foot
created: 2026-06-11
phase: 1
phase1_change: 0
---

# T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY — RLS 메뉴-역할 패리티 정책 (전수감사 우산)

## 정책 (김주연 총괄 escalation)
> "권한 풀린(관리자·직원 모두 메뉴 진입 가능) 메뉴는 그 안의 데이터 조회도 manager=staff 동일 보장."
> 건바이건 point-fix 중단. audit-first. blanket-open 금지.

연계: point-fix `T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE`(health_q_results/tokens)는 별개 즉시 진행,
본 우산이 그 결과를 1행으로 흡수(아래 ROW-0). `STAFF-ROLE-TM-ADD`(deployed) 권한 매핑은 menu→role SSOT(`src/lib/permissions.ts`)와 dedup.

---

## Phase 1 — 전수감사 결과 (READ-ONLY, 변경 0)

### 방법
- DB측: `scripts/T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY_phase1_audit.mjs` (READ-ONLY, 직접 pg `pg_policies`/`pg_class`)
  → 97 base table + 11 view 의 SELECT 정책을 6분류(OPEN / PARITY / TIER / MGMT_ONLY / OUTLIER / OTHER·NO_SELECT_POLICY·RLS_OFF).
  raw USING 덤프: `..._phase1_dump.mjs`. 산출물: `scripts/audit_out/T-20260611-RLS-PARITY_phase1_{audit,dump}.txt`.
- FE측: `src/lib/permissions.ts`(PERM_MATRIX) + `src/App.tsx`(RoleGuard) = 메뉴→역할 SSOT. 표 매핑은 `.from('<table>')` grep.

### 신원 헬퍼 기준 (parity 판정 근거)
- **정규(parity)**: `is_approved_user()` / `current_user_clinic_id()` / `get_user_clinic_id()` / `is_floor_staff()` / user_profiles EXISTS(approved+active) → 전 직원(approved) 동일 read. **manager=staff.**
- **mgmt 한정**: `is_admin_or_manager()` / `current_user_role() IN (admin,manager,director)` → 관리자만.
- **비정규 OUTLIER**: `staff.user_id = auth.uid()` 또는 `staff.id = auth.uid()` → 로그인 신원은 user_profiles 인데 staff 매칭은 희소 → 사실상 deny(직원·다수 관리자 0건). ★health_q 버그와 동일 RC 패밀리.★

### 분류 집계 (97 base table)
| 분류 | 수 | parity 의미 |
|---|---|---|
| OPEN (true/authenticated) | 46 | 전원 read (over-parity 포함) ✓ |
| PARITY (is_approved_user/clinic-isolation 단독) | 22 + OTHER 중 13 | manager=staff ✓ |
| TIER (consultant/coord/therapist 티어) | — | 메뉴 게이트와 정렬 시 의도적 |
| **OUTLIER (비정규 신원)** | **4** | ★점검 대상★ |
| **MGMT_ONLY (관리자 한정 SELECT)** | **2** | 메뉴 공유 시 gap 후보 |
| NO_SELECT_POLICY (deny-all) | 7 | FE 미참조 시 제외 |

> OTHER(19) 중 13건은 clinic-isolation SELECT(role gate 없음)로 **사실상 PARITY** — 휴리스틱 미인식일 뿐 패리티 충족.
> (clinic_dashboard_layouts, clinic_memos, customer_special_notes, customer_treatment_memos, duty_roster,
>  form_submissions, medical_charts, notification_logs/opt_outs/templates, package_progress_plans,
>  patient_room_daily_log, reservation_registrars, clinic_messaging_capability, service_menu_order)

---

## ★ Phase 1 매트릭스 — 게이트 판정 필요 항목

| # | 테이블 | 읽는 메뉴 (FE) | 메뉴 공유? | 현재 staff SELECT | parity 필요 | 분류·비고 |
|---|---|---|---|---|---|---|
| **ROW-0** | health_q_results / health_q_tokens | 차트>발건강질문지 패널 | **공유**(chart, 전 role) | ✅(point-fix 후 정상) | **완료** | point-fix 마이그 `20260611150000` → `is_approved_user()+clinic`. 본 우산 흡수. |
| **G1** | `check_in_room_logs` | CheckInDetailSheet (대시보드) | **공유**(대시보드, 전 role) | ❌ `staff.id=auth.uid()` OUTLIER → 전원 deny | **예 (파리티)** | INSERT 는 Dashboard 에서 발생하나 SELECT 가 비정규 → 직원·관리자 모두 0건. canonical 전환 후보. |
| **G2** | `clinic_events` | ClinicCalendar (대시보드 사이드바) | **공유**(대시보드, 전 role) | ❌ `staff.id=auth.uid()` OUTLIER → 전원 deny | **예 (파리티)** | 일정 이벤트. 동일 OUTLIER RC. canonical 전환 후보. |
| **S1** | `chart_doctor_memos` | MedicalChartPanel (차트) | 공유(차트는 전 role 진입) | admin/director 한정 read | **판정필요** | 원장 임상 메모 — 의도적 제한일 가능성↑. **민감/제외 후보**. 총괄·supervisor 확정 요청. |
| **S2** | `insurance_sync_runs` | InsuranceStatusTab → `clinic-management` | **비공유**(MGMT 메뉴: admin/manager/director) | admin/manager 한정 read | 아니오 | 메뉴 자체가 MGMT 전용 → 정책 정렬됨. **제외**(gap 아님). |
| **G3** | `consultation_notes` `leads` `tm_call_logs` | — (FE `.from()` 미참조) | n/a | deny-all (정책 0건) | 아니오 | 메뉴 미참조 → parity 무관. **제외**. (tm_call_logs 는 향후 TM 집계 연결 시 재검토) |
| — | `dopamine_callback_config/outbox`, `_backup_*`, `_rollback_*` | — (백엔드/하우스키핑) | n/a | deny/service-role | 아니오 | **제외**(FE 데이터 아님). |

### 부수 발견 (READ 파리티 범위 밖 — 별도 티켓 권고, 본 우산 변경 X)
- **WS-1 `form_templates` manage[ALL] OUTLIER** — 쓰기 정책이 비정규 신원 → 관리자 쓰기 깨질 소지. (SELECT 은 OPEN 으로 read 정상). → 별도 write-path 티켓.
- **WS-2 `daily_closings_read USING true`** — 미승인 authenticated 도 read 가능(over-open). 파리티는 충족(오히려 과잉)이나 최소권한 위배. → 별도 하드닝 티켓.

---

## Phase 1 게이트 (이 검토 전 RLS 변경 절대 금지)
planner + supervisor 가 아래를 확정해야 Phase 2 진입:
1. **G1 check_in_room_logs / G2 clinic_events** → parity-fix 대상 확정? (canonical `is_approved_user() AND clinic_id=current_user_clinic_id()` 전환)
2. **S1 chart_doctor_memos** → 의도적 민감 제외(admin/director only 유지) vs parity 편입? ★원장 메모 성격상 제외 권고, 총괄 판단 요청★
3. G3/제외군 → 동의 여부.

## Phase 2 (게이트 통과 후 — 미착수)
확정 대상만 테이블별 staff SELECT 추가 + 마이그 + rollback SQL → **supervisor DB 게이트**.
회귀가드 의무: **AC-4** staff READ-only(INSERT/UPDATE/DELETE 불변) · **AC-5** clinic_id 스코프 유지 · **AC-6** 비공유·민감 테이블 보존(blanket-open 미발생).

## Phase 3 (초안만 — data-architect 핸드오프)
신규 메뉴/테이블 RLS 컨벤션: "메뉴가 비-mgmt staff 에 열리면 그 테이블 SELECT 는 `is_approved_user() AND clinic_id=current_user_clinic_id()` 정규 패턴 의무." codify 는 dev-foot 권한 밖 → data-architect 로 초안 핸드오프.
