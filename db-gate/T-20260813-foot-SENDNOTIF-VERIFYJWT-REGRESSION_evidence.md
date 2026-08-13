# T-20260813-foot-SENDNOTIF-VERIFYJWT-REGRESSION — P0 알림 outage RC + fix evidence

- **executor**: dev-foot · **captured**: 2026-08-13 ~14:00Z (23:00 KST) · READ-ONLY 진단 (prod mutation 0, host mutation 0)
- **prod_ref**: rxlomoozakkjesdqjtvd (foot canon)
- **발견 경로**: T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON revoke-last 4-AND fresh 재검증(cond-3 secret-path 401=0 재측정) 중 401 급증 발견 → RC 규명.
- **severity**: **P0 — 라이브 고객 알림(예약 리마인더/확정) 전량 미발송 ~7.6h**
- **fix branch**: `feat/T-20260813-foot-SENDNOTIF-VERIFYJWT-REGRESSION` · commit `fb8060b0` (config.toml only) · **prod 반영 = supervisor config-authoritative 재배포 대기**

---

## 증상 (measured)

`public.notification_logs` 시간대별 status (2026-08-13, UTC):

| hour(Z) | sent | pending |
|---|---|---|
| 00:00 | 100 | — |
| 01–05 | 74 (누계) | — |
| 06:00 | 3 | 6 |
| 07:00 | 0 | 14 |
| 08:00 | 0 | 17 |
| 09:00 | 0 | 16 |
| 10:00 | 0 | 12 |
| 11:00+ | 0 | 3+ |

- **last successful sent = 2026-08-13 06:17:33Z (15:17 KST).** 이후 전건 `pending` (sent 0). 예약 리마인더/확정 알림 미발송.
- `net._http_response` (6h retain, 07:59–13:59Z): 401 n=649 (~108/h), 전건 `{"error":"Unauthorized"}`. :00/:30 각 50건 버스트 = **j10 `notify_retry_failed`** (`WHERE status IN('failed','pending') LIMIT 50` → 50 재시도 전건 401).

## Root Cause (confirmed)

1. **`send-notification` v43 재배포 @ 2026-08-13 06:30:28Z, verify_jwt=TRUE** (Functions API 실측).
2. `supabase/config.toml` 에 **`[functions.send-notification]` 블록 부재** → CLI plain deploy 기본값 `verify_jwt=true` 로 배포됨 → 게이트웨이가 anon Bearer JWT 단계에서 모든 cron 발신 **401** (EF 내부 X-Internal-Cron 검사 도달 전).
3. 트리거 배포 = commit `e79d52c0 [T-20260813-foot-KEEPWARM-SENDNOTIF-WARMPING-NON401]` (send-notification 수정 → v43). 아이러니하게 401 노이즈 제거 티켓이 전체 알림 outage 유발.

## Not vault-secret (격리 확증)

- 분당 cron 워커(dopamine-callback-dispatch / closing-confirmed-publisher / redpay-reconcile / attendance-sync / redpay-planb-match / payment-sync-drain / cancel-sync-drain) = **verify_jwt=false** → 전건 **200** (동일 X-Internal-Cron=NEW vault secret 수용). ∴ **vault NEW leg 정상**, 문제는 send-notification EF 게이트웨이 설정 단독.
- `notify_reminders_batch`(j5/j9) 와 `notify_retry_failed`(j10) 는 **동일 auth** (`X-Internal-Cron = COALESCE(GUC app.cron_secret, vault internal_cron_secret)` = NEW). 06:17Z 이전엔 200(정상), 06:30Z v43 배포 후 401 = 순수 verify_jwt flip.

## Fix

`supabase/config.toml` 에 형제 cron EF 컨벤션대로 등록:
```toml
[functions.send-notification]
verify_jwt = false
```
- 인증은 EF 내부 X-Internal-Cron 검증에 위임 (형제 redpay-reconcile/attendance-sync/closing-confirmed-publisher 동일) → unauth hole 없음.
- keep-warm anon ping(KEEPWARM-SENDNOTIF-WARMPING-NON401, auth 게이트 이전 200 no-op)과 무충돌.
- **durable**: 향후 send-notification 재배포마다 true 회귀하는 landmine 봉인.

## 잔여 (supervisor)

- **config-authoritative 재배포** (`--no-verify-jwt` 우회 아닌 config 기준) → 배포 후 verify_jwt=false 실측 대조 → j10 재시도/배치 200 회복 + pending 적체 drain 확인.
- 배포 직후 `notify_retry_failed` 가 48h 내 pending 자동 재발송 (백로그 자동 복구) — 별도 백필 불요 예상, drain 실측 필요.

## VAULT rotation 연계 (blocker)

- 본 outage 는 T-20260810-foot-VAULT-ROTATION revoke-last **cond-3(secret-path 401-rate=0) BLOCKER**. send-notification 401 해소 + 재측정 clean 전까지 revoke GO-token 요청 보류.
- cond-4(stale OLD-송신 caller 부재) 는 별개로 **해소됨**: macstudio obliv.foot poller `~/.env.redpay-foot` INTERNAL_CRON_SECRET = NEW(9eb7091f, digest 실측) cutover 완료, poller match_only 트리거 200(로그 실측 22:37–22:52 KST). backup `.bak-vaultrot-cutover-20260813012355` = OLD(bec0aa00) 확증.
