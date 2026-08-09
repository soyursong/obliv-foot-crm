# T-20260807-foot-INFLOW-VERSION-COLLISION-RENUMBER — LEDGER-RECONCILE POST-PROBE 증거

- **ticket**: T-20260807-foot-INFLOW-VERSION-COLLISION-RENUMBER (parent T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE)
- **renumber commit**: 11c4c0955a6d151d7d2e08cf0bd3ef8dfc4ff61d (==origin/main HEAD)
- **class**: db_only / record-only (forward-doc ledger reconcile) — DDL 재-apply 0
- **prod**: rxlomoozakkjesdqjtvd (obliv-foot-crm)
- **exec lane**: supervisor (forward-doc ledger INSERT = supervisor 전속, dev lane 분리)
- **lease**: qa_lease_guard PASS (exit 0) — prod-mutating INSERT 직전
- **date**: 2026-08-07 KST

## 근본 divergence (reconcile 전)
version 20260807120000 슬롯을 foot_cancel_sync_outbox_emit 가 선점 → inflow 마이그의
ON CONFLICT DO NOTHING no-op 로 inflow 파일명이 별도 원장 row 미기록(감사추적 divergence).
오브젝트 자체는 slot 120000 apply(commit 27e26ec1)로 이미 prod-LIVE.

## content-parity (renumber = comment+rename only)
| 파일 | non-comment body md5 (parent 120000) | (HEAD 170000) | 판정 |
|------|------|------|------|
| .sql | 03e6b235c52288d402012ce1a9f7eb49 | 03e6b235c52288d402012ce1a9f7eb49 | PASS (before==after) |
| .rollback.sql | c32526e67ccfefb0b644a74f78a6f2f7 | c32526e67ccfefb0b644a74f78a6f2f7 | PASS |
git name-status: R076/R092/R093 (rename) + insertion 전량 comment(lineage 헤더) / dryrun UP path 정정.

## reconcile 조치 (forward-doc, record-only)
INSERT INTO supabase_migrations.schema_migrations (version, name, created_by)
  VALUES ('20260807170000','foot_inflow_kiosk_selfcheckin_candidate',
          'supervisor:...-ledger-reconcile')  -- WHERE NOT EXISTS (idempotent)
statements=NULL (replay 없음). cancel_sync(20260807120000) 무접촉.

## POST-PROBE 실측 (INSERT 후) — 3자 divergence 0
| 항목 | 기대 | 실측 | 판정 |
|------|------|------|------|
| ledger 20260807170000 | present, name=inflow 파일명 | present, foot_inflow_kiosk_selfcheckin_candidate | PASS |
| ledger 20260807120000 (cancel_sync 무접촉) | present, name=cancel_sync | present, foot_cancel_sync_outbox_emit | PASS |
| 170000 n_statements | 0 (record-only) | 0 | PASS |
| file 20260807170000_..._candidate.sql | present, ledger name 일치 | present | PASS |
| prod check_ins.inflow_channel_self_reported | text, nullable=YES | text, YES | PASS |
| prod fn_complete_prescreen_checklist md5 | ca2f6bfcfd284d8757dc89a251838f4e (불변) | ca2f6bfcfd284d8757dc89a251838f4e | PASS |
| fn secdef | true | true | PASS |
| canonical check_ins.inflow_channel 존치 | present | present | PASS |

→ ledger↔file↔prod divergence 0. inflow 마이그 distinct 추적 복원. GO_WARN 의 POSTCHECK 게이트 종결.
