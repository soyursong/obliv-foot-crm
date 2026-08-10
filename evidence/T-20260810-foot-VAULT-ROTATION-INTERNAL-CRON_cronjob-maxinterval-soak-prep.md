# T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON — cron.job 열거 → max-interval soak 산출 (prep)

- 성격: READ-ONLY prep (GO-token 무관). Management API SELECT only. prod WRITE 0 · DDL 0.
- project: foot (rxlomoozakkjesdqjtvd) · server tz = UTC (now() 실측 확인).
- 목적: DA revoke-last 게이트 2항("최소 1 full cron cycle soak = max-interval 잡이 flip 후 ≥1회 발사") 정량화.

## 1. cron.job 전수 census — 실측 **13 active** (planner 전제 "7건"과 불일치 ★)

| jobid | jobname | schedule (UTC) | interval | 호출 pg fn → EF | app.cron_secret 사용 |
|---|---|---|---|---|---|
| 5  | foot-notif-reminder-d1        | `0 9 * * *`   | **DAILY 09:00Z** | notify_reminders_batch → send-notification | **YES** |
| 6  | foot-ef-send-notification-keep-warm | `*/5 * * * *` | 5m | keep_warm_send_notification → send-notification | NO (anon key only) |
| 9  | foot-notif-reminder-morning   | `0 0 * * *`   | **DAILY 00:00Z** | notify_reminders_batch → send-notification | **YES** |
| 10 | foot-notif-retry-failed       | `*/30 * * * *`| 30m | notify_retry_failed → send-notification | YES |
| 12 | foot-dopamine-callback-worker | `* * * * *`   | 1m | process_dopamine_callback_outbox → dopamine-callback-dispatch | YES |
| 14 | foot-redpay-reconcile         | `*/5 * * * *` | 5m | trigger_redpay_reconcile → redpay-reconcile | YES |
| 15 | foot-attendance-sync          | `*/15 * * * *`| 15m | trigger_attendance_sync → attendance-sync | YES |
| 18 | foot-closing-confirmed-worker | `* * * * *`   | 1m | process_closing_confirmed_outbox → closing-confirmed-publisher | YES |
| 27 | foot-redpay-planb-match       | `* * * * *`   | 1m | trigger_redpay_planb_match → redpay-planb-match | YES |
| 28 | foot-payment-sync-drain       | `* * * * *`   | 1m | payment_sync_drain → crm-payment-sync-emit | YES |
| 30 | foot-pmw-autopromote          | `15 19 * * *` | DAILY 19:15Z | promote_reconciled_payment_waiting | NO (http_post 없음, SQL-only) |
| 33 | foot-redpay-unreg-digest      | `0 0 * * *`   | **DAILY 00:00Z** | trigger_redpay_unreg_digest → redpay-unreg-digest | **YES** |
| 36 | foot-cancel-sync-drain        | `* * * * *`   | 1m | cancel_sync_drain → crm-cancel-sync-emit | YES |

## 2. flip-caller 표면 = secret-bearing 11개 (2개 carve-out)
- carve-out(secret 미사용, revoke-last 무관): **jobid=6 keep-warm**(anon key), **jobid=30 pmw-autopromote**(net.http_post 없음, 순수 SQL).
- 나머지 11개는 `current_setting('app.cron_secret')` 를 caller secret 으로 사용 → flip 시 P2 GUC swap 영향 대상.

## 3. max-interval soak 산출 (★핵심 deliverable)
- secret-bearing caller 중 **최대 인터벌 = DAILY(24h)**: jobid=5(09:00Z), jobid=9(00:00Z), jobid=33(00:00Z).
- ∴ **일배치 존재 → soak ≥ 24h + margin 확정** (planner 조건부 "일배치 존재 시 soak ≥24h+margin" = TRUE).
- 권장 soak 창: flip 착지 시점부터 **≥ 24h + 2~4h margin (≈28h)** 유지. 그 창 안에 00:00Z 및 09:00Z daily 발사가 각 1회 이상 포함되어야 revoke-old 게이트 2항 충족.
- non-secret daily(jobid=30, 19:15Z)는 soak 산정에서 제외(secret 무관).

## 4. daily 발사 실재 검증 (cron.job_run_details, now=2026-08-10 01:19Z)
- jobid=5  last_run=2026-08-09 09:00:00Z status=succeeded
- jobid=9  last_run=2026-08-10 00:00:00Z status=succeeded
- jobid=33 last_run=2026-08-10 00:00:00Z status=succeeded
- jobid=10 last_run=2026-08-10 01:00:00Z status=succeeded
- jobid=30 last_run=2026-08-09 19:15:00Z status=succeeded (secret 무관 참고치)
- → daily 잡 전건 정상 발사·성공. 24h soak 창은 daily secret-bearing 발사를 확실히 포착함.

## 5. 상위 게이트로 넘기는 discrepancy (내 소관 아님 — supervisor 4항 RECONCILE)
- (a) planner/DA 전제 "7 pg_cron 잡" vs 실측 **13 active(11 secret-bearing)** — soak 대상 집합 재확정 필요.
- (b) secret-bearing caller 가 겨냥하는 **distinct EF = 9종**(send-notification, dopamine-callback-dispatch, redpay-reconcile, attendance-sync, closing-confirmed-publisher, redpay-planb-match, crm-payment-sync-emit, redpay-unreg-digest, crm-cancel-sync-emit) vs DA 문서 "7 EF rotation set(5 INTERNAL + 2 CRON)". EF 표면·vault-vs-GUC locus 확정 = supervisor authoritative 4항 RECONCILE 소관(본 prep 은 flag 만, 값-swap 표면 미확정).
- (c) send-notification 은 keep-warm(anon)+reminders(cron-secret) 양쪽 수신 → leg[a] dual-accept widen-verifier 필요성과 정합.
