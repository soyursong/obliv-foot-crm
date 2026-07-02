# T-20260701-foot-STAFF-ROSTER-DEDUP — DB 게이트 FINAL (apply-ready, supervisor 집행용)

> dev-foot. **AC-3 현장 confirm PASS(2026-07-02T16:44 김주연 총괄) + #6 reconcile PASS 반영.**
> 본 문서 = supervisor DB 게이트 **입력값(gate input)**. dev-foot 는 confirm 을 email→staff.id 로 **read-only resolve** 만 수행(prod write 0). **바인딩·집행·COMMIT 은 supervisor DB 게이트.**
> PHI 귀속 경로 = autonomy §3.1 **면제 아님**. dev-foot 직접 prod write 금지. **추정 병합 금지.**
> soft-delete 만(hard-delete 금지, 의료법 §22 감사 trail). DDL 무변경.
> resolve 증거: `scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_apply_resolve.mjs` / `..._apply_resolve.out.json` (2026-07-02, prod write 0).

## 게이트 진행 상태

| AC | 게이트 | 상태 |
|----|--------|------|
| AC-1 | read-only dry-run 분류 (prod write 0) | ✅ 완료 (`..._dryrun` 6/6) |
| AC-2 | data-architect CONSULT-REPLY | ✅ **부분-GO** (MSG-20260701-212011-06ip) |
| AC-3 | 김주연 총괄 행별 canonical/폐기 명시 확인 | ✅ **PASS** (2026-07-02T16:44, ts 1782976578.240359) — 5계정 email canonical 확정, #1 박소예 NO-GO 해소 |
| §RECONCILE | #6 정혜인 reconcile 게이트 | ✅ **PASS** (2026-07-01T21:56, planner) — BOTH필수(재귀속2→정연주 then soft-delete1) |
| AC-4 | **supervisor DB 게이트 집행** | ⏳ **READY — 본 문서 입력으로 착수** |
| AC-5 | 사후검증 (stale grant 0 · 활성 무회귀) | ⏳ apply COMMIT 後 |

## 확정 canonical 매핑 (AC-3 email confirm → read-only resolve 바인딩)

> confirm 은 canonical 을 **이메일**로 지정. dev-foot 가 `staff.user_id → user_profiles.email` join 으로 resolve.
> **폐기(DUP)** = 본 티켓 6개 dedup 대상행. **정본(CANON)** = 존치·재귀속 수신행.

| # | 이름 | DUP(폐기) staff.id | DUP active | CANON(정본) staff.id | CANON 신원 | 재귀속 기대행수(fresh) | soft-delete 가드 |
|---|------|--------------------|-----------|----------------------|-----------|------------------------|------------------|
| 1 | 박소예 | `5c17e4bc-e948-4dc4-a8cf-37904873edeb` | **TRUE ⚠** | `5fb3e3b1-1c5a-461b-9159-c330a52feb95` | yoonha62@gmail.com (staff.active=false / **up.active=true = 로그인 권위**) | **12** (duty_roster.doctor_id 8·package_sessions.performed_by 2·room_assignments.staff_id 2) | **`active IS TRUE`** (활성행 폐기·특수) — FLAG-1 참조 |
| 2 | 장예지 | `a8ffcea8-bbfc-46e7-841b-8192d1d8a3cd` | false | `0237eba4-d347-4251-bd61-32390f197f22` | jangyeji1242@naver.com (active) | **8** (duty_roster.doctor_id 8) | `active IS NOT TRUE` |
| 3 | 김지혜 | `5f741eba-7397-46ac-979b-11c31fc72eb4` | false | `735dd27a-75de-4599-86e2-9d5d04b64015` | wlgp3907@naver.com (active) | **9** (duty_roster.doctor_id 9) | `active IS NOT TRUE` |
| 4 | 서은정 | `42ca1057-06c8-4183-91ab-b9ab5a7c3a26` | false | `1d2165fa-5263-4521-9402-d19b8ceae451` | bonny_31@naver.com (active) | **3** (room_assignments.staff_id 3) | `active IS NOT TRUE` |
| 5 | 김민경 | `3d881cff-40e1-4a1a-9310-5f1482cdd1b8` | false | (email→staff 미해소 — FLAG-2) | alsrud102938@naver.com (staff 링크 부재) | **0** (참조 없음 → 재귀속 스킵) | `active IS NOT TRUE` |
| 6 | 정혜인 | `5f141f76-7f72-4560-8a67-bbcdf4938cad` | false | `c851fbb1-31ce-4714-b91c-03e9cb8af566` | 정연주 joo4442@naver.com (active, reconcile fallback) | **2** (room_assignments.staff_id 2 — id IN [`bd2ff40c…`,`215c9b5b…`]) | `active IS NOT TRUE` |

## ⚠ 집행 전 supervisor/DA 판단 FLAG (dev-foot 결정 안 함 — surface only)

### FLAG-1 (#1 박소예 — confirm 이 DA 데이터신호 제안을 역전, 최중요)
- HOLD 패키지의 DA **제안**은 활성 target(5c17e4bc, 참조多)을 canonical 로 봤으나, **AC-3 confirm(yoonha62@gmail.com)** 은 **로그인 신원 5fb3e3b1**(up.active=true)을 canonical 로 확정. → DA 규칙 ①(활성 신원=로그인 권위 축)에 부합. **폐기 대상은 5c17e4bc**(staff.active=true·user_id=null·12 refs).
- **(a) 활성행 폐기**: DUP 5c17e4bc 는 `active=true` → soft-delete 가드 = `WHERE id=DUP AND active IS TRUE`(기대 1행). 일반행(`active IS NOT TRUE`)과 가드 반대. 혼용 금지.
- **(b) 재귀속 12건**(DA 런북의 10 → fresh 12로 증가, 7/1 이후 신규 배정): duty_roster 8·package_sessions 2·room_assignments 2 → CANON 5fb3e3b1 이관. **기대행수는 집행 시점 fresh 재조회로 확정**(하드코딩 금지).
- **(c) CANON 활성 상태 판단**: CANON 5fb3e3b1 은 `staff.active=false`(up.active=true). 순수 dedup(5c17e4bc soft-delete + 12 재귀속)만 하면 **박소예의 활성 staff 행이 0개** → 활성 로스터에서 사라짐. 로그인은 up.active 로 동작하나 로스터 존치를 위해 **5fb3e3b1.active=true 재활성 여부는 supervisor+DA 판단 필요.** dev-foot 는 추정하지 않음.

### FLAG-2 (#5 김민경 — canonical email 미해소, 단 dedup 무관)
- confirm email `alsrud102938@naver.com` = staff 매칭 0행(활성 김민경 ca0e8887 은 up.email=test@medibuilder.com = 별개/테스트 계정). 실 로그인(alsrud102938) 이 staff 미링크 → **부모 티켓 STAFF-AUTH-LINK-BACKFILL 스코프**.
- 단 본 티켓 dedup 액션 = **DUP 3d881cff(참조 0) soft-delete** 로 canonical 링크와 **독립·안전**. 재귀속 없음. canonical email 링크는 본 티켓 처분과 무관(별건).

### FLAG-3 (기대행수 fresh 재조회)
- 본 문서 기대행수는 2026-07-02 resolve 실측(`..._apply_resolve.out.json`). #1=12(≠DA런북 10), #2=8, #3=9, #4=3, #5=0, #6=2. **집행 시점 rowcount 재조회 후 불일치 시 즉시 ROLLBACK**(가드2).

## 집행 순서 (per-person 단일 트랜잭션 — 6인 일괄 금지)

권고 순서(저위험 → 고위험): **#5 → #2 → #3 → #4 → #6 → #1**
- #5(참조0, 최저위험) → #2·#3·#4(비활성·단일컬럼 재귀속) → #6(reconcile 확정) → **#1(활성행·12 재귀속·활성판단 = 최후)**.
- 각 인원 1 트랜잭션. 실패 시 해당 인원만 ROLLBACK, 나머지 영향 없음.

## APPLY 런북 (per-person BEGIN..COMMIT — supervisor 집행. dev-foot 실행 금지)

```sql
-- ⛔ 각 인원 1명 = 1 트랜잭션. DUP/CANON/N 은 위 매핑표 값으로 supervisor 바인딩.
BEGIN;
-- [가드0] DUP 행 존재·의도 확인 (#1 은 active=true, 그 외 active=false 기대)
SELECT id, name, role, active, user_id FROM staff WHERE id = :DUP_ID;   -- 1행

-- [재귀속] DUP inbound → CANON. 각 UPDATE rowcount == 매핑표 by-column 기대치(fresh 재조회)
UPDATE duty_roster      SET doctor_id   = :CANON_ID WHERE doctor_id   = :DUP_ID;  -- expect n1
UPDATE package_sessions SET performed_by= :CANON_ID WHERE performed_by= :DUP_ID;  -- expect n2
UPDATE room_assignments SET staff_id    = :CANON_ID WHERE staff_id    = :DUP_ID;  -- expect n3
-- (customers.assigned_staff_id 는 전 인원 0 — UPDATE 불요. 재조회로 0 확인)
-- (#5 는 전 컬럼 0 → 재귀속 UPDATE 전부 스킵)

-- [가드1] 잔여 inbound 참조 0 (아니면 ROLLBACK)
SELECT
  (SELECT count(*) FROM duty_roster      WHERE doctor_id    = :DUP_ID)
 +(SELECT count(*) FROM package_sessions WHERE performed_by = :DUP_ID)
 +(SELECT count(*) FROM room_assignments WHERE staff_id     = :DUP_ID)
 +(SELECT count(*) FROM customers        WHERE assigned_staff_id = :DUP_ID) AS residual;  -- 반드시 0

-- [폐기] soft-delete. hard-delete 금지. #1 만 active IS TRUE, 그 외 active IS NOT TRUE.
UPDATE staff SET active = false, name = name || ' [중복정리 2026-07-02]'
 WHERE id = :DUP_ID AND active IS :EXPECTED_ACTIVE;   -- #1: TRUE / #2~6: NOT TRUE. 기대 1행

-- [가드2] CANON 무손상 (활성 신원·user_id 유지). #1 CANON 활성화 여부 = FLAG-1(c) 판단 반영.
SELECT id, name, active, user_id FROM staff WHERE id = :CANON_ID;

COMMIT;  -- residual==0 + 각 rowcount 기대일치 + CANON 무손상 + supervisor 승인 시에만. 아니면 ROLLBACK.
```

## ROLLBACK 런북 (검증 실패/원복)

```sql
BEGIN;
UPDATE duty_roster      SET doctor_id    = :DUP_ID WHERE doctor_id    = :CANON_ID /* AND 이관분 식별 */;
UPDATE package_sessions SET performed_by = :DUP_ID WHERE performed_by = :CANON_ID /* AND 이관분 식별 */;
UPDATE room_assignments SET staff_id     = :DUP_ID WHERE staff_id     = :CANON_ID /* AND 이관분 식별 */;
UPDATE staff SET active = :ORIG_ACTIVE, name = replace(name, ' [중복정리 2026-07-02]', '') WHERE id = :DUP_ID;
COMMIT;
```

> loss-zero: apply 前 DUP staff행 + 재지정 fk 스냅샷 백업(`..._apply_resolve.out.json` = 이관 전 참조 스냅샷). 롤백 시 이관분 식별에 사용.

## 사후검증 (AC-5 — apply COMMIT 後, dev-foot READ-ONLY)

1. **(a) stale grant 0**: 처분한 6개 DUP staff.id 각각 duty_roster.doctor_id / package_sessions.performed_by / room_assignments.staff_id / customers.assigned_staff_id inbound = 0.
2. **(b) 활성 무회귀**: CANON 5×(0237eba4·735dd27a·1d2165fa·5fb3e3b1·c851fbb1) staff/up active·user_id 유지, 실사용 참조(reservations.created_by 등) 무변동. #1 CANON 활성화 결정 반영 확인.
3. **(c) 6건 처분/보류 명시**: 김민경(참조0 soft-delete)·정혜인(재귀속2+soft-delete) 포함 전량 기록. FLAG 미해소분(#1(c) CANON 활성판단, #5 canonical 링크) 별도 명시.

## 게이트/정책 정합

- da_consult_required: true / da_consult_done: true (부분-GO, MSG-20260701-212011-06ip)
- db_gate_required: true / apply_executed: **false** (supervisor 집행 前) / hotfix: false / non_blocking: true / DDL 무변경
- **dev-foot prod write = 0.** resolve 는 SELECT/head-count only. 바인딩·집행·COMMIT = supervisor DB 게이트.
