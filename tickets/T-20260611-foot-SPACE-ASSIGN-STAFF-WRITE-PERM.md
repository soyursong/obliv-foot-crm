---
id: T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM
domain: foot
priority: P2
status: deploy-ready
phase1_finding: "차단 = 백엔드 2지점(RPC save_room_assignments is_admin_or_manager 가드 + room_assignments RLS INSERT 부재/UPDATE role 갭). FE 게이트 아님 → FE 무변경, 백엔드 최소 변경."
db_gate_status: applied  # MSG-20260618-183721-yrgz(supervisor FIX-REQUEST) 승인 하에 QA/테스트 Supabase(rxlomoozakkjesdqjtvd) 적용 완료 2026-06-18
data_architect_consult: not-required  # RLS + 기존 RPC 본문 술어 교체만, 신규 컬럼/테이블/enum 0
recur5_dep_check: "Phase B 93c336f main 머지 확인 완료 → carry-over/미터치방 보존 패턴 위에 권한만 확대"
artifacts:
  migration: supabase/migrations/20260611220000_room_assignments_staff_write_scoped.sql
  rollback: supabase/migrations/20260611220000_room_assignments_staff_write_scoped.rollback.sql
  dryrun: scripts/T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM_dryrun.mjs  # PASS
  e2e: tests/e2e/T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE.spec.ts
  evidence: db-gate/T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM_evidence.md
  apply: scripts/T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM_apply.mjs  # APPLY+영속검증 PASS
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-18
deploy_commit: 158ce760
commit_sha: 158ce760
qa_result: "pass — Playwright E2E 7/7 PASS (S1/S2 RPC can_assign_rooms 가드 교체+is_admin_or_manager 제거 / AC-2 헬퍼 운영8role·tm제외 / S4 clinic 스코프 / S3 AC-3·AC-5 DELETE 미부여·blanket 미번짐 / S5 RECUR5 원자 본문 보존 / AC-7 admin·approved_read·floor staff 회귀0). 마이그 20260611220000 적용 후 영속검증 9/9 PASS."
field_soak_gate: "실 Galaxy Tab — 직원(coordinator/therapist 등 운영 role) 로그인 → 직원·공간 > 공간배정에서 방 배정·재배정·unassign 저장 성공+F5 영속(권한차단 안내 미발생) + tm 계정은 공간배정 화면 미접근 유지 + 관리자 기존 동작 회귀0 + 김주연 총괄(U0ATDB587PV) 현장 confirm (최종 게이트)"
summary: "[권한] 김주연 총괄 — 직원·공간 > 공간배정(상담/치료/레이저)에서 직원(staff) 계정이 권한 막혀 수정/반영 불가, 관리자만 가능. 운영상 직원도 방 배정·재배정을 할 수 있어야 함 → space assignment WRITE 권한을 staff(coordinator/therapist 등 운영 role)에 부여. ★단 PHI/민감영역 아닌 '공간배정' 한정(blanket write-open 금지) + RLS-MENU-ROLE-PARITY-POLICY(READ-only parity)의 write-manager-only 기조에 대한 scoped 예외 + 활성 P0 SPACE-RESET-RECUR5 write-path와 정합(신규 write 경로가 reset 재발 유발 금지)."
field_summary: "지금 공간배정(상담실/치료실/레이저실) 화면에서 직원 계정은 권한이 막혀 관리자만 배정을 바꿀 수 있는데, 직원도 방 배정·변경을 할 수 있게 권한을 열어주는 작업이에요. 다만 공간배정만 열고 급여·정산 같은 민감한 건 그대로 두며, 지금 고치는 중인 '배정 풀림(RECUR5)' 문제와 어긋나지 않게 맞춰서 진행해요."
block_reason: null
pending_owner: null
pending_owner_slack_id: null
pending_question: null
pending_since: null
reminder_count: 0
escalated_to_ceo: false
hotfix: false
db_change: true
db_change_reason: "공간배정 write 차단이 RLS(INSERT/UPDATE)에서 막혀 있으면 staff role에 space assignment 대상 테이블(room_assignments / daily_room_status 등 방배정 write 경로)의 INSERT/UPDATE 정책을 추가해야 함 → ★supervisor DB 게이트 필수. 단 (a)clinic_id 스코프 유지 (b)공간배정 관련 테이블 한정(blanket write-open 금지, 급여/정산/감사로그 제외) (c)DELETE는 부여하지 않음(배정 해제는 UPDATE/unassign 경로로). 차단 원인이 FE 메뉴/버튼 gating일 수도 있으니 Phase1에서 RLS vs FE-gate 먼저 판별 후 최소 변경."
regression_risk: high
repo_path: "/Users/domas/Documents/GitHub/obliv-foot-crm"
build_cmd: "npm run build"
created: 2026-06-11 11:25
deadline: 2026-06-16
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1781143800.194409   # back-filled via dup MSG-20260611-112840-kyca(2026-06-11 11:28, 동일 reporter/feature 재보고가 thread 제공). 배포 완료 reporter 멘션·FOLLOWUP용. 인접 thread = RECUR5 1781140402.642539
dup_of_source_msg: MSG-20260611-112840-kyca   # kyca = agjr 재보고(중복). 신규 티켓 미발번, 본 티켓으로 dedup.
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
assignee: dev-foot
source_msg: MSG-20260611-112301-agjr
depends_on:
  - T-20260611-foot-SPACE-RESET-RECUR5    # ★활성 P0 (Phase B B-GO granted). 공간배정 write-path 정합 필수 — staff write를 RECUR5 머지/null-row 보존 패턴 위에 얹어 reset(RECUR6) 재발 방지. RECUR5 Phase B 머지 후 착수 권장.
related:
  - T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY   # P1 — READ parity 우산. AC-4가 write는 manager-only(쓰기 풀리면 qa-fail). 본건은 그 기조에 대한 '공간배정 한정' scoped write 예외.
  - T-20260602-foot-DASH-CUSTMOVE-STAFF-RESET      # 고객 이동 시 staff reset — 방배정 write 경로 인접
e2e_spec_exempt_reason: null
risk_verdict: GO_WARN
risk_reason: "리스크 5항목 — (1)DB스키마: YES(차단이 RLS면 space assignment 테이블 staff INSERT/UPDATE 정책 추가) → ★supervisor DB게이트 의무. Phase1에서 RLS vs FE-gate 판별 선행. (2)외부의존: NO. (3)비즈로직: HIGH — 권한(role) write 개방은 (a)PHI/민감영역 blanket write-open 위험 (b)활성 P0 SPACE-RESET-RECUR5의 write-path를 staff에도 노출 → 신규 write 경로가 reset 재발(RECUR6) 유발 위험 (c)parity 정책 write-manager-only 기조와의 정합. → 공간배정 테이블 한정 + clinic_id 스코프 + DELETE 미부여 + RECUR5 머지 패턴 위 구현. (4)대량데이터: NO. (5)신규패키지: NO. → GO_WARN(DB게이트 + 범위한정 + RECUR5 의존 정합). 급여/정산 등 민감 write가 함께 열리면 BLOCK 격상."
conflict_detail:
  scan_sources:
    - "board 진행티켓(권한/공간배정 축): T-20260611-foot-SPACE-RESET-RECUR5(approved/Phase B B-GO, P0 — 공간배정 reset), T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY(approved, P1 — READ parity 우산, AC-4 write=manager-only), T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE(approved, READ point-fix), T-20260602-foot-DASH-CUSTMOVE-STAFF-RESET(field-soak, 방배정 write 인접). 동일 reporter(김주연 총괄)·동일 축(role 권한 × 공간배정)에서 open/approved 티켓 ≥2 → REDEFINITION_RISK 발동."
    - "RLS-MENU-ROLE-PARITY-POLICY AC-4 정책 대조: 'staff는 SELECT만 확대, INSERT/UPDATE/DELETE 기존 정책 불변(쓰기 풀리면 qa-fail)'. 본건은 그 정책에 대한 **직접적 write 개방 요청** = 정책/canon 텍스트와 표면 충돌. ★단 parity 정책은 'PHI/공유메뉴 READ parity'가 본질이고 write-manager-only는 PHI-safety 기본값이었음. 공간배정은 운영(operational, non-PHI) 데이터 → 운영 role(coordinator/therapist)의 공간배정 write는 PHI 노출 확장이 아님. 따라서 destructive policy-overwrite가 아니라 '공간배정 한정 scoped 예외'로 해석 — 단 §13.1.A 정책 덮어쓰기 절차상 reporter(=정책 owner 본인)의 명시 요청으로 충족(아래 redefinition_note)."
    - "cross_crm_data_contract: staff role 8종 표준 — role enum 미접촉(기존 role에 write 정책 부여). room_assignments today-row 스냅샷 머지 규약(null staff_id row 보존)은 RECUR5 핵심 — staff write 추가가 이 규약 위반 금지. 충돌 없음(준수 의무)."
    - "cue_card_policy: 무관(내부 CRM 운영 권한, 풀퍼널 큐카드 미접촉)."
    - "dependency §7: SPACE-RESET-RECUR5 write-path(handleSave/handleWeekAssign/Dashboard.handleStaffAssign + read carry-over) 와 직접 겹침 — staff write 개방은 그 경로들에 staff 사용자를 추가 노출. RECUR5 Phase B 머지(room별 prior-latest carry-over + 미터치방 보존) 위에 구현해야 reset 재발 없음. ★착수 순서: RECUR5 Phase B 우선."
    - "dev_ops_policy 환경매트릭스: foot prod=obliv-foot-crm 표준. 충돌 없음."
  same_subject_open_tickets:
    - "T-20260611-foot-SPACE-RESET-RECUR5 (P0/Phase B B-GO) — 동일 feature(공간배정). 본건 write 개방은 그 write-path 위에 얹힘 → 하드 의존."
    - "T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY (P1) — 동일 축(role 권한). READ parity vs 본건 WRITE 개방 = 표면 충돌, scoped 예외로 reconcile."
    - "T-20260602-foot-DASH-CUSTMOVE-STAFF-RESET (field-soak) — 방배정 write 인접."
  redefinition_risk: true
  redefinition_note: "⚠ REDEFINITION/PING-PONG 수렴 신호. role 권한 × 공간배정 축에서 동일 reporter(김주연 총괄)가 같은 날 다발 요청(parity READ / RECUR5 reset / 본건 staff WRITE). §13.1.A 정책 덮어쓰기 절차: 본건은 parity AC-4(write=manager-only)에 대한 표면 덮어쓰기지만 — (1)reporter(U0ATDB587PV)가 곧 그 parity 정책의 owner이며 (2)'직원도 공간배정 수정 가능해야' 명시 요청 → §13.1.A reporter 예외 충족(blocked/DECISION-REQUEST 불요). 단 parity 정책과의 정합을 위해 본건은 'parity는 READ, 공간배정 운영 write는 별도 scoped 예외'로 명문화하고 parity 티켓 policy_superseded에 cross-link(향후 '공간배정 직원 write' 단건은 본 티켓으로 라우팅). 운영 데이터(non-PHI) 한정 — 급여/정산/감사로그 write는 절대 동반 개방 금지."
  policy_reconciliation: "parity(READ-only) ∧ 본건(공간배정 WRITE) 는 상호 배타 아님: parity 우산은 'PHI/공유메뉴 조회 parity', 본건은 '운영 feature(공간배정) write 권한'. dev-foot는 RLS 변경 시 SELECT parity(parity 티켓 소관)와 INSERT/UPDATE write(본건 소관)를 분리 적용 — 본건이 다른 민감 테이블 write를 동반 개방하지 않도록 테이블 스코프 명시."
  verdict: "approved(P2, db_change=true). reporter(정책 owner) 명시 요청 → §13.1.A 예외로 blocked 불요. ⚠조건: (a)Phase1 RLS vs FE-gate 판별 선행, (b)공간배정 관련 테이블 한정 write(blanket 금지·DELETE 미부여), (c)활성 P0 RECUR5 Phase B 머지/null-row 보존 패턴 위에 구현(착수 순서 RECUR5 우선), (d)RLS 변경 시 supervisor DB게이트, (e)parity 티켓과 cross-link(scoped 예외 명문화)."
handoff_needed:
  - "responder: origin thread_ts 확보(배포 완료 reporter 멘션용) + (선택) 직원 write 대상 role 범위 현장 확인(coordinator/therapist 전부 vs 특정 role)."
---

# T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM — 공간배정 직원(staff) write 권한 부여 (scoped)

## 1. 현장 요청 (origin)

> 김주연 총괄 (U0ATDB587PV / #project-doai-crm-풋확장 C0ATE5P6JTH / MSG-20260611-112301-agjr, 2026-06-11 11:23)
> "지금 공간 배정건도 직원 계정은 권한 막혀있음 관리자만 수정 반영 가능함"

직원·공간 > 공간배정(상담실/치료실/레이저실) 화면에서 **직원(staff) 계정은 권한이 막혀 배정 수정/반영 불가, 관리자(admin/manager)만 가능**. 운영상 직원도 방 배정·재배정을 해야 하므로 **공간배정 write 권한을 staff(운영 role)에 부여** 요청. "건도" = parity·reset 등 동일 축 다발 보고의 연장선.

## 2. CONFLICT-DETAIL (§13.1.A) — 요약

- **REDEFINITION_RISK = true.** 동일 reporter·동일 축(role 권한 × 공간배정)에서 같은 날 다발 티켓(parity READ / RECUR5 reset / 본건 staff WRITE). frontmatter `conflict_detail` 참조.
- **parity 정책(AC-4 write=manager-only)과 표면 충돌** → 하지만 (a)reporter가 정책 owner 본인, (b)명시 요청 → **§13.1.A reporter 예외**로 `approved`(blocked/DECISION-REQUEST 불요). parity는 READ parity, 본건은 운영 feature WRITE = **scoped 예외**로 reconcile, parity 티켓에 cross-link.
- **활성 P0 SPACE-RESET-RECUR5 와 하드 의존**: staff write 개방은 RECUR5 write-path에 staff 사용자를 노출 → RECUR5 Phase B 머지(room별 prior-latest carry-over + 미터치 방 보존) 위에 구현해야 reset 재발(RECUR6) 방지. **착수 순서: RECUR5 Phase B 우선.**

## 3. ⚠ 범위 한정 (절대 준수)

- **포함**: 공간배정(상담실/치료실/레이저실 방 배정·재배정·unassign) 관련 write 경로 한정으로 staff(coordinator/therapist 등 운영 role) INSERT/UPDATE 허용.
- **제외(blanket write-open 금지)**: 급여/정산/감사로그/관리자 전용 화면 등 민감 테이블 write는 **동반 개방 금지**. DELETE(행 삭제) 권한 부여 금지 — 배정 해제는 UPDATE/unassign 경로로.
- **clinic_id 스코프 유지** — staff는 자기 clinic 범위 방배정만 write(타 clinic write 불가).
- RLS SELECT parity는 별도 티켓(RLS-MENU-ROLE-PARITY-POLICY) 소관 — 본건은 **write**만 다룸.

## 4. 수용 기준 (AC)

### Phase 1 · 차단 원인 판별 (read-only 진단)
- [ ] **AC-1**: 직원 계정의 공간배정 수정 차단이 **(a) RLS INSERT/UPDATE 정책에서 막힘인지 (b) FE 메뉴/버튼 권한 gating인지 (c) 둘 다인지** 특정. 최소 변경 경로 확정 후 진행(불필요한 RLS 변경 회피).

### Phase 2 · staff write 권한 부여 (확정 경로만)
- [ ] **AC-2**: 직원(staff 운영 role) 계정이 공간배정(상담/치료/레이저 3타입) 방 배정·재배정·unassign을 **수정/반영 가능**. 저장 후 새로고침/대시보드에서 영속(저장 성공).
- [ ] **AC-3 (범위 한정 회귀가드)**: 이 변경으로 급여/정산/감사로그 등 **민감 테이블 write가 함께 열리지 않음**. 공간배정 관련 테이블 한정. (위반 시 qa-fail / BLOCK 격상)
- [ ] **AC-4 (clinic 스코프)**: staff write는 자기 clinic_id 범위 방배정만. 타 clinic 방배정 write 불가.
- [ ] **AC-5 (DELETE 미부여)**: staff에 행 DELETE 권한 미부여. 배정 해제는 UPDATE/unassign으로.
- [ ] **AC-6 (RECUR5 정합 — 의무)**: staff write 경로가 **RECUR5 Phase B 머지 패턴(미터치 방 보존·null-row 보존·room별 prior-latest carry-over)** 위에 구현되어, staff 저장이 다른 방 배정을 blind-overwrite하거나 reset(풀림)시키지 않음. **RECUR5 Phase B 머지 후 착수 권장** — 미머지 상태에서 write 개방 시 RECUR6 위험.
- [ ] **AC-7 (admin 회귀)**: 기존 관리자 공간배정 write 동작 회귀 0.

## 5. 현장 클릭 시나리오 (E2E 변환 가이드)

### 시나리오 1: 직원 공간배정 저장 (정상 동선)
1. **직원 계정** 로그인 → /admin → "직원" 메뉴 → "공간" 탭
2. 상담실=직원A 배정 → 저장 → 완료 토스트 (권한 차단 안내 미발생)
3. 새로고침(F5) → 상담실=직원A 영속(저장 성공·풀림 없음)

### 시나리오 2: 직원 unassign (배정 해제)
1. 직원 계정에서 배정된 방을 미배정으로 변경 → 저장 → 반영 확인 (행 삭제가 아니라 상태 UPDATE)

### 시나리오 3: 범위 한정 회귀가드 (민감 write 미개방)
1. 직원 계정에서 급여/정산 등 민감 메뉴 write 시도 → 여전히 차단(이 작업으로 새로 열리지 않음)

### 시나리오 4: clinic 스코프 (PHI/권한 회귀가드)
1. 직원 계정이 자기 clinic 범위 방배정만 write, 타 clinic write 불가 확인

### 시나리오 5: RECUR5 정합 (미터치 방 보존)
1. 직원이 일부 방만 변경 저장 → 미터치 방·다른 사용자 배정 persist(풀림/blind-overwrite 없음)

## 6. 처리 메모 (planner)

- ★착수 순서: **활성 P0 SPACE-RESET-RECUR5 Phase B(B-GO granted) 우선 머지** 후 본건 착수 권장. 동시 진행 시 staff write 경로를 RECUR5 머지 위에 얹어 reset 재발 차단.
- 차단 원인이 **FE-gate 단독**이면 RLS 무변경 → supervisor DB게이트 비대상(FE 권한만). **RLS write 정책 추가 동반 시 supervisor DB게이트 의무**(SQL 초안 + 롤백 SQL).
- parity 티켓(RLS-MENU-ROLE-PARITY-POLICY)에 본건 cross-link: parity=READ parity, 본건=공간배정 운영 WRITE scoped 예외. 향후 "공간배정 직원 write" 단건 요청은 본 티켓으로 라우팅.
- UI 변경 동반 → E2E 5시나리오 + 실제 브라우저 렌더 확인 의무(단계별 브라우저 테스트 정책).
- origin MSG에 thread_ts 미포함 → responder가 back-fill(배포 완료 reporter 멘션·FOLLOWUP용).
