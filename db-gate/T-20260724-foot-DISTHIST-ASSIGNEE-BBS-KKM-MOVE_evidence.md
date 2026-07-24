# MIG-GATE evidence — T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE

**재정의 A확정** (김주연 총괄 confirm=A, confirmed_ts=1784897356.364349): 고객(환자) **백범석**의 담당 실장 **정연주 → 강경민**. consultant_id 변경 = 매출·실적 read-time 파생 자동 이동(귀속 동반이동 confirm 완료, AC-5 해소).

- clinic: 74967aea (foot / obliv-foot-crm)
- supabase: rxlomoozakkjesdqjtvd
- applied_at: **2026-07-25T00:39:36+0900**
- op: check_ins.consultant_id 단일행 UPDATE (mutable-field data-correction, ADDITIVE·no-DDL)

## 1) 강경민 staff 단건 조회 abort 가드 (freeze2)
- 성명 정확매치 '강경민': 전체 1건 / clinic(foot) 1건 → **단건 확정** (abort 가드 통과)
- 강경민 id = `6ab26d9f-fd10-4042-9fd7-076f277be5d4` (role=consultant, active=true) — KKM-EGE 롤백 참조 id와 일치
- 매치 0 또는 다건 시 UPDATE 중단·planner FOLLOWUP(consultant_lookup_fail) 규약 — **미발동**

## 2) 대상 PK freeze (원값 스냅샷 → FREEZE2.json)
| 항목 | 값 |
|------|-----|
| check_ins.id | 625e534d-22e6-4526-8ea5-c34645691b67 (단건) |
| customer | 백범석 (customer_id=fab31584-0b68-4134-b330-68f923fd1481) |
| checked_in_at | 2026-07-24T09:14:28.372341+00:00 |
| status / visit_type | done / new |
| **consultant_id (원값)** | **c851fbb1-31ce-4714-b91c-03e9cb8af566 (정연주)** |
| **consultant_id (신값)** | **6ab26d9f-fd10-4042-9fd7-076f277be5d4 (강경민)** |

precondition_checks: pk_match ✓ / clinic_match ✓ / current_is_jyj ✓ / not_already_kkm ✓ / customer_bbs ✓

## 3) DRY-RUN (WRITE0)
```
UPDATE check_ins SET consultant_id='6ab26d9f-…(강경민)'
 WHERE id='625e534d-…' AND consultant_id='c851fbb1-…(정연주)';  -- 기대 rows-affected==1
```

## 4) APPLY (cross_crm_write_rowcheck_standard)
- PRECHECK: consultant_id=c851fbb1(정연주) 재확인 ✓ (동시성·멱등 guard, .eq(consultant_id=원값))
- **rows-affected = 1** → ROWCHECK PASS (0-row+error=null 성공오인 방지)
- **POSTCHECK (독립 SELECT)**: consultant_id = 6ab26d9f(강경민) ✓ status=done, vt=new 불변

## 5) mig_ledger_check (원장 무접점)
- check_ins 단일 컬럼(consultant_id)만 touch. DDL 0 → schema_migrations 무관.
- payments / package_payments: consultant_id 컬럼 부재 → 무접점.
- assignment_actions: 감사이력(append-only) 무변경.
- 매출·실적: foot_stats_consultant RPC = check_ins.consultant_id read-time 파생 → 자동 반영(별도 write 불요).

## 6) rollback
- `scripts/T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE_rollback.sql` — 역 UPDATE(강경민→정연주), 명시-PK+멱등 guard, 기대 rows-affected==1.
- 원값 스냅샷: `scripts/..._FREEZE2.json`.

## 7) ⚠ KKM-EGE 직렬화 cross-guard (재검증 완료)
- sibling `T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE` = **status: done** (2026-07-24T23:10:56) → 재스캔 없음.
- KKM-EGE 8-set 고객명 = 엄상욱/김종민/오정길/이민태/최강선/백영호/이재성/이멋진 → **백범석 미포함** (disjoint).
- 본건 UPDATE 후 강경민 pool = 기존 38건 + 백범석(625e534d) = 39건. 백범석발 신규 건은 KKM-EGE 8-set 명시 앵커에 미포함 재확인 ✓.
- 8-set 고객은 현재 강경민 pool 부재(이미 엄경은 이동 완료) → KKM-EGE done 상태와 정합. 직렬화 안전.

## 파일
- scripts/..._freeze2.mjs (강경민 단건 guard + PK freeze, SELECT-only)
- scripts/..._crossguard.mjs (KKM-EGE 직렬 재검증, SELECT-only)
- scripts/..._apply.mjs (UPDATE + rowcheck + POSTCHECK)
- scripts/..._rollback.sql (역 UPDATE)
- scripts/..._FREEZE2.json (원값 스냅샷)
