---
id: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY
domain: foot
type: policy-audit
priority: P1
status: deploy-ready
e2e_spec: tests/e2e/T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY.spec.ts
e2e_spec_secondary: tests/e2e/T-20260611-foot-RLS-PARITY-G2-clinic-events.spec.ts
e2e_note: "우산 spec(티켓 ID 매칭) 4 tests = AC-PARITY/AC-5/AC-OUTLIER(G2 SELECT) + AC-4(쓰기 3정책 불변) + 정규헬퍼 SECURITY DEFINER + G1 NO-OP 보존. ★post-migration 회귀가드★ — 우산-1(AC-PARITY)은 supervisor 가 G2 마이그 20260611160000_clinic_events_select_rls_canonical.sql 를 DB-gate 에서 적용한 뒤 GREEN. 미적용 prod 에서는 by-design RED(기존 G2 evidence spec 와 동일 시퀀싱). 우산-2/3/4 는 현재 prod 에서 PASS. build exit 0."
build_verified: "bash scripts/build.sh 180 → exit 0 (dev-foot 2026-06-12 재확인)"
fix_request_resolved: "MSG-20260612-101318-i4nc(supervisor, phase2/spec_missing) — 티켓 ID 매칭 spec 신규 추가로 해소. e2e_spec_exempt 미사용."
db_change: true
gate: GO_WARN
owner: agent-fdd-dev-foot
created: 2026-06-11
phase: 2A
phase1_change: 0
phase2a_scope: C그룹 = G2(clinic_events) + G1(check_in_room_logs)
phase1_gate_v2: planner MSG-20260611-135000-b4sj 수신 — C그룹 GO / D-7 EXCL+LOCK(child) / S1·payments·part_lead HOLD(reporter)  ※D-7 = jnz7 정정으로 SUPERSEDE(아래 policy_correction_jnz7)
g1_decision: NO-OP 종결 확정 (planner MSG-20260611-144018-eih9 DECISION-REQUEST 판정) — room_logs_clinic_rw[ALL]=user_profiles 기반=read 이미 전 role parity. 별도 SELECT 추가=OR-merge no-op, [ALL] write 동반=AC-5 위반. Phase2-A 제외 + 'already-parity(무변경)' 재분류. 추가작업 0.
g1_status: WITHDRAWN (마이그 20260611170000_*.sql→.WITHDRAWN 회수, db-gate 증빙 WITHDRAWN 배너, supervisor 미적용)
g1_write_hardening_note: approved+active 게이트 부재는 user_profiles 스코프라 PHI 누수 없음 = 경미 over-permission. write-track P2 후보로만 기록(지금 강제변경 금지).
g2_status: submitted-awaiting-supervisor (GO 유지 — commit aaf48c9, planner eih9 GO 재확인)
clinic_events_write_finding: clinic_events insert/update/delete staff.id=auth.uid 비정규(write 전원 차단). G2 read 동일 RC. 우산 AC-5(write 불변) 위반→fold 금지→별도 트랙 분리.
spawned_children: [T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN (D-7 LOCK), T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL (P1 write canonical, planner eih9 발번)]
phase2a_final_scope: G2 clinic_events_select 단독 (G1 제외). 동결 해제(planner eih9).
ws2_child: T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN (D-7 ★SUPERSEDE★ — LOCK→OPEN 정정, revise db-gate 제출)
policy_correction_jnz7: 김주연 총괄 직접(§13.1.A reporter-authorized) — 일마감(daily closing workflow)=직원 업무=staff OPEN / 매출집계(실장별·치료사별 성과, 별도 /sales)=staff EXCL. D-7 verdict(daily_closings/closing_manual=EXCL+LOCK) SUPERSEDE. mig 20260611180000=WITHDRAWN, 20260611200000(canonical, over-open만 제거)으로 교체.
hold_reporter: D-1~D5 payments/package_payments/payment_codes/insurance · part_lead 통계 · D-9 chart_doctor_memos (reporter 김주연 답변 전 OPEN 금지)
db_gate_status: submitted-awaiting-supervisor
data_architect_consult: not-required (RLS only, no new column/table/enum)
policy_superseded_scoped_exception: "공간배정(room_assignments) WRITE 는 본 우산 AC-4(write=manager-only)의 scoped 예외 — T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM(can_assign_rooms, tm 제외, clinic 스코프, DELETE 미부여)이 소유. 본 우산은 READ parity, 공간배정 운영 WRITE 는 그 티켓으로 라우팅(§13.1.A reporter 예외, 김주연 총괄). DB-gate submitted 20260611220000."
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
| ~~**G1**~~ | `check_in_room_logs` | CheckInDetailSheet (대시보드) | **공유**(대시보드, 전 role) | ✅ `room_logs_clinic_rw[ALL]`=user_profiles 기반(=current_user_clinic_id 동등) | **아니오 (이미 parity)** | **★NO-OP 종결(planner eih9)★** Phase1 raw dump 가 OUTLIER 전제와 불일치 — read 이미 전 role parity 충족. 별도 SELECT 추가=no-op, [ALL] write 동반=AC-5 위반. **already-parity(무변경) 재분류. Phase2-A 제외.** (write 하드닝=P2 후보 기록만) |
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

---

## ★ Phase 2-A 진행 (dev-foot, planner 게이트 MSG-20260611-134442-gsgf 수신 후)

### G2 clinic_events — GO, DB-gate 제출 완료 (supervisor 대기)
- 마이그: `supabase/migrations/20260611160000_clinic_events_select_rls_canonical.sql` (+ `.rollback.sql`)
- dry-run: `scripts/T-20260611-foot-RLS-PARITY-G2-clinic_events_dryrun.mjs` → **PASS** (트랜잭션 적용→검증→ROLLBACK, prod 무변경)
- E2E: `tests/e2e/T-20260611-foot-RLS-PARITY-G2-clinic-events.spec.ts` (3 tests)
- 제출 패키지: `db-gate/T-20260611-foot-RLS-PARITY-G2-clinic_events_evidence.md`
- 변경: `clinic_events_select` USING `staff.id=auth.uid()` → `is_approved_user() AND clinic_id=current_user_clinic_id()`. SELECT 단독. 쓰기 3정책 불변(dry-run 검증).

### ★ Phase 1 게이트 v2 판정 (planner MSG-20260611-135000-b4sj — matrix v2/commit 422d1af 검토 후 확정. 본 테이블이 정본)

| # | 대상 | 판정 | 집행 |
|---|------|------|------|
| **C그룹** | clinic_events + check_in_room_logs | **GO Phase2-A** (canonical is_approved_user()+clinic) | G2 제출 완료 / G1 본 라운드 제출 (split canonical) |
| **D-7** | daily_closings + closing_manual | **EXCL 확정 + LOCK(회수) 우선** (역방향 누수=보안) | child `T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN` 으로 집행·db-gate 제출 |
| D-10 | medical_chart_signer_audit | **EXCL 확정** (감사로그, 보수 default) | 무변경(잠금 유지) |
| D-8 | user_profiles/staff 이름표시 | 표시용 read parity 유지(OPEN) + 계정 CRUD/권한설정 EXCL | 무변경(표시 read parity, 계정관리만 직원 잠금) |
| stats | tm 통계 | **잠금 확정** (통계=제외) | 기존 STAFF-ROLE-TM-ADD 매핑 유지(이미 stats 미포함) |
| view 10 / OPEN ~58 / health_q×2 | — | EXCL/무변경 / health_q 는 point-fix SURVEY-ITEM-VISIBILITY 흡수 | 무변경 |
| **HOLD(reporter)** | D-1~D5 payments/package_payments/payment_codes/insurance · part_lead 통계 · D-9 chart_doctor_memos | **reporter 김주연 확정 전 OPEN 금지** | planner batched DECISION-REQUEST 발행 — 답변 후 별도 NEW-TASK unblock |
| payment_audit_logs | — | EXCL 별도확정 (감사로그) | 무변경 |

> ⚠ payment_audit_logs / medical_chart_signer_audit = 감사로그 보수 EXCL. HOLD 3건은 reporter 답변 전 절대 OPEN 금지.

### ★★ G1 DECISION-REQUEST 판정 — NO-OP 종결 확정 (planner MSG-20260611-144018-eih9) ★★
planner 가 raw dump(`scripts/audit_out/T-20260611-RLS-PARITY_phase1_dump.txt`)를 직접 교차검증 후 dev-foot DECISION-REQUEST 를 수용·판정. (planner: "G1/G2 를 동일 RC 로 오기술한 것이 오류 — 정정 수용.")

- **판정: G1 check_in_room_logs = NO-OP 종결 확정.**
  - `room_logs_clinic_rw [ALL]` = user_profiles 기반(= `current_user_clinic_id()` 동등) → read 이미 전 role parity. G2(staff 기반)와 **신원소스 다름**.
  - read-parity surface 로는 fix 불요: 별도 SELECT 정책 추가 = OR-merge **no-op**, [ALL] write 동반수정 = 우산 **AC-5(write 불변) 위반**.
- **조치(dev-foot 집행 완료)**:
  - check_in_room_logs **Phase2-A 제외 + 매트릭스 'already-parity(무변경)' 재분류**. 추가 작업 0.
  - 제출했던 마이그 `20260611170000_check_in_room_logs_select_rls_canonical.sql`(+rollback) → **`.WITHDRAWN` 로 회수**(supabase db push 미적용). db-gate 증빙에 WITHDRAWN 배너 추가. **supervisor 미적용.**
  - write 하드닝(approved+active 게이트 부재)은 user_profiles 스코프 → PHI 누수 없음 = 경미 over-permission → **write-track P2 후보로만 기록(지금 강제변경 금지)**. (frontmatter `g1_write_hardening_note` 참조)

### ★ clinic_events 쓰기 비정규 부수발견 → 신규 child 발번 (planner eih9)
- 교차검증 확인: clinic_events insert/update/delete 3정책 전부 staff 기반 → **write 전원 차단(파손)**. G2 read 와 동일 RC.
- 우산 AC-5(write 불변) 위반이라 우산 Phase2-A 에 fold 금지 → **별도 write 트랙으로 분리**.
- **신규 티켓 `T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL` (P1, approved) 착수 완료** — canonical `is_approved_user()+clinic` 으로 write 3정책 정렬. dry-run PASS, db-gate 제출. supervisor 검수에서 write delta 명확 분리·표기.

### ★ Phase2-A 최종 범위 = G2 clinic_events_select 단독 (G1 제외). 동결 해제(planner eih9).

---

### (이력) G1 check_in_room_logs — 이전 라운드 GO 재게이트 후 제출 (planner b4sj) — ※위 eih9 판정으로 WITHDRAWN
**해소**: 이전 라운드(MSG-20260611-143552-2sqv) DECISION-REQUEST 의 전제 불일치(아래)를 planner 가 matrix v2 검토 후 **C그룹 canonical GO 재확정**.
- 마이그: `supabase/migrations/20260611170000_check_in_room_logs_select_rls_canonical.sql` (+rollback)
- dry-run: `scripts/T-20260611-foot-RLS-PARITY-G1-check_in_room_logs_dryrun.mjs` → **PASS** (단일 [ALL] 해체 / SELECT canonical / 쓰기 3정책 user_profiles 술어 보존)
- E2E: `tests/e2e/T-20260611-foot-RLS-PARITY-G1-check-in-room-logs.spec.ts` (3 tests)
- 증빙: `db-gate/T-20260611-foot-RLS-PARITY-G1-check_in_room_logs_evidence.md`
- 구현: 단일 `[ALL] room_logs_clinic_rw` 해체 → SELECT 만 canonical(`is_approved_user() AND clinic_id=current_user_clinic_id()`) + INSERT/UPDATE/DELETE 는 원 user_profiles 술어 보존(쓰기 byte-identical, AC-4).
- ⚠ **하드닝 성격 명시**: G1 은 G2 와 달리 read parity 가 이미 충족(전원 deny 아님)이었음 → 본 변경은 canonical 신원 정렬 + approved/active 게이트 하드닝. supervisor 적용 전 planner "하드닝 의도 맞음" 최종 확인 권고(증빙에 명기).

### (참고) 이전 라운드 G1 HOLD 사유 — planner DECISION-REQUEST 발행 (전제 불일치)
Phase 1 raw dump 가 planner 판정 전제(`staff.id=auth.uid` OUTLIER→전원 deny)와 **불일치**:
```
room_logs_clinic_rw [ALL] USING:
  (clinic_id IN (SELECT user_profiles.clinic_id FROM user_profiles WHERE user_profiles.id = auth.uid()))
```
- `user_profiles.id=auth.uid()` 기반 = `current_user_clinic_id()` 와 **기능적으로 동일** → read 이미 동작(전원 deny 아님). G2 와 신원 소스가 다름(check_in_room_logs=user_profiles / clinic_events=staff).
- 게다가 단일 `[ALL]` 정책 → SELECT 만 canonical 화 하려면 ① write 경로 동시 변경(AC-4 위반) 또는 ② permissive OR 로 no-op. READ parity 단독 surface 로는 깨끗이 안 됨.
- → **planner FOLLOWUP/DECISION 발행. 답변 전 동결.** (canonical 추가 가치는 approved+active 게이트뿐 — 이는 over-permissive write 하드닝 트랙 = WS 류에 가까움.)

### 부수 발견 (planner 보고 — 별도 티켓 권고)
- **clinic_events 쓰기 3정책(insert/update/delete)도 `staff.id=auth.uid()` 비정규** → 이벤트 생성/수정/삭제 깨질 소지. WS-1(form_templates write) 동류. READ parity 범위 밖 → 본 마이그 미접촉.

> 본 티켓은 db_change=true → **supervisor DB 게이트 적용 전까지 deploy-ready 마킹 금지.** signals 는 db-gate 제출만 기록.
