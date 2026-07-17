# T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT — PROD APPLY + POSTCHECK (evidence)

- executor: agent-fdd-dev-foot
- fix_request: MSG-20260717-222205-pm43 (supervisor, db_change auto-promote 제외 → 수동 PROD apply+probe 요청)
- migration: supabase/migrations/20260716140000_foot_dopamine_reschedule_emit.sql (ADDITIVE-1)
- transport: Supabase Management API POST /v1/projects/rxlomoozakkjesdqjtvd/database/query
- apply_at (UTC): 2026-07-17T13:34 (idempotent re-apply, BEGIN..COMMIT batch = APPLY OK)

## 증거기반 POST-PROBE (prod 실측, 대상 오브젝트 실재 확인)

| 항목 | 기대 | prod 실측 | 판정 |
|------|------|-----------|------|
| schema_migrations ledger | 20260716140000 등재 | `{version:20260716140000, name:foot_dopamine_reschedule_emit}` | ✅ 등재 (dry-run은 원장 미등재 → 실적용 증거) |
| event_type CHECK | +reschedule (기존 4값 보존) | `CHECK (event_type = ANY (ARRAY['visited','no_show','cancelled','rejected','reschedule']))` | ✅ ADDITIVE 확인 |
| function enqueue_dopamine_reschedule() | 실재 1, 본문=마이그 일치 | pg_proc n=1, pg_get_functiondef 본문 정확 일치 | ✅ |
| trigger trg_dopamine_cb_resv_reschedule | reservations AFTER UPDATE OF reservation_date | `AFTER UPDATE OF reservation_date ON public.reservations FOR EACH ROW EXECUTE FUNCTION enqueue_dopamine_reschedule()` | ✅ |
| target tables 실재 | dopamine_callback_outbox / reservations | to_regclass 둘 다 non-null | ✅ |
| reschedule outbox rows | 0 (미유입 정상 — emit-live 직후 트래픽 전) | n=0 | ℹ️ 정합(에러 아님) |

## 판정
- PROD 마이그 실적용 확정 (ledger 등재 + 3오브젝트 실재 + 함수 본문 exact-match).
- scalp clinics 유형 false-mark 위험 제거: git merge만으로는 미적용이었을 위험을 실측으로 봉인.
- ADDITIVE-1, 기존 값/행/경로 무손상. 파괴변경 없음.
- deployed 마킹 근거 충족.
