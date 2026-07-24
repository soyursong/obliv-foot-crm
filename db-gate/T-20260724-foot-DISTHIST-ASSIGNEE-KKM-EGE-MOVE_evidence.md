# T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE — MIG-GATE Evidence (ABORT / NO-OP)

- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
- **작성**: dev-foot / 2026-07-24
- **성격**: data-correction (mutable UPDATE 후보) · db_only · **AC-2 abort 가드 발동 → UPDATE 미실행**
- **표준**: data_correction_backfill_sop / cross_crm_write_rowcheck_standard / cross_crm_read_authctx_standard

## 결론 (한 줄)

**대상 8건은 이미 전부 엄경은 실장으로 귀속되어 있음.** freeze 결과 `check_ins.consultant_id=강경민` **0건**(기대 8) → AC-2 abort 가드 정상 발동 → 파괴적/무의미 UPDATE 미실행. planner FOLLOWUP 발행.

## 아키텍처 확정 (사전 코드조사)

- "배분이력 담당자(배정 실장)" 정본 store = **`check_ins.consultant_id`** (per-visit). 강경민·엄경은 = 둘 다 role=consultant(실장).
- 매출·실적 귀속(`foot_stats_consultant` RPC)은 `check_ins.consultant_id` 를 **read-time 파생**(ticketed_all CTE, `20260724130000` live). 별도 저장 귀속 컬럼 없음.
  → consultant_id 만 이동하면 매출·실적 귀속이 자동 소급 이동(Option A). payments/package_payments 원장 무접점.
- 배분이력 표시(`todayDistribution`)·배정목록(`assignmentListRows`)·직원별 누적 배정(`staffStats.assigned`) = 전부 `check_ins.consultant_id` 앵커. audit(`assignment_actions`)은 방식·토스/당김 표시용(현재 담당자 파생 안 함).

## 인증 컨텍스트 (read authctx 표준)

- 모든 조회 = **service_role** 키(RLS 우회, 실 데이터 관측). 0-row 오독(anon RLS) 아님.

## freeze / abort (SELECT-only)

스크립트: `scripts/T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE_freeze.mjs`
freeze 스냅샷: `scripts/T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE_FREEZE.json`

| 값 | 확정 |
|----|------|
| clinic | 오블리브의원 서울오리진점 `74967aea-a60b-4da3-a0e7-9c997a930bc8` (slug jongno-foot) |
| 강경민(from) | `6ab26d9f-fd10-4042-9fd7-076f277be5d4` role=consultant active |
| 엄경은(to) | `b311593d-9e46-4ac8-9424-6b0fa1689a06` role=consultant active |
| 김주연(sibling test-del) | `10eacaa8-fa6b-4615-8bf1-02b4f49cb6ed` |

대상 8건 `check_ins` 현재 `consultant_id` (전수 = 엄경은):

| # | 고객 | 배정일 | chart | check_in_id | 현재 consultant_id |
|---|------|--------|-------|-------------|---------------------|
| 1 | 엄상욱 | 7/24 | F-5057 | 976e2667-7d75-4c09-95e2-b6faa7d3a14d | **엄경은** |
| 2 | 김종민 | 7/22 | F-4568 | c391f00b-c3ba-4860-9d15-d4a7f03bba0f | **엄경은** |
| 3 | 오정길 | 7/17 | F-4850 | 378e528e-1d2f-4d6e-9eea-a2147ef05643 | **엄경은** |
| 4 | 이민태 | 7/17 | F-4552 | 87411a19-6d65-4ea3-98bf-9b38348b2607 | **엄경은** |
| 5 | 최강선 | 7/17 | F-4825 | 87426961-d3f0-4a4d-bae3-b5da9ee3c7ce | **엄경은** |
| 6 | 백영호 | 7/14 | F-4533 | 9b0daa11-f720-4719-afa2-61565f1b1613 | **엄경은** |
| 7 | 이재성 | 7/14 | F-4702 | 2f6b0e7c-0e75-4ec9-a508-c3ef0bee0c1c | **엄경은** |
| 8 | 이멋진 | 7/14 | F-4642 | e05cce94-5cc8-4c85-8f34-3355fd7c710c | **엄경은** |

- `freeze(consultant_id=강경민)` = **0건** ≠ 8 → **ABORT**.
- 지문 대조: 이민태(F-4552, DESIGNPT-RESET-R2)·이멋진(F-4642) 모두 실 환자(status=done, 실 chart, 실 therapist·package 존재) — test row 아님. 8건 전부 `visit_type=new`, `status=done`.
- 김주연 test-del disjoint: 8건 중 consultant_id=김주연 **0건** (구조적 disjoint 재확인 OK).

## 강경민 잔존 흔적 (forensic)

스크립트: `scripts/T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE_forensic.mjs`

| surface | 강경민 잔존 | 판정 |
|---------|-------------|------|
| `check_ins.consultant_id` | 0/8 | 이미 엄경은 (배분이력·배정목록·누적·매출/실적 전부 엄경은) |
| `check_ins.therapist_id` | 0/8 | 강경민=실장(치료사 아님) |
| `check_ins.assigned_counselor_id`(legacy) | 0/8 (전부 NULL) | 무관 |
| `customers.assigned_consultant/counselor_id`(default) | 0/8 | go-forward 기본값 축 — 티켓 범위 아님, 무관 |
| `assignment_actions`(audit) | to=강경민 8 · from=강경민 6 | **append-only 감사이력** — 실제 발생(auto-assign→toss)을 기록. 정정하면 이력 위조 → 무변경(SOP: 원장/감사 무접점) |
| `packages.consultant_id` | **1건** (김종민 pkg `aa11252f`) | heuristic 스냅샷 컬럼, **live read 경로 없음**(RPC는 check_ins 파생). DA-20260718 Q4 "populated⟺fact" 관할 — 잔존 정정 판단은 planner/DA 라우팅 |

### 사건 재구성 (audit 기반)

신규 상담실장 강경민(계정 7/14 생성, T-...ACCOUNT-KGMIN-CREATE) → 월초 부하 최소 → 자동배정(least-loaded)이 반복 선택 → 현장이 방문 당일 수동 토스 강경민→엄경은. 6건은 toss 로그 존재, 2건(김종민 7/22·엄상욱 7/24)은 로그 없이 consultant_id 만 엄경은(비로그 경로). **결과: 8건 전부 현재 엄경은 = 이동 목표 상태 이미 도달.**

## 매출·실적 before 스냅샷 (7/14~7/24, foot_stats_consultant)

| 실장 | ticketing | package | total_amount | 상담고객 |
|------|-----------|---------|--------------|----------|
| 강경민 | 34 | 6 | ₩7,970,400 | 34 |
| 엄경은 | 41 | 17 | ₩32,362,110 | 41 |

→ 대상 8건은 이미 엄경은 total_amount/ticketing 에 포함(check_ins 파생). 강경민 잔여 수치는 이 8건과 무관한 별개 실적.

## MIG-GATE evidence 4필드

- **mig_files**: `scripts/..._freeze.mjs`, `scripts/..._forensic.mjs`, `scripts/..._FREEZE.json`, 본 evidence.md (SELECT-only, apply/rollback 미생성 — UPDATE 미실행)
- **mig_dryrun**: freeze/forensic SELECT-only 실행 완료. 대상 write 0건(no-op) — dry-run == 실행 (파괴 0).
- **mig_ledger_check**: rows-affected 검증 대상 UPDATE 없음(0-row 성공오인 회피 = 애초에 write 미발생). payments/package_payments 원장 무접점.
- **mig_rollback**: write 없음 → 롤백 대상 없음. (원값 스냅샷은 FREEZE.json 에 보존 — 향후 planner가 잔존 정정 승인 시 apply/rollback 신규 작성)

## 조치

1. **check_ins UPDATE 미실행** (freeze 0≠8 abort). deploy-ready **미마킹** (이동 발생 안 함).
2. planner FOLLOWUP(`freeze_mismatch_already_moved`) 발행 — 8건 이미 엄경은 확정 + 잔존 2건(audit 이력 / packages 1건) 처리 판단 요청.
