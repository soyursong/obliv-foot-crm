# MERGE-BEFORE-ARCHIVE SQL — dev-foot 실행 leg 산출 (supervisor DB-GATE 핸드오프)

**ticket:** T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP · **domain:** foot · **db_change:** true
**DA canonical:** MSG-20260810-225709-8bno (조건부 GO · soft-archive · merge-before-archive)
**change-class:** DESTRUCTIVE-correction (soft-archive·가역) · **DDL 0 · DML only**
**mode until GO-token:** prod WRITE 0 유지 (apply_before_go 클래스 — GO-token 前 archive/re-point 선집행 금지)

---

## 1. freeze set (INV-8-a 다축 census + freeze_reverify 재검증 — 두 번 일치)

| 사람 | survivor uid | loser uid | 판정 축 (다축 DB ground-truth) | 신뢰 |
|---|---|---|---|---|
| 강다연 | `0ff81a68` (08-10) | `4bcf55a2` (08-08) | auth `ekdusrkd1@naver.com` · **live-login 08-10 03:03** · edge14(health_q_tokens13+registrar) | **STRONG** |
| 이진석 | `884b4571` (08-10) | `9a429fb7` (08-08) | auth `naspos82@gmail.com`(confirmed) · registrar 링크 · **미로그인** · edge 동률(1:1) | **MODERATE → INV-8-b fail-closed** |

- loser 2건 = `user_id NULL`(로그인 불가·placeholder) · edge 1(staff_attendance ×1).
- DA "flip" 가설 **CONFIRMED**: live identity = 08-10(auth 보유). blanket "구건(08-08) 유지" = 오답 → **단일축 택일 REJECT 준수**.

## 2. full-FK 기계열거 (손열거 금지 · freeze_reverify R3/R4)

- `pg_constraint confrelid=public.staff` = **35 inbound FK** 전수 계수.
- loser 실참조 = **`public.staff_attendance.staff_id` ×2 (각 pair 1) 뿐** · 나머지 34 FK = **0**.
- re-point 대상 PK (freeze): 강다연 `a9761249…`(4bcf55a2→0ff81a68) / 이진석 `f35160d7…`(9a429fb7→884b4571).
- **§416 방화벽 무저촉**: `reservations.created_by` = auth.users 축(staff FK 아님) · loser user_id=NULL → auth-기반 created_by 가 loser 참조 불가 → soft-archive 귀속 소실 = 0.

## 3. merge-before-archive 절차 (up.sql · DA §2-0)

1. **re-point** loser 참조 → survivor: `staff_attendance` 명시 PK UPDATE, `GET DIAGNOSTICS ROW_COUNT==1` 가드(각).
2. **zero-child 재검증**: loser 잔여 `staff_attendance` 참조 = 0 아니면 `RAISE EXCEPTION abort`.
3. **soft-archive** loser: `active=false · auto_assign_enabled=false · name||' [중복정리 2026-08-10]'` · 멱등 가드(`active=true`) · `ROW_COUNT==2`. **hard-DELETE / ON DELETE SET NULL cascade 의존 = 미사용(HARD REJECT 준수)**.
4. **in-txn POST-VERIFY**: survivor active==2 · loser active==0 아니면 abort.

## 4. rollback (rollback.sql · 순소실 0)

- loser soft-archive 복원(active=true·라벨 제거·auto_assign 복원) + attendance **PK-precise** 원복(명시 2 PK만, guard로 up.sql 적용본 한정). 구 DRAFT 의 `AND false` blanket 가드 제거 = 진짜 원복 가능.

## 5. no-persistence dry-run (mig_dryrun 근거)

- runner: `scripts/dryrun_lib.mjs`(migration_dryrun_no_persistence_standard v1.0, sentinel-bypass 차단 3요소).
- 결과: **DRY-RUN PASS** — top-level BEGIN/COMMIT strip · plpgsql exception-rollback · rows-affected 가드 전부 통과(1/1/2).
- effect-absence post-probe 2건 **absent=true**:
  - `loser_still_active` → losers 여전히 active=true (soft-archive 미영속).
  - `attendance_not_repointed` → attendance 여전히 loser 소유 (re-point 미영속).
- ⇒ 무영속 실증 (persist 0).

## 6. 게이트 상태 (핸드오프)

- ☑ INV-8-a 다축 survivor census (census 4253fbdf/c8ca1f6a + freeze_reverify 재검증).
- ☑ full-FK 기계열거(35) + loser 참조 실측(staff_attendance ×2).
- ☑ merge-before-archive up.sql (FROZEN v2·PK-precise) + rollback.sql (PK-precise) + before_image.json (INV-8-c·명시 uid).
- ☑ no-persistence dry-run PASS (effect-absence post-probe 포함).
- ☐ **INV-8-b per-pair 사람 confirm** — 강다연(권고) / **이진석(필수·미로그인)**. planner DECISION-REQUEST 현장/HR 계류(block_reason=human_pending).
- ☐ **supervisor DB-GATE**: 무영속 dry-run 재대조 + freeze셋 재검증 + INV-8/C28 + **물리 GO-token**.
- ☐ apply(GO-token 창 내) → POST-VERIFY(INV-8-c before_image uid 대조) → 현장(김주연 총괄 C0ATE5P6JTH) confirm.

**⛔ 8쌍 carve 불변**: 원내 김민경·김지혜·박민석·장예지 / TM 김효신·문해민·이수빈·진운선 = 종로(74967aea)+송도(b4dc0de5) cross-clinic seed 16행(staff_id NULL) — within-clinic 진성중복 아님 → dedup 대상 아님 (freeze_reverify R5 재확인: 각 rows=2·clinics=2).

## 7. artifacts

| 파일 | 용도 |
|---|---|
| `scripts/…_merge_archive.up.sql` | merge-before-archive (FROZEN v2·DML only) |
| `scripts/…_merge_archive.rollback.sql` | PK-precise 롤백 |
| `scripts/…_freeze_reverify.mjs` | READ-ONLY freeze 재검증 러너 |
| `db-gate/…_freeze_reverify.json` | R1~R5 재검증 결과(mig_ledger_check 근거) |
| `db-gate/…_before_image.json` | INV-8-c before_image(명시 uid) |
| `db-gate/…_merge_sql_evidence.md` | 본 문서 |
