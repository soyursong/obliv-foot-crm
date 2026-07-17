# Evidence — foot 원장 5-OOB forward-doc (content-parity)

- **ticket**: T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP (Case C3-a, F-track)
- **subtask msg**: MSG-20260718-061857-pzna (planner NEW-TASK)
- **probe**: 2026-07-18, Supabase Mgmt API `database/query` READ-ONLY (project rxlomoozakkjesdqjtvd), 원장 write 0
- **probe script**: `scripts/T-20260714-foot-MIGRATION-LEDGER-C3-forwarddoc_probe.sql`
- **scope**: collision 1건(20260715150000 = Case L) 제외한 file-less OOB 5건. forward-doc = 파일셋 정합 목적, DDL 재실행 없음(prod 이미 applied). 원장 write = supervisor exec lane 전속.

## 원장 name ↔ 파일 ↔ prod 물화 실측 대조

| version | ledger name (prod schema_migrations) | stmt_count | prod 물화 실측 | forward-doc 파일 | content-parity 방식 |
|---|---|---|---|---|---|
| 20260710193000 | foot_CUST-CASCADE-PHI-FK-HARDEN | 1 | customers 참조 FK **8/8 CASCADE 라이브** | `20260710193000_foot_cust_cascade_phi_fk_harden.sql` | 멱등 가드 DDL (현행 CASCADE=no-op) |
| 20260715230000 | foot_f4571_pkg12_mismap_archive_cleanup | NULL | data-op cleanup, 스키마 부작용 무 | `20260715230000_foot_f4571_pkg12_mismap_archive_cleanup.sql` | provenance marker (실행문 무, L-1) |
| 20260716230000 | foot_selfcheckin_upsert_writepath_phone_normalize | NULL | `fn_selfcheckin_upsert_customer*` phone_norm 경로 라이브 | `20260716230000_foot_selfcheckin_upsert_writepath_phone_normalize.sql` | provenance marker (def 는 20260717120000 co-located) |
| 20260717120000 | foot_selfcheckin_upsert_created_by_canon | NULL | `fn_selfcheckin_upsert_customer*` created_by stamp 라이브 | `20260717120000_foot_selfcheckin_upsert_created_by_canon.sql` | CREATE OR REPLACE ×3 (**byte-parity 3/3**) |
| 20260717180000 | foot_checkin_sync_reservation_broaden | 1 | `fn_checkin_sync_reservation` (`status IN (reserved,confirmed)`) 라이브 | `20260717180000_foot_checkin_sync_reservation_broaden.sql` | CREATE OR REPLACE ×1 (**byte-parity 1/1**) |

- ledger name = 파일 version×name 완전 일치(5/5). prod name 은 원장 실측값 그대로 사용(timestamp 추측 무, §4.1).

## content-parity 검증 로그

- **함수 def byte-parity**: 파일 4·5 의 embedded def 는 prod `pg_get_functiondef` 원본 바이트에서 직접 생성 → 재대조 결과 file4 **3/3 match / 0 miss**, file5 **1/1 match / 0 miss**.
- **CASCADE FK 셋(file1)**: `information_schema.referential_constraints` 실측 CASCADE=8종
  - chart_treatment_requests / customer_reservation_memos / health_q_tokens / insurance_claims / message_logs / notification_opt_outs / patient_room_daily_log(patient_id) / reservation_memo_history — 전건 customers(id) 참조.
- **delimiter balance**: file1 `$forwarddoc$`=2, file4 `$function$`=6, file5 `$function$`=2 (전건 짝수/균형).

## 안전성 판정 (planner 위험벡터 게이트)

- Case-F 위험벡터(권한상승 RLS supersede 등) **미검출**. 함수 3종 = 기존 foot 패턴(SECURITY DEFINER + `SET search_path=public,pg_temp`), 신규 권한 확대 없음.
- FK CASCADE = 고객 삭제 시 PHI orphan 제거(무해 하드닝, DA 특성 일치). prod 정의와 불일치·예기치 못한 PHI/권한 관여 **없음** → dual-tag phi_rls_drift_guard FOLLOWUP 트리거 미발동.
- 파일 전건 재실행 안전: 함수=CREATE OR REPLACE(멱등), FK=현행상태 가드(prod no-op), data-op·phone_norm=실행문 무 marker.

## 후속 (supervisor exec lane)

- 본 5 파일 main merge 후 local↔remote 파일셋 일치 → `db push` unblock (5건 한정, blanket push/repair 금지).
- 원장(schema_migrations) 단일행 정합은 이미 applied(행 존재, statements NULL=L-1 정상형) → **db repair 불요**. dev 는 repo 파일만, 원장 write 무접촉.
- src/FE 무변경 (scope-lock).
