# DB-GATE evidence — T-20260606-foot-DIAGNOSIS-MASTER-MGMT [C] doctor_diagnosis_favorites

- **verdict**: **DB-GATE GO + PROD APPLIED** (supervisor MIG-GATE PASS). change-class = **ADDITIVE** (CREATE TABLE + ADD COLUMN IF NOT EXISTS[no-op] + CREATE INDEX + 3 CREATE POLICY; **DROP 0**).
- **계기**: PUSH-ESCALATION MSG-20260808-144358-b5yc (planner, CEO-DECISION MSG-20260808-143348-y7yv). 51일 무활동 P1 lane-ownership gap 해소 — assignee dev-foot→supervisor, 실행주체=supervisor.
- **게이트**: supervisor MIG-GATE. §3.1 대표게이트 면제(ADDITIVE) + CEO direct order. foot=ed25519 GO-token lane 미배선 → sanctioned GO = 본 _dbgate.md + supervisor 승인(PLANA 선례 동형).
- **적용주체**: supervisor(마이그 파일 header line 10 "prod 적용은 supervisor 검토·실행, dev-foot prod 직접실행 금지" + CEO assignee 재지정). 실행 = Management API (prod ref rxlomoozakkjesdqjtvd).

## 마이그 파일
- `supabase/migrations/20260606160000_diagnosis_folder_and_favorites.sql` (up)
- `..._.rollback.sql` (rollback — 대칭: DROP TABLE doctor_diagnosis_favorites + DROP COLUMN diagnosis_folder)

## MIG-GATE 체크리스트 (전항 PASS, 2026-08-08T14:51:58+0900)
1. **prod 실재 재확인(PRE-PROBE)**: fav_table=**false**(부재) · services.diagnosis_folder=**true**(이미 OOB 적용) · fav_index=false · fav_policies=0 · schema_migrations[20260606160000]=**false**(원장 부재). → planner 주장 정확 확인.
2. **Ledger 3자 대조(reconciliation)**: prod=partial(diagnosis_folder 실재/favorites 부재) ↔ 원장=row 부재 ↔ 파일=둘 다 선언 → **divergence**. 정직 수렴 = idempotent 전 마이그 재적용(diagnosis_folder ADD=no-op) + schema_migrations INSERT(forward-doc). 파괴/db-repair 아님.
3. **rollback SQL**: 실재 + 대칭(net-new만 DROP). ⚠ diagnosis_folder DROP 시 폴더분류 데이터 손실 주석 존재(백업 확인 조건).
4. **Dry-run No-Persistence**(표준 §1 3요소): `== DRY-RUN PASS ==` — stripped txn-control(none) · harness [] · post-probe fav_table/fav_index/fav_policies 전부 ABSENT=true(무영속 실증 INV-3).
5. **FK-target 실재**: auth.users=true · public.services=true (CREATE TABLE FK 무결).
6. **C18/C21 HOLD·RETRACT·BINDING**: signals+frontmatter fresh-read = 활성 DA HOLD/RETRACT/BINDING **0**. (ticket status:hold = 본 gate_pending 자기게이트, DA hold 아님.)
7. **C19/C23/C3**: N/A — 등록 계약 RPC 0 · SECDEF 0 · RLS는 net-new 테이블 자기격리(auth.uid()).

## PROD APPLY POSTCHECK (2026-08-08T14:51:58+0900, ref rxlomoozakkjesdqjtvd)
- post-probe: `{"fav_table":true,"diag_folder_col":true,"fav_index":true,"fav_policies":3,"ledger_row":true,"uniq_staff_service":true,"rls_enabled":true}`
- RLS 정책 3종(원장별 auth.uid() 격리): ddf_select_own[SELECT USING staff_id=auth.uid()] · ddf_insert_own[INSERT CHECK staff_id=auth.uid()] · ddf_delete_own[DELETE USING staff_id=auth.uid()].
- UNIQUE(staff_id, service_id) present · RLS enabled · schema_migrations row 기입(ledger forward-reconciled).
- **PostgREST schema cache reload**: `NOTIFY pgrst, 'reload schema'` 발송 → PGRST205("relation not found") 해소.

## 연쇄 해소
- **T-20260606-foot-DIAGNOSIS-MASTER-MGMT [C]**: FE(commit e1f8019a, origin/main·CF live·graceful empty-fallback 상태였음) + DB 테이블 = **end-to-end 동작**. 추가 FE 배포 불요.
- **T-20260608-foot-DX-FAVORITE-SAVE-FIX**(문지은 대표원장 6/8 신고 '즐겨찾기 안됨', PGRST205): 코드변경 없이 **동시 해소**.

## 51일 무활동 근본원인 (CEO 규명 요청)
- QA-REQUEST MSG-20260606-154843-6c84가 SQL게이트를 supervisor lane에 회부했으나, 티켓 assignee=dev-foot(잔여0). 게이트는 supervisor 소관인데 assignee가 dev-foot이라 **어느 lane도 능동 pickup 대상이 아님**(reference_ticket_lane_ownership_gap). conductor-kick도 block_reason=gate_pending이라 무대상. → CEO 2축 재분류(무활동 51일)로 표면화 + assignee=supervisor 재지정으로 해소.

*supervisor MIG-GATE GO + PROD APPLIED · 2026-08-08T14:51:58+0900 · ref rxlomoozakkjesdqjtvd · applied_by=supervisor(Management API)*
