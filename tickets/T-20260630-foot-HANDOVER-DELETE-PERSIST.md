---
id: T-20260630-foot-HANDOVER-DELETE-PERSIST
domain: foot
priority: P1
status: deploy-ready
qa_result: pending
deploy_commit: 34784101
deployed_at: n/a (db_change:true — supervisor DDL-diff 게이트 통과 후 적용)
bundle_hash: n/a (NOT yet verified on prod)
db_change: true
summary: "/admin/handover 인수인계 삭제 후 새로고침 시 복구되던 현장 버그(김주연 총괄) 수정 — 이중 버그 진단·해소. (1) RLS 회귀: T-20260609-foot-HANDOVER-ADMIN-DELETE(commit 9b842c1)가 도입한 handover_notes/handover_checklist_items DELETE 정책이 관리자 판정에 raw inline subquery `(select role from user_profiles where id=auth.uid()) in ('admin','manager')` 사용 → director/관리 tier 누락 + SECURITY DEFINER 미사용으로 총괄 삭제 시 USING 절 false → DELETE 0행(에러 아님). 코드베이스 canon(is_admin_or_manager() = is_approved_user() AND current_user_role() IN ('admin','manager','director'), SECURITY DEFINER; memo 20260624160000 동일 패턴)으로 양 DELETE 정책 교체(20260630184500 마이그 + 롤백 SQL 동봉). (2) FE 증폭 버그: handleDelete 가 .select() 없이 error 만 검사 → 0행 삭제를 성공 처리 → 낙관적 UI 제거 → DB 잔존 → 새로고침 복구(AC-2 silent 제거 금지 위반). handleDelete 를 .select('id') 로 affected-rows 검증, error/0행 모두 실패 분기에서 에러토스트 + fetchNotes() 재동기화(DB 진실 복원)로 수정. db_change:true → supervisor DDL-diff 게이트 필요. 신규 컬럼/테이블/enum 추가 없음(정책 ALTER만) → data-architect CONSULT 게이트 비대상."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260630-foot-HANDOVER-DELETE-PERSIST.spec.ts
medical_confirm_gate: n/a (인수인계 게시판 — 진료대시보드/진료관리 비대상)
---

## 요청 (현장)
김주연 총괄(풋센터): /admin/handover 인수인계 내역 삭제 → 화면에선 사라지나 새로고침하면 복구. DB DELETE 미반영. 매번 재현. P1. 스크린샷 F0BE0J7BZNZ.

## 진단 (이중 버그)

### 원인 1 — RLS 회귀 (primary, db_change:true)
- 회귀 출처: `T-20260609-foot-HANDOVER-ADMIN-DELETE` (commit 9b842c1, migration `20260609180000_handover_notes_admin_delete.sql`).
- 해당 마이그가 DELETE 정책 관리자 판정에 **raw inline subquery** 사용:
  `(select role from public.user_profiles where id = auth.uid()) in ('admin','manager')`
- 문제 (a): `director`(대표원장)·관리 tier 누락. 코드베이스 canon은 `('admin','manager','director')`를 관리자로 본다(`is_admin_or_manager()`, memo 정책 `20260624160000` 동일). 총괄의 운영 tier가 위 2종 set에 들지 않으면 USING 절 false.
- 문제 (b): inline subquery는 invoker 권한으로 `user_profiles` RLS 하에 평가 — SECURITY DEFINER 헬퍼와 달리 취약·비일관.
- 결과: 총괄 삭제 시 `handover_notes` DELETE가 **error 없이 0행** 영향.
- 실측 근거: 증상 "삭제 후 새로고침 복구"는 prod DELETE가 0행을 반환할 때만 발생 → RLS가 이 사용자에 대해 실제 차단 중임을 역으로 증명.

### 원인 2 — FE silent 성공 (secondary, 증폭)
- `src/pages/Handover.tsx` `handleDelete`가 `.delete().eq('id', n.id)`를 `.select()` 없이 호출하고 `error`만 검사 → 0행 삭제를 성공으로 오인 → 낙관적 UI 제거 + "삭제되었습니다" 토스트 → DB 잔존 → 새로고침 복구.
- AC-2(silent 제거 금지) 위반.

## 수정
- **RLS**: `supabase/migrations/20260630184500_handover_notes_delete_role_canon.sql` — `handover_notes`/`handover_checklist_items` DELETE 정책을 `author_id = auth.uid() OR public.is_admin_or_manager()`로 교체(SECURITY DEFINER canon, director 포함). 롤백 SQL 동봉.
- **FE**: `handleDelete`에 `.select('id')` 추가 → affected-rows 검증. error/0행 모두 실패 분기에서 에러토스트 + `fetchNotes()` 재동기화. 확인 삭제 행이 있을 때만 낙관적 제거.

## E2E
- `tests/e2e/T-20260630-foot-HANDOVER-DELETE-PERSIST.spec.ts`
  - S1: 본인 카드 삭제 → reload 후에도 미복구(DB 반영 영속성 실측).
  - S2: `handleDelete` affected-rows 가드 소스 불변식(`.select()` + 0행 실패 분기 + refetch).

## 게이트
- `db_change: true` → **supervisor DDL-diff 게이트 필요** (정책 ALTER, 신규 컬럼/테이블/enum 없음 → data-architect CONSULT 비대상).

## FIX-REQUEST 처리 (2026-06-30, MSG-20260630-184401-qx4l, supervisor qa_fail_phase2/spec_fail_new)
- 사유: Playwright S2 가 ESM 환경에서 `__dirname` 미정의로 실패(ReferenceError, spec:86).
- 조치: S2 소스 로드 경로를 `readFileSync(join(process.cwd(), 'src/pages/Handover.tsx'), 'utf8')`로 교체 (commit `ea0445cc`). `__dirname` 의존 제거.
- 재실행: `npx playwright test tests/e2e/T-20260630-foot-HANDOVER-DELETE-PERSIST.spec.ts --project=desktop-chrome` → **S1/S2 모두 PASS** (3 passed, 8.8s).
- `npm run build` PASS (built in 5.27s).
- 코드 변경은 spec 파일 1줄(테스트 인프라)만 — 제품 코드/DB 정책 무변경. 이미 origin/main 반영(push 완료).
- status: deploy-ready 유지, qa_result: pending → supervisor 재QA(DDL-diff 게이트) 대기.
