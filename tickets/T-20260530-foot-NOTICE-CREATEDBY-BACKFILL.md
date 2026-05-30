---
id: T-20260530-foot-NOTICE-CREATEDBY-BACKFILL
domain: foot
priority: P3
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-05-30 21:46
completed: 2026-05-30
deadline: 2026-06-15
db_changed: true
db_migration: supabase/migrations/20260530000010_staff_user_id_backfill_for_notices.sql
db_rollback: supabase/migrations/20260530000010_staff_user_id_backfill_for_notices.down.sql
db_deployed: false
e2e_spec: tests/e2e/T-20260530-foot-NOTICE-CREATEDBY-BACKFILL.spec.ts
risk_verdict: GO
risk_reason: "공지 작성자 추적 복원. FE는 staff.user_id 역조회로 created_by 매핑 + 미매핑 시 null graceful fallback(FK nullable·on delete set null이라 저장 성공). DB migration은 idempotent(name+clinic_id 정확일치, WHERE user_id IS NULL 가드, 1:N 모호매칭 차단, dry-run RAISE NOTICE) + .down.sql 백업테이블 기준 복원. notices 데이터 무변경 → 기존 created_by=null 레코드 영향 없음. 빌드 OK. E2E spec 2종 green."
author: dev-foot
build_verified: "2026-05-30 — bash scripts/build.sh 120 → ✓ built in 3.43s (origin/main HEAD 2d4e825)"
deploy_commit: 2d4e825
phase2_fix: "2026-05-30 — spec_fail_new(AC-2 /admin/notices 목록 미반영) 수정. 근본원인: page.goto 가 getClinic 모듈 캐시 리셋 → useClinic 비동기 로드 전 저장 클릭 시 clinic=null 조기 return 으로 INSERT 미발생. handleSave 에서 getClinic() on-demand 확정으로 레이스 제거(Notices.tsx + CalendarNoticePanel.tsx). E2E .first() strict-mode 명확화. NOTICE 3종+회귀 9/9 PASS."
---

# T-20260530-foot-NOTICE-CREATEDBY-BACKFILL — 공지 작성자 추적 복원 (P3)

## 상태

**deploy-ready** — FE created_by 실 staff 매핑 + DB staff.user_id 백필 migration + E2E 2종 green + 빌드 통과.

## 배경

부모 티켓 `T-20260530-foot-DASHBOARD-NOTICE-SAVE-FAIL`에서 `notices_created_by_fkey`(23503) FK 위반을
회피하기 위해 `created_by = null` 고정으로 임시 처리했다. 본 티켓은 그 임시처리의 근본 해결 —
**공지 작성자(created_by)에 실제 로그인 staff를 매핑**해 작성자 추적을 복원한다.

## 근본 원인 / 해결 구조

- `notices.created_by` FK는 `staff(id)`를 참조하는데, FE는 `auth.uid()`(= user_profiles.id)를 전달해 위반.
- 해결: `profile.id`(= `auth.uid()`) → `staff.user_id` 역조회 → 매핑된 `staff.id`를 `created_by`로 insert.
- 매핑 실패(해당 staff 부재) 시 `null` graceful fallback. FK가 nullable·`on delete set null`이라 저장 성공.

## 변경 사항

### FE (commit 111f9e4)
- `src/components/CalendarNoticePanel.tsx` — `staff.user_id` 역조회 useEffect 추가, insert `created_by: null → creatorStaffId` (AC-2).
- `src/pages/Notices.tsx` — 동일 패턴 (PenChart/CustomerChart canonical 역조회 패턴 재사용).
- 미매핑 시 `null` fallback 유지 (AC-3).

### DB (supervisor 적용 대기)
- `20260530000010_staff_user_id_backfill_for_notices.sql` — idempotent. `name` + `clinic_id` 정확 일치,
  `WHERE user_id IS NULL` 가드, 1:N 모호 매칭 차단, dry-run `RAISE NOTICE` (AC-1).
- `20260530000010_staff_user_id_backfill_for_notices.down.sql` — 백업테이블 `_backup_staff_user_id_20260530`
  기준 NULL 복원 (AC-5).
- `notices` 데이터 무변경 → 기존 `created_by=null` 레코드 영향 없음 (AC-4).

## Acceptance Criteria

- AC-1: staff.user_id 백필 migration이 idempotent하게 적용된다 (정확 매칭 + 가드 + dry-run NOTICE). ✅
- AC-2: 공지 저장 시 created_by에 로그인 staff.id가 매핑된다. ✅
- AC-3: staff 미매핑 시 null fallback으로 저장이 실패하지 않는다. ✅
- AC-4: 기존 notices 데이터(created_by=null)는 영향받지 않는다. ✅
- AC-5: .down.sql로 백업테이블 기준 롤백 가능하다. ✅

## 검증

- 빌드: `bash scripts/build.sh 120` → `✓ built in 3.42s` (origin/main HEAD, 2026-05-30 재검증).
- E2E: `tests/e2e/T-20260530-foot-NOTICE-CREATEDBY-BACKFILL.spec.ts` — 패널/페이지 저장 FK 위반 없이 성공 + 목록 반영.

## supervisor 액션

⚠️ **DB변경: 있음** — supervisor가 migration 적용 (dry-run `RAISE NOTICE` 확인 후 COMMIT).
build.sh는 origin/main(commit c13b088~24a75b8)에 정상 존재하며 로컬 재검증 통과. supervisor lane에서
`No such file or directory` 발생 시 worktree/clone이 origin/main 최신과 동기화됐는지 확인 요망.
