# T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON — pre-apply gate(4) stale-caller-absence 실측 (READ-ONLY)

- **measurer**: dev-foot (READ-ONLY, supervisor RECONCILE MSG-20260811-230617-pvu1 지시 범위)
- **when**: 2026-08-11 ~14:10Z (23:10 KST)
- **prod_ref**: rxlomoozakkjesdqjtvd (foot canon) · Management API `database/query` (READ-ONLY, prod mutation 0)
- **conn identity**: db=postgres · server_addr=2406:da18:243:7428:e6a2:69c0:e1ad:4cca → foot prod 확정
- **secret VALUE 미기록** (sha256-hex[0:8] digest only per RRN/PGSodium Runbook)
- **probe**: `scripts/T-20260810-foot-VAULT-ROTATION_gate4_probe.mjs` + launchd/env-file digest 대조

## 결론: ★gate(4) 전건 PASS 아님 — OLD-의존 active caller **발견** → A 중단 · 에스컬레이션 (blind 진행 금지)

| gate | 상태 | 근거 |
|---|---|---|
| (4a) vault=NEW + GUC NULL fresh (drift 0) | ✅ PASS | 하단 |
| (4b) 6 live internal-cron EF secret-bearing caller 열거 | ❌ **FAIL** | 하단 — 정적 OLD caller 존재 |
| (4c) affected EF 200-트래픽 中 OLD-secret 의존 부재 | ❌ **FAIL** | 하단 — poller OLD→redpay-reconcile 200 (active) |

---

## (4a) vault digest fresh + GUC fresh — ✅ PASS (drift 0)
- `vault.decrypted_secrets['internal_cron_secret']` sha256 = **`9eb7091f39ab5a0e93aa365c8dab6ab26216bc84c4b943cfa641d6fa3a92631f`** → sha8=`9eb7091f` == **NEW** (≠ OLD bec0aa00).
- GUC `app.cron_secret`: `guc_is_null=true` · `guc_len=0` → NULL 유지(미접촉).
- ∴ caller COALESCE(GUC[NULL], vault[NEW]) → **NEW** 송신. drift 없음.

## (4b) secret-bearing caller 열거 — ❌ FAIL

### pg_cron / net.http_post caller = 전건 NEW ✅
- cron.job 13개 active 확인. internal-cron 인증 EF 를 호출하는 caller fn 11개 전부 동일 패턴:
  `v_cron_secret := COALESCE(current_setting('app.cron_secret', TRUE), public.get_vault_secret('internal_cron_secret'))` → 헤더 `X-Internal-Cron`.
  (cancel_sync_drain · notify_reminders_batch · notify_reservation_messaging · notify_retry_failed · payment_sync_drain · process_closing_confirmed_outbox · process_dopamine_callback_outbox · trigger_attendance_sync · trigger_redpay_planb_match · trigger_redpay_reconcile · trigger_redpay_unreg_digest)
- GUC=NULL → 전부 vault(NEW) 송신. pg_cron 경로 = A 후 정상(401→200).

### ★비-pg_cron STATIC caller = OLD 송신 발견 (dispositive)
macstudio launchd 정적-env caller 열거 (supervisor (4b) 특별지시 대상):

| launchd label | 스크립트 | secret 소스 | digest | 대상 EF | 현재 | A 후 |
|---|---|---|---|---|---|---|
| **com.obliv.foot.redpay-macstudio-poller** (5min, LOADED) | `~/GitHub/obliv-foot-crm-redpay-poller/scripts/redpay_macstudio_poller.mjs` | `~/.env.redpay-foot` INTERNAL_CRON_SECRET | **`bec0aa00` = OLD** | redpay-reconcile | **200 (성공)** | **401 (깨짐)** |
| com.obliv.foot.redpay-macstudio-poller-dailyfull | 동일 스크립트 | `~/.env.redpay-foot` | `bec0aa00` = OLD | redpay-reconcile | 200 | 401 |
| com.medibuilder.redpay-recon | bash `source ~/.env.redpay` | `~/.env.redpay` INTERNAL_CRON_SECRET | `a6f49c3c` (제3값, ≠OLD·≠NEW) | redpay-reconcile | 이미 401 | 401 (cutover-중립) |
| com.medibuilder.redpay-recon-daily | bash `source ~/.env.redpay` | `~/.env.redpay` | `a6f49c3c` | redpay-reconcile | 이미 401 | 401 (cutover-중립) |
| com.obliv.foot.redpay-terminal-watchdog | redpay_terminal_watchdog.mjs | (internal-cron EF 호출 없음) | — | — | — | — |

→ **redpay-macstudio-poller(+dailyfull)** 가 정적 OLD(bec0aa00)를 `x-internal-cron` 으로 redpay-reconcile 에 송신. GUC/vault 경로 밖의 하드-env 소스. **A(EF primary→NEW) 시 이 caller 가 깨진다** = supervisor RECONCILE (4b)에서 명시 경고한 "정적 secret env poller가 OLD 송신" 케이스 실현.
※ redpay-recon/-daily 의 `a6f49c3c` = 제3의 stale 값 → 이미 401(rotation 무관 선-오설정), cutover-중립. plan-A 블로커 아님이나 별도 위생 정정 필요.

## (4c) affected EF 200-트래픽 中 OLD-secret 의존 — ❌ FAIL
- net._http_response (retention ~6h, 08:11Z–14:10Z, total 3510): 200×719 / 401×2784 / null×7.
  - 200 본문 = `{"ok":true,"dark":true,"reason":"PAYMENT_SYNC_EMIT_ENABLED=false"}`×360 + `{"ok":true,"dark":true,"reason":"CANCEL_SYNC_EMIT_ENABLED=false"}`×359. → **Δ2 EF(payment/cancel-sync-emit) feature-flag dark short-circuit** = auth 이전 반환 = **OLD-secret 무의존(safe)**.
  - 401 본문 = `{"ok":false,"reason":"unauthorized"}`×1470 + `{"error":"Unauthorized"}`×930 + `{"ok":false,"error":"unauthorized"}`×384 = pg_cron NEW-송신이 EF primary OLD 에 막힌 것(A 후 200 회복 대상).
- ★그러나 net._http_response 는 **pg_net(pg_cron) 콜만 로깅** → macstudio poller 의 직접 fetch 는 미포함. poller 로그(`~/logs/redpay_macstudio_poller.out`) 실측:
  - 매 5분 `EF match_only 트리거 완료: {"status":"ok",...}` (14:02:23Z, 14:07:28Z …) = **200 성공**.
  - redpay-reconcile 는 인증 강제(pg_cron NEW→401 실증). ∴ poller status:ok = OLD(bec0aa00)==EF primary OLD 매칭 = **OLD-secret 의존 200 트래픽 실재**.
- ∴ (4c) FAIL: redpay-reconcile 의 현행 200 中 OLD-의존(poller) 트래픽 존재 → A 시 이 트래픽이 401 로 전환.

---

## 권고 (dev-foot) — supervisor 분기 (i) 채택 제안
supervisor RECONCILE 분기: OLD-의존 caller 발견 → (i) 해당 caller secret 을 cutover set 에 포함(NEW 동시갱신) 후 A, 또는 (ii) 수정 dual-accept branch 정식 배포 후 revoke.

- **권고 (i)**: apply sequence 1(EF-env primary V1+V2 → NEW lockstep) 과 **동일 원자 단계에서** macstudio `~/.env.redpay-foot` 의 `INTERNAL_CRON_SECRET` → NEW(9eb7091f) 갱신 + poller launchd 재기동(2 label). 그래야 poller(NEW)==EF(NEW).
  - 부가: `~/.env.redpay` 의 `a6f49c3c` → NEW 정정(또는 redpay-recon/-daily 가 deprecated 이면 unload) — 이미 401인 stale caller 위생.
- cutover set = {EF-env INTERNAL_CRON_SECRET, EF-env CRON_SECRET, `~/.env.redpay-foot` INTERNAL_CRON_SECRET, (선택)`~/.env.redpay` INTERNAL_CRON_SECRET}. 전부 NEW lockstep.
- **blind 진행 금지 준수**: env-file 갱신/EF flip = 파괴 prod-write → supervisor fresh revoke DB-GATE GO-token 수령 후 apply. dev-foot 단독 rotation 금지.

## 정합 노트
- (4a) PASS = flip 착지 재확인(soak_measurement 와 일치). (4b/4c) FAIL 은 revoke 자체 문제 아니라 **cutover set 이 poller 정적-env 를 누락**한 데서 발생 → set 확장으로 해소.
- ball → supervisor: gate(4) 결과 = OLD-의존 caller 발견(poller). 분기(i) 승인 + cutover-set 확장 반영한 revoke GO-token 요청.
