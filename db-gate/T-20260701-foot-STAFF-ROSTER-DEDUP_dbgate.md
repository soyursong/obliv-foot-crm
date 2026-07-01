# T-20260701-foot-STAFF-ROSTER-DEDUP — DB 게이트 HOLD 패키지 (apply 보류)

> dev-foot. carve-out from T-20260630-foot-STAFF-AUTH-LINK-BACKFILL.
> **현 상태: apply 보류(HELD).** AC-1(dry-run)·AC-2(DA CONSULT) 충족. **AC-3 현장 confirm(김주연 총괄 행별 canonical/폐기) + AC-4 supervisor DB 게이트 미충족 → 처분 SQL 실행 0.**
> PHI 귀속 경로 = autonomy §3.1 **면제 아님**. dev-foot 직접 prod write 금지. **추정 병합 금지.**
> DDL 무변경(데이터 정리). staff 는 soft-delete 컬럼 부재(`active` boolean만) → 폐기 = `active=false` 유지 + 감사용 name 마커, **hard-delete 금지**(의료법 §22 감사 trail 보존).

## 게이트 진행 상태

| AC | 게이트 | 상태 |
|----|--------|------|
| AC-1 | read-only dry-run 분류 (prod write 0) | ✅ 완료 — `scripts/..._dryrun.out.json` (6/6) |
| AC-2 | data-architect CONSULT-REPLY | ✅ **부분-GO** — MSG-20260701-212011-06ip (agent-data-architect) |
| AC-3 | 김주연 총괄 행별 canonical/폐기 명시 확인 | ⏳ **미충족 (HOLD)** — 현장 confirm 대기 |
| AC-4 | supervisor DB 게이트 집행 | ⏳ 미착수 (AC-3 後) |
| AC-5 | 사후검증 (stale grant 0 · 활성 무회귀) | ⏳ apply 後 |

## DA CONSULT-REPLY 요지 (MSG-20260701-212011-06ip · 부분-GO)

- **Q1 canonical 규칙**: ①활성 신원(`user_profiles.active`/로그인 권위) > ②inbound 귀속 밀도(실사용) > ③up 점유(약한 증거·과거 오링크 가능). #2~6 신호 일치, **#1 박소예는 ①②↔③ 상충 → 자동 판정 금지**.
- **Q2 처분 방식**: 참조 0(#5) = 즉시 soft-delete. 참조 존재(#1~4,6) = **canonical 로 re-attribution(UPDATE fk) 선행 후** 폐기. hard-delete 금지, stale grant 잔존 채 삭제 금지.
- **Q3 순서·가드**: **per-person 단일 트랜잭션(6인 일괄 금지)** — re-attribution UPDATE → 잔여 inbound 참조 0 재조회(≠0 → ROLLBACK) → 비활성행 soft-delete → COMMIT. 기대행수 명시 + rowcount 불일치 즉시 ROLLBACK + dry-run 선행 + loss-zero 백업.
- **Q4 박소예 역전**: 데이터만으로 결정 불가 → **김주연 총괄 confirm 전 NO-GO.**
- **Q5**: DDL 무변경 맞음. #5 최저위험 / #2~4,6 재귀속 후 GO / #1 confirm 전 NO-GO. **전 항목 현장 confirm + supervisor DB 게이트로만 실행.**

## 제안 canonical 매핑 (DA 규칙 적용 — **현장 confirm 대상, 확정 아님**)

| # | 이름 | dup(폐기 후보) staff.id | active | canonical(정본) 제안 | 근거(DA 규칙) | 재귀속 필요 참조 |
|---|------|------------------------|--------|---------------------|--------------|-----------------|
| 1 | 박소예 | **판정 상충 → 현장 확정 필요** (target 5c17e4bc active / up점유 5fb3e3b1 inactive) | — | ①②=5c17e4bc(target,활성) 로 보이나 ③=5fb3e3b1 → **NO-GO** | duty_roster.doctor_id 8·package_sessions.performed_by 1·room_assignments.staff_id 1 |
| 2 | 장예지 | a8ffcea8 (비활성) | false | **0237eba4** (활성 namesake) | ①활성 신원 | duty_roster.doctor_id 8 → 0237eba4 |
| 3 | 김지혜 | 5f741eba (비활성) | false | **735dd27a** (활성 namesake) | ①활성 신원 | duty_roster.doctor_id 9 → 735dd27a |
| 4 | 서은정 | 42ca1057 (비활성) | false | **1d2165fa** (활성 namesake) | ①활성 신원 | room_assignments.staff_id 3 → 1d2165fa |
| 5 | 김민경 | 3d881cff (비활성) | false | canonical 미정(up 미점유·참조0) → **현장 확정** | 참조0 → soft-delete만 | 없음 |
| 6 | 정혜인 | 5f141f76 (비활성) | false | canonical 미정(up 미점유) → **현장 확정** | ①③ 불명 | room_assignments.staff_id 2 → (canonical 확정 後) |

> 제안 = DA 규칙 기계적용 결과일 뿐. **#1·#5·#6 은 canonical 미확정, #2~4 도 현장 confirm 없이는 처분 0.** 모호건 보류.

## APPLY 템플릿 (per-person 단일 트랜잭션 — **현장 confirm + supervisor 집행 前 실행 금지**)

> 아래 `:DUP_ID`, `:CANON_ID`, `:N` 은 현장 confirm 으로 행별 확정 후 supervisor 가 바인딩·집행. dev-foot 바인딩·실행 금지.
> 재귀속 대상 컬럼은 dry-run 실측 기준: `duty_roster.doctor_id` / `package_sessions.performed_by` / `room_assignments.staff_id`.

```sql
-- ⛔ TEMPLATE — 각 인원 1명 = 1 트랜잭션. 6인 일괄 금지.
BEGIN;
-- [확인 1] 폐기 후보 행 존재 + 비활성(또는 #1 confirm 예외) 가드
SELECT id, name, role, active, user_id FROM staff WHERE id = :DUP_ID;   -- 1행, 의도 확인

-- [재귀속] stale grant 를 canonical 로 이관 (기대행수 == dry-run N)
UPDATE duty_roster       SET doctor_id = :CANON_ID WHERE doctor_id = :DUP_ID;   -- expect n1
UPDATE package_sessions  SET performed_by = :CANON_ID WHERE performed_by = :DUP_ID; -- expect n2
UPDATE room_assignments  SET staff_id = :CANON_ID WHERE staff_id = :DUP_ID;     -- expect n3
-- (해당 인원에 존재하는 컬럼만. 합계 == :N)

-- [확인 2] 잔여 inbound 참조 0 (아니면 ROLLBACK)
SELECT
 (SELECT count(*) FROM duty_roster      WHERE doctor_id = :DUP_ID)
+(SELECT count(*) FROM package_sessions WHERE performed_by = :DUP_ID)
+(SELECT count(*) FROM room_assignments WHERE staff_id = :DUP_ID) AS residual;  -- 반드시 0

-- [폐기] soft-delete (DDL 무변경: active=false 유지 + 감사 name 마커). hard-delete 금지.
UPDATE staff SET active = false, name = name || ' [중복정리 2026-07-01]'
 WHERE id = :DUP_ID AND active IS NOT TRUE;   -- #1 은 confirm 결과에 따라 폐기 대상 id 별도

-- [확인 3] canonical 무손상 (활성 · user_id 유지)
SELECT id, name, active, user_id FROM staff WHERE id = :CANON_ID;

COMMIT;  -- residual==0 + canonical 무손상 + supervisor 승인 시에만. 아니면 ROLLBACK.
```

## ROLLBACK 템플릿 (검증 실패/원복)

```sql
BEGIN;
-- 재귀속 원복 (canonical→dup 되돌림; 외부 재할당 보호 위해 dup 로 옮겨간 것만)
UPDATE duty_roster      SET doctor_id = :DUP_ID    WHERE doctor_id = :CANON_ID /* AND 이관분 식별 */;
UPDATE package_sessions SET performed_by = :DUP_ID WHERE performed_by = :CANON_ID /* AND 이관분 식별 */;
UPDATE room_assignments SET staff_id = :DUP_ID     WHERE staff_id = :CANON_ID /* AND 이관분 식별 */;
-- soft-delete 원복
UPDATE staff SET active = true, name = replace(name, ' [중복정리 2026-07-01]', '') WHERE id = :DUP_ID;
COMMIT;
```

> 롤백 정밀도를 위해 apply 前 `scripts/..._dryrun.out.json` 의 이관 전 참조 스냅샷을 loss-zero 백업으로 보관(DA Q3).

## 사후검증 (AC-5 — apply COMMIT 後, dev-foot READ-ONLY)

1. **(a) stale grant 0**: 처분한 dup staff.id 각각 duty_roster.doctor_id / package_sessions.performed_by / room_assignments.staff_id inbound 참조 0.
2. **(b) 활성 무회귀**: canonical staff/user_profiles active·user_id 유지, reservations.created_by 등 canonical 실사용 참조 무변동.
3. **(c) 6건 처분/보류 사유 명시**: 김민경·정혜인 포함 전량 처분 또는 보류 기록.

## 게이트/정책 정합

- da_consult_required: true / **da_consult_done: true** (부분-GO, MSG-20260701-212011-06ip)
- db_gate_required: true / hotfix: false / non_blocking: true / DDL 무변경
- **apply 실행 0** — 현장 confirm(AC-3) + supervisor DB 게이트(AC-4) 前 처분 금지. 추정 병합 금지.
