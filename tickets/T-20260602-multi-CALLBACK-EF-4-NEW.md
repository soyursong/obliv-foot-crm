---
id: T-20260602-multi-CALLBACK-EF-4-NEW
domain: foot
status: deploy-ready
qa_result: pass
deploy_commit: f1e44c1
deployed_at: ''
bundle_hash: ''
db_change: true
dev_foot_db_apply_pending: false
db_applied_at: 2026-06-09 11:07 KST
db_apply_mode: shadow
deploy-ready: true
commit_sha: f1e44c1
build_ok: true
db_changed: true
spec_file: tests/e2e/T-20260602-multi-CALLBACK-EF-4-NEW.spec.ts
risk: GO_WARN
created_at: 2026-06-03
deploy_ready_at: 2026-06-03
reporter: ops-planner
spec_ssot: agents/docs/_draft/dopamine_callback_receive_pattern.md
---

# T-20260602-multi-CALLBACK-EF-4-NEW — 풋 CRM outbox (도파민 라이프사이클 콜백 발신부)

## 미션 (풋 서브파트)

풋 CRM(obliv-foot-crm) → 도파민 라이프사이클 callback(visited/no_show/cancelled/rejected)을
**transactional outbox 패턴**으로 발신. 롱레(dev-crm commit ca26361) 미러링 + 풋 변형.

- 호출 대상: 도파민 단일 EF `crm-lifecycle-callback` (계약 확정, 4-EF 철회). `source_system='foot'`.
- 인증: 헤더 `X-Callback-Secret` (env `DOPAMINE_CALLBACK_SECRET`, 풋 기존 콜백과 동일).
- 멱등: outbox `event_id` 기준, 도파민 측 `UNIQUE(source_system, event_id)`.

## 산출물 (commit f1e44c1)

- `supabase/migrations/20260603010000_dopamine_callback_outbox.sql` (+ `.rollback.sql`)
- `supabase/functions/dopamine-callback-dispatch/index.ts`
- `tests/e2e/T-20260602-multi-CALLBACK-EF-4-NEW.spec.ts` (23 TC, unit project, PASS)

## 수용기준 (풋 = AC-S1~S4) — 전건 충족

- **AC-S1**: `dopamine_callback_outbox` 테이블 — 명세 8컬럼 + `event_id/reservation_id/cue_card_id/status/dlq_alerted/sent_at/updated_at`. `UNIQUE(event_type,event_id)`, RLS on(service_role 전용).
- **AC-S2**: 트리거 `check_ins` AFTER INSERT → `visited`(event_id=check_in.id) / `reservations` AFTER UPDATE OF status → `cancelled`/`no_show`. `source_system='dopamine' AND external_id NOT NULL` 건만. 동기 발송 없음(INSERT ON CONFLICT DO NOTHING 적재만).
- **AC-S3**: `process_dopamine_callback_outbox()` + pg_cron `foot-dopamine-callback-worker`(분당). claim(FOR UPDATE SKIP LOCKED)+attempts++/backoff(1·2·4·8·16·32·60min) → dispatch EF. EF가 4xx 영구실패 / attempts>=7 소진 시 `dlq=true`.
- **AC-S4**: `alert_dopamine_callback_dlq()` — worker 매 틱 호출, `dlq AND NOT dlq_alerted` 배치 → 슬랙 `slack_infra_alerts_webhook_url`(없으면 `slack_ops_webhook_url`). 알람 후 `dlq_alerted=true`.

## 풋 변형 (롱레와 차이)

1. `payload.source_system = 'foot'` (롱레='crm').
2. 풋 `reservations.status` CHECK = `('confirmed','checked_in','cancelled','noshow')` — `rejected` 예약상태 없음, `noshow`(언더스코어 X). 트리거가 `noshow → no_show`(계약 event_type) 매핑. 외box CHECK는 계약 4종 보존(forward-compat).
3. 풋 컨벤션: `get_vault_secret('supabase_project_url'/'internal_cron_secret')`, `current_setting('app.supabase_url'/'app.cron_secret')`, `net.http_post`, cron prefix `foot-`, 롤백파일 `.rollback.sql`.

## 게이트 (supervisor — 필독)

- **기본 shadow**: `dopamine_callback_config.mode='shadow'`(기본값). 콜백은 발사되되 도파민은 audit만(status 전환 X). worker가 payload에 `mode:'shadow'` 전달.
- **본 발효(live)**: 1주 shadow 관측 → supervisor 확인 → `UPDATE public.dopamine_callback_config SET mode='live', updated_at=now() WHERE id=true;`
- **배포 순서**: ①도파민 `crm-lifecycle-callback` 수신 EF 먼저(현재 deploy-ready, supervisor migration 게이트 대기). ②풋 outbox는 shadow 기본 → 1주 dry-run → Phase 4 supervisor 확인.
- ⚠️ **DB 마이그레이션 직접 적용 대기 사유**: 본 마이그레이션을 prod에 적용하면 즉시 `foot-dopamine-callback-worker` cron이 분당 기동. 도파민 `crm-lifecycle-callback` EF가 아직 미배포면 발사 건이 5xx→재시도→7회 소진→DLQ→슬랙 알람 노이즈 발생. **따라서 prod 적용은 도파민 수신 EF live 이후 supervisor가 조율** (또는 적용 전 cron unschedule 후 EF 준비 시 schedule). 코드/마이그레이션 파일은 준비 완료.
- ⚠️ **기존 동기 경로 공존**: 풋 `checkin-visited-fire`/`dopamine-callback` → `foot-callback-recv`(기존)와 본 outbox → `crm-lifecycle-callback`(신규)는 shadow 동안 공존. live 컷오버 시 이중 발사 방지 위해 기존 동기 visited 경로 정리 여부 supervisor 판단 필요(별도 티켓 후보).

## 검증

- `npm run build` PASS (✓ 3.38s).
- E2E spec 23/23 PASS (unit project, 699ms) — 마이그레이션/EF/롤백 정적 단언.

## prod DB 적용 (2026-06-09 11:07 KST · FIX-REQUEST MSG-20260609-105822)

- supervisor 마이그 게이트 GO 후 `scripts/apply_20260603010000_dopamine_callback_outbox_pg.mjs` 로 적용.
- dry-run(BEGIN/ROLLBACK) → 객체 4+2+1 검증 통과 → `--apply` COMMIT.
- 적용 후 독립 검증: outbox/config 테이블 존재, `dopamine_callback_config.mode='shadow'`(게이트 기본), outbox 0행, cron `foot-dopamine-callback-worker` `* * * * * active=true`.
- 롤백 페어: `20260603010000_dopamine_callback_outbox.rollback.sql` (cron unschedule → 트리거/함수 DROP → 테이블 DROP).
- ⚠️ 잔여 게이트: worker는 분당 기동하나 mode=shadow + 도파민 연동 라이프사이클 이벤트 부재 시 claim 0(무해). 도파민 `crm-lifecycle-callback` / 풋 `dopamine-callback-dispatch` EF live + env(DOPAMINE_FUNCTIONS_URL/DOPAMINE_CALLBACK_SECRET/CRON_SECRET) 주입은 supervisor 조율. live 컷오버는 `UPDATE dopamine_callback_config SET mode='live'`.
