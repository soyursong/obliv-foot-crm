# T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — Track 1 진단 리포트 (READ-ONLY)

- 작성: dev-foot / 2026-07-01
- 대상 DB: prod `rxlomoozakkjesdqjtvd` (obliv-foot-crm) — **read-only 쿼리만, 쓰기 0건**
- 방법: `supabase/migrations/*` forward 마이그 중 **20260609234500(원장 정지점) 이후 ~ 현재** 109개를,
  PROD 실객체 존재(함수/테이블/뷰/enum/컬럼/**RLS정책**/인덱스/트리거)와 대조 → 객체 존재 = ground-truth.
  ★precedent 0615(AC1)는 RLS/GRANT 를 UNKNOWN 으로 흘렸으나, 본 sweep 은 **CREATE POLICY 를 pg_policies 로 직접 probe**
  (92a95431-class casualty = RLS 정책이 바로 그 사각지대에 숨음).
- 원천: `scripts/audit_out/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_track1.json`
- 재현: `node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_track1_sweep.mjs`

## 요약 집계 (AC1)

| verdict | 건수 | 의미 |
|---------|------|------|
| APPLIED | 81 | 선언 객체가 PROD 에 모두 존재 |
| MISSING | 14 | probe 객체 전부 PROD 부재 (casualty 후보) |
| DRIFT   | 1  | 일부만 존재 |
| UNKNOWN | 13 | probe 대상 객체 미추출(순수 GRANT/REVOKE/data-only) |

> **원장 정지 실증**: 대상 109개 중 `supabase_migrations` 원장 기록 = **1건**. 6/09 이후 마이그는 원장 미추적
> (개별 `apply_*.mjs` 로만 PROD 반영) → apply 스크립트 없거나 미실행 시 **조용히 미반영**. 이것이 systemic root-cause.

## 위양성 제외 (casualty 아님) — 3건

| 마이그 | 제외 근거 |
|--------|-----------|
| `20260630130000_..consent_marketing_additive` | customers.consent_marketing = a9f4da16 추가 후 DA NO-GO → `20260630160000_..drop_convergence` 로 **의도적 DROP**. by-design 부재. |
| `20260616120000_bundlerx_drugname_migrate` | probe 가 잡은 `*_backup_20260616` = 마이그 내부 임시 백업테이블(끝에 정리). 데이터-effect 마이그는 반영됨. |
| `20260622180000_customer_resv_consult_memos` (DRIFT) | own_update/own_delete 정책이 **후속 마이그 `20260624160000_memo_soft_delete_role_manage`** 에서 DROP→`manage_update_*` 로 교체(by-design 진화). PROD shape 정상. |

## 추가 CASUALTY (ADDITIVE·게이트대기 아님) — 12건

> **게이트대기 제외(casualty 아님)**: `20260701030000_..coordinator_write_staffarea`(.SUPERSEDED) = consult_pending GO + supervisor DDL-diff apply 게이트 대기(설계상 pending).
> `92a95431`(20260620120000)은 trigger 티켓 4ROLE 이 별도 소유(DA shape 대기) — 아래엔 참조로만 기재.

### 🔒 보안/RLS 우선 (신뢰성 리스크)

| # | 마이그 | 누락 객체 | apply스크립트 | FE참조 | 증상/영향 | 위험 |
|---|--------|-----------|:---:|:---:|-----------|:---:|
| ★ | `20260620120000_phrase_templates_staff_write_staffarea` (92a95431) | policy `staff_write_staffarea_phrases` | 無 | — | 직원 상용구 write RLS 미반영(lock-out-in-disguise). **4ROLE 티켓 소유** | (owned) |
| 1 | `20260618200000_staff_attendance_ssot` | table `staff_attendance` + 4 policy + idx | 無 | 1 | 근태 SSOT 테이블 전무 → 근태 기능 write/read 시 `42P01`. | **MED** |
| 2 | `20260628200000_waiting_board_projection` | table `waiting_board` + fn `sync_waiting_board`/`mask_display_name` + policy + trigger | 無 | 1 | 대기보드 프로젝션 미반영 → 대기현황 조회 실패 가능. | **MED** |
| 3 | `20260630200000_daily_room_status_staff_unlock_6menu_rls_additive` | policy `daily_room_status_staff_unlock_6menu` | 無 | 2 | 6메뉴 unlock RLS 미반영. **단, PROD 에 `daily_room_status_staff_own_write`(ALL) 존재로 부분완화** → 완전 lockout 아님, 권한 범위 drift. | LOW-MED |
| 4 | `20260611210000_rx_audit_log` | table `rx_audit_log` + 2 policy + 3 idx | 無 | 1 | 처방변경 감사로그 미수집(fire-and-forget, 진료 차단 없음). precedent 0615 旣식별(db-gate 필수). | LOW-MED |
| 5 | `20260612120000_scheduled_messages` | table + fn `dispatch_scheduled_messages` + 3 policy + idx + trigger | 無 | 2 | SMS 예약발송 옵션 비활성(즉시발송만). pg_cron 의존. precedent 0615 旣식별. | LOW-MED |

### 일반 casualty

| # | 마이그 | 누락 객체 | apply스크립트 | FE참조 | 증상/영향 | 위험 |
|---|--------|-----------|:---:|:---:|-----------|:---:|
| 6 | `20260625140000_foreign_lang_save_customers_language` | column `customers.language` | 無 | 2 (**write**) | 외국인 환자 선호언어 저장(ForeignInfoSection) → 컬럼 부재 시 저장 `42703/PGRST204`. | **MED** |
| 7 | `20260629120000_staff_assign_sort_order` | column `staff.assign_sort_order` | 無 | 3 | 직원 배정 정렬순서 SSOT 미반영 → 정렬 저장/반영 degradation. | LOW-MED |
| 8 | `20260630120000_foot_doc_serial_seq_harden` | fn `issue_foot_doc_serial` + column `form_submissions.doc_serial_seq` | **有(미실행)** | 1 | 서류 일련번호 발번 하드닝 미반영. **apply 스크립트는 존재하나 PROD 미실행** — 실행 누락 표본. | LOW-MED |
| 9 | `20260630120001_foot_doc_serial_seq_unique_idx` | index `uq_form_submissions_clinic_doc_serial_seq` | 無 | — | #8 페어. 발번 유니크 가드 미반영. | LOW |
| 10 | `20260629170000_medical_charts_check_in_id_fk` | column `medical_charts.check_in_id` + idx | 無 | (graceful) | 진료차트↔체크인 FK 링크 미반영. **FE 가 이미 부재 전제로 우회 구현(OPINIONDOC RC)** → live 무영향, 스키마 drift 만. | LOW |
| 11 | `20260629180000_foot_calendar_read_surface` | fn `foot_calendar_read_direct` + table `foot_calendar_read_access_log` | 無 | **0** | 캘린더 read surface 미반영. **FE 소비자 미배포(참조 0)** → live 무영향. | LOW |

### 🔒 UNKNOWN(순수 GRANT/REVOKE — 수기 grant audit 권고) — 2건

| 마이그 | 성격 | apply 근거 | 판정 |
|--------|------|-----------|------|
| `20260616010000_phi_anon_grant_revoke_hardening` | GRANT/REVOKE only | `T-20260615-foot-PHI-ANON-REVOKE_apply.mjs` 존재 | 적용 추정 — grant 실측 audit 권고 |
| `20260629140000_anon_pii_leak_revoke_phase1` | REVOKE only | `T-20260629-foot-ANON-PII-LEAK_phase1_apply.mjs` 존재 | 적용 추정 — grant 실측 audit 권고 |

## AC 대응

- **AC1** ✅ 6/09→현재 parity 매트릭스 산출(json+본표). 원장 정지(109중 ledger 1건) 실증.
- **AC2** ✅ 추가 casualty **12건**(위양성 3 제외, 92a95431=4ROLE 소유 별도). Track2 판정표 = 아래.
- **AC3** ⏳ 원장 tooling 복구(Track3) — root-cause 확정: apply_*.mjs 전부 standalone·ledger 미기록. 별도 후속.
- **AC4** ✅ 파괴적 casualty **0건**(전부 CREATE TABLE/POLICY/COLUMN/FN/INDEX = ADDITIVE, 데이터 mutation·DROP 無). 자율 파괴적용 리스크 없음.

## Track2 판정 (권고 — supervisor DDL-diff 게이트 경유)

전 casualty **ADDITIVE**(파괴적 0) → autonomy §3.1 상 ADDITIVE 는 롤백SQL 동반 + supervisor DDL-diff 후 apply.
각 마이그는 `supabase/migrations/*.rollback.sql` 이미 동반(재적용 안전 IF EXISTS/IF NOT EXISTS 패턴).
**우선순위**: MED(#1,#2,#6) → LOW-MED(#3,#4,#5,#7,#8) → LOW(#9,#10,#11). #10/#11 은 FE live 무영향이라 후순위.
> 즉시적용 금지 판단 불요(파괴적 0). 단 **일괄 apply 는 supervisor DDL-diff 게이트** 경유 — 본 티켓 Track2 로 이월.

## Track3 root-cause (후속)

- **확정 RC**: `scripts/apply_*.mjs` 가 전부 standalone(공용 helper 無) + Management API `/database/query` 직접 POST,
  `supabase_migrations.schema_migrations` INSERT 없음. 마이그 .sql 자체도 원장 미기록. → 원장 6/09 정지 + 재발.
- **복구안**(비파괴): 공용 apply helper 신설(SQL 적용 + 적용성공 시 version 원장 INSERT, idempotent) + **APPLIED verdict 버전만** 원장 백필(casualty 는 백필 금지=미반영 진실 보존). 실행은 원장 write(PROD) → supervisor 게이트 경유.
- sibling: `T-20260626-dopamine-MIGRATION-TOOLING-REPAIR`(타 CRM 동일 RC) — 공용 convention 정합 시 cross-ref.
