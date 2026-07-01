# T-20260701-foot-STAFF-ROSTER-DEDUP — AC-1 DRY-RUN 분류 보고 (READ-ONLY)

> dev-foot. 생성 2026-07-01 (UTC 12:14). **prod write 0** (`scripts/..._dryrun.mjs`, service_role REST SELECT/head-count only).
> carve-out from T-20260630-foot-STAFF-AUTH-LINK-BACKFILL. FK: `staff.user_id → user_profiles.id`. **DDL 무변경 가정(데이터 정리)**.
> 본 보고는 **분류·증거 제시**만 한다. canonical 판정·처분은 **DA CONSULT GO → 김주연 총괄 행별 confirm → supervisor DB 게이트** 後 별도 apply. **추정 병합 금지.**

## 요약 (AC-1)

| 지표 | 값 |
|------|----|
| 대상 존재 | 6/6 (missing 0) |
| 활성 행 | 1 (박소예) |
| 비활성 행 | 5 |
| stale grant(inbound 귀속참조) 보유 | 5/6 |
| 참조 0(orphan 위험 낮음) | 1 (김민경) |
| prod write | **0** |
| 전체 처분 상태 | **PENDING** (현장 confirm 前 처분 0) |

## 행별 분류

| # | 이름 | staff.id | active | role | candidate up | up 점유 canonical staff | stale grant | 판정 신호 |
|---|------|----------|--------|------|-------------|------------------------|-------------|-----------|
| 1 | 박소예 | 5c17e4bc | **TRUE** | therapist | 833c7135 | 박소예 5fb3e3b1 (**비활성**) | 10 (duty_roster.doctor_id 8·package_sessions.performed_by 1·room_assignments.staff_id 1) | **ACTIVE_WITH_REFS — 역전 케이스. target(활성)이 canonical 로 보임. 처분 절대 보류** |
| 2 | 장예지 | a8ffcea8 | false | coordinator | ea24c289 | 장예지 0237eba4 (활성) | 8 (duty_roster.doctor_id) | INACTIVE_WITH_REFS — 처분 전 canonical(활성)로 재귀속 필요 |
| 3 | 김지혜 | 5f741eba | false | coordinator | f953b4f4 | 김지혜 735dd27a (활성) | 9 (duty_roster.doctor_id) | INACTIVE_WITH_REFS — 재귀속 필요 |
| 4 | 서은정 | 42ca1057 | false | therapist | f972cf34 | 서은정 1d2165fa (활성) | 3 (room_assignments.staff_id) | INACTIVE_WITH_REFS — 재귀속 필요 |
| 5 | 김민경 | 3d881cff | false | coordinator | 77ef3500 | (미점유) | **0** | NO_REFS — orphan 위험 낮음. 단 canonical 미확정(이름 단독) |
| 6 | 정혜인 | 5f141f76 | false | consultant | cbab05d7 | (미점유) | 2 (room_assignments.staff_id) | INACTIVE_WITH_REFS — 재귀속 필요 |

## 핵심 발견

1. **박소예(역전 케이스)** — 6건 중 유일한 활성 target. candidate user_profiles(833c7135)를 물고 있는 쪽이 오히려 **비활성** 박소예(5fb3e3b1)다. 즉 "활성=중복행 / 비활성=정본"이라는 단순 가정이 성립하지 않는다. 활성 target 이 10건의 실 귀속을 가지므로 **정본일 개연성이 높고, 폐기 대상은 오히려 up 을 점유한 비활성행일 수 있다.** → 추정 금지, 현장이 명시 확인해야 함.
2. **장예지·김지혜·서은정** — 비활성 target 이 각각 활성 namesake 에 candidate up 이 점유된 전형적 중복. 단 target 에 8/9/3건 stale grant 가 남아 있어, 단순 삭제 시 orphan 발생. **처분 전 canonical(활성 행)으로 재귀속 UPDATE 선행 필수.**
3. **김민경** — 유일하게 참조 0 + candidate up 미점유. 가장 안전하나 canonical 판정이 이름 단독(이메일 교차검증 불가)이라 현장 확인 필요.
4. **정혜인** — 참조 2건(room_assignments). 재귀속 필요.
5. **duty_roster.doctor_id** 컬럼이 therapist/coordinator staff.id 를 참조(칼럼명 doctor 지만 일반 staff 참조로 보임) — DA 검토 필요 항목.
6. 참고: candidate up.id(canonical 신원) 쪽은 reservations.created_by(15)·updated_by(3)·assignment_actions.created_by(6) 참조 존재 → **canonical 신원은 실사용 중** (처분 대상이 아님을 재확인).

## 처분(apply) 전 게이트 (미충족 — 본 보고 시점 처분 0)

- **AC-2 DA CONSULT**: 처분 방식·canonical 판정 기준 → `db-gate/T-20260701-foot-STAFF-ROSTER-DEDUP_dbgate.md` 참조. **GO 미확보 시 apply 금지.**
- **AC-3 현장 confirm**: 김주연 총괄이 6행 각각 canonical/폐기를 명시 확인. **추정 병합/일괄 금지, 모호건 보류.**
- **AC-4 supervisor DB 게이트**: dry-run → 현장 confirm → supervisor 집행. WHERE 가드(id IN)+기대행수+rollback. PHI 경로 = §3.1 면제 아님.
- **AC-5 사후검증**: 정리 후 (a) 비활성행 stale grant 0, (b) 활성 staff/user_profiles 무회귀.

## 산출물

- `scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_dryrun.mjs` — read-only 분류 스크립트 (prod write 0)
- `scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_dryrun.out.json` — 실측 결과 (6행 전량)
- `db-gate/T-20260701-foot-STAFF-ROSTER-DEDUP_dbgate.md` — 게이트 HOLD 패키지 (apply SQL 은 canonical 확정 後 별도)
