# T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE — MIG-GATE Evidence (ABORT / 대상 부재·의미불일치)

- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
- **작성**: dev-foot / 2026-07-24
- **성격**: data-correction (mutable UPDATE 후보) · db_only · **AC-2 abort 가드 발동 → UPDATE 미실행**
- **표준**: data_correction_backfill_sop / cross_crm_write_rowcheck_standard / cross_crm_read_authctx_standard

## 결론 (한 줄)

**요청 대상 "담당자='백범석'" 은 매칭 0건. `백범석` 은 담당자(상담실장/consultant)가 아니라 고객(환자)이다.**
freeze 결과 `check_ins.consultant_id = 백범석 staff` = **0건**(애초에 백범석이라는 staff 자체가 없음) → AC-2 abort 가드 정상 발동 → UPDATE 미실행. **planner FOLLOWUP(의미 불일치, 현장 재확인 필요)**.

## 아키텍처 확정 (sibling KKM-EGE 코드조사 계승)

- "배분이력 담당자(배정 실장)" 정본 store = **`check_ins.consultant_id`** (per-visit).
- 매출·실적 귀속(`foot_stats_consultant` RPC)은 `check_ins.consultant_id` 를 **read-time 파생**. 별도 저장 귀속 컬럼 없음.
  → **foot 에는 "배분이력 담당자 field 만 이동 / 매출·실적 귀속은 hold" 로 분리할 수 있는 별도 저장소가 없음.** consultant_id 를 UPDATE 하면 배분이력·배정목록·직원별누적·매출/실적 귀속이 **동시에** 소급 이동함(Option A 불가피). → confirm-gate #2(귀속 동반 이동 여부)는 foot 구조상 "consultant_id UPDATE = 귀속 이동"이 됨을 planner 에 명시.
  (단, 본건은 아래대로 대상 자체가 부재하므로 이 쟁점은 발동하지 않음.)

## 인증 컨텍스트 (read authctx 표준)

- 모든 조회 = **service_role** 키(RLS 우회, 실 데이터 관측). 0-row 오독(anon RLS) 아님 — 실제로 대상이 없음.

## freeze / abort (SELECT-only)

스크립트: `scripts/T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE_freeze.mjs`
freeze 스냅샷: `scripts/T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE_FREEZE.json`
forensic: `scripts/T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE_forensic.mjs`

| 값 | 확정 |
|----|------|
| clinic | 오블리브의원 서울오리진점 `74967aea-a60b-4da3-a0e7-9c997a930bc8` (slug jongno-foot) |
| 백범석(요청상 from '담당자') | **staff 매치 0건** (clinic 내 + 전 clinic ilike `%백범석%`/`%범석%`/`%백범%` 전부 0) |
| 강경민(to) | `6ab26d9f-fd10-4042-9fd7-076f277be5d4` role=consultant active |
| 김주연(sibling test-del) | `10eacaa8-fa6b-4615-8bf1-02b4f49cb6ed` |
| 금일 consultant='백범석' check_ins | **0건** (백범석 staff 부재이므로 구조적으로 0) |

- `freeze(consultant_id='백범석')` = **0건** → **ABORT** (from staff 매치 0 + freeze 0).

## forensic — '백범석' 이 실제로 있는 곳

| surface | 결과 |
|---------|------|
| `staff` (clinic + 전 clinic fuzzy) | **0건** — 백범석이라는 직원/상담실장 없음 |
| `check_ins.customer_name = 백범석` | **1건** — ci `625e534d-22e6-4526-8ea5-c34645691b67`, customer_id `fab31584-0b68-4134-b330-68f923fd1481`, 2026-07-24 09:14(UTC), status=done, visit_type=new |
| 위 check_in 의 **담당자(consultant_id)** | **정연주** (`c851fbb1-31ce-4714-b91c-03e9cb8af566`, role=consultant) — 백범석 아님 |

→ **`백범석` 은 오늘(7/24) 방문한 고객(환자)이고, 그 건의 배정 담당자는 정연주다.**
   요청 문구 "담당자='백범석' 레코드 전체 → 강경민" 은 백범석을 *담당자(실장)* 로 지목했으나, 데이터상 백범석은 *고객* 이다. → **의미 불일치, 현장 재확인 없이 UPDATE 불가.**

### 금일(7/24) 실제 배정 담당자 분포 (참고)

총 25 check_ins · 엄경은 7 / 김주연 5 / 김지윤 4 / NULL 4 / 강경민 3 / 정연주 2. (백범석 = 0 — 담당자로 존재 안 함)

## 가능한 재해석 (dev 단독 판단 금지 — planner/현장 게이트)

- **재해석 A**: "고객 백범석의 배정 담당자를 (현재 정연주) → 강경민으로 바꿔달라"? → **정연주↔강경민 두 실환자 실장 간 매출·실적 재귀속** 발생(business-sensitive). 요청 문구("담당자=백범석")와도 불일치. 현장 confirm 없이 금지.
- **재해석 B**: '백범석' = 실제 상담실장인데 계정 미생성(강경민이 7/14 신규생성됐던 선례처럼)? → staff 부재. 현장이 지칭한 실 인물/계정 확인 필요.
- **재해석 C**: 이름 오탈자(다른 실장 지칭)? → 전 staff 목록 대조상 유사명 없음.

→ **셋 다 dev 추측 금지.** planner 경유 현장(#풋센터) 재확인 필요.

## cross-guard (sibling KKM-EGE)

- 백범석발 freeze 셋 = 0건이므로 강경민 pool 증가 없음 → KKM-EGE 원래 8건 명시셋과 충돌 **구조적 0**. 직렬화 리스크 미발생.
- (참고: KKM-EGE 는 이미 NO-OP 종결 — 8건 전부 이미 엄경은 귀속.)

## MIG-GATE evidence 4필드

- **mig_files**: `scripts/..._freeze.mjs`, `scripts/..._forensic.mjs`, `scripts/..._FREEZE.json`, 본 evidence.md (SELECT-only, apply/rollback 미생성 — UPDATE 미실행)
- **mig_dryrun**: freeze/forensic SELECT-only 실행 완료. 대상 write 0건(no-op) — dry-run == 실행 (파괴 0).
- **mig_ledger_check**: rows-affected 검증 대상 UPDATE 없음(대상 freeze 0건). payments/package_payments 원장 무접점.
- **mig_rollback**: write 없음 → 롤백 대상 없음.

## 조치

1. **check_ins UPDATE 미실행** (from staff 부재 + freeze 0 abort). deploy-ready **미마킹** (write 미발생).
2. planner FOLLOWUP(`freeze_mismatch_target_is_customer_not_consultant`) 발행 — 백범석=고객(담당자 아님) + 재해석 A/B/C 제시, 현장(#풋센터 thread 1784867114.685259) 재확인 요청.
3. **현장 relay 톤**: "백범석님은 담당 실장이 아니라 오늘 오신 고객님으로 확인됩니다. 어떤 걸 바꿔야 하는지 한 번만 더 확인 부탁드립니다" (개발용어 배제).
