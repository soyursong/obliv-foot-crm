# T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON — revoke-last 4-AND **fresh evidence** (G1 + G3)

- **executor**: dev-foot · **captured**: 2026-08-13 ~00:50Z (09:50 KST) · READ-ONLY (no prod mutation, no host mutation, no plaintext)
- **prod_ref**: rxlomoozakkjesdqjtvd (foot canon) · **flip anchor**: NEW vault flip = Aug10 02:15Z (`_flip_evidence.md`)
- **reproduce**: `node scripts/T-20260810-foot-VAULT-ROTATION_revokelast_G1G3_probe.mjs`
- **evidence source**: Management API SQL query endpoint over `net._http_response` (pg_net, 6h retained) + `cron.job` + `pg_get_functiondef` + `public.notification_logs` (app-level, multi-day) + Functions API (verify_jwt/deploy).
- **scope reminder**: this packet = dev-foot's revoke-last 4-AND ball (G1 + G3). Revoke apply = **supervisor** DB-GATE lane (G2 pg_proc invariance + G4 apply-time re-probe). GO-token 발행 前 prod 무접촉 준수(read-only probes only).

---

## G1 — per-caller 401 attribution freeze + positive-control → **PASS** (secret-mismatch 401 = 0)

Retained window: **Aug12 18:51Z → Aug13 00:50Z (6h, post-flip fresh)**. Total responses n=1379.

**401 breakdown (n=73):**

| content signature | n | attribution | rotation? |
|---|---|---|---|
| `{"error":"Unauthorized"}` | **72** | jobid6 `foot-ef-send-notification-keep-warm` | **rotation-INVARIANT** (by-design) |
| `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` | 1 | jobid33 `redpay-unreg-digest` (see note) | rotation-INVARIANT (gateway verify_jwt) |

**jobid6 keep_warm = 100% of residual (12/h) — textbook cadence:**
- min-of-hour histogram: **6 at each of :00,:05,:10,…,:55 — all ≡ 0 (mod 5)** = j6 `*/5` schedule exactly.
- per-hour count: **12/h for every full hour** (19,20,21,22,23,00) — **zero hourly excess**.
- structural (pg_proc `keep_warm_send_notification`): headers = `Content-Type` + `Authorization: Bearer <anon>` **only**; **NO `X-Internal-Cron`**; body `{"keep_warm":true}` (no `_action`). → send-notification auth gate returns `{"error":"Unauthorized"}` **by design**; the invocation still warms the container. Does **not** reference the cron secret / accept-set → **revoke 前後 불변**.

**Positive control (secret-mismatch 401 = 0):** a secret-path 401 (real caller sends `X-Internal-Cron`, EF rejects the value) would appear as an **hourly excess above 12/h** or an **off-`*/5` 401**. **None observed.** No `{"error":"Unauthorized"}` 401 traces to a batch/secret caller.

### ⚠ G1 note — the 1 `UNAUTHORIZED_NO_AUTH_HEADER` (jobid33 redpay-unreg-digest) — NOT a secret-mismatch, flag for adjudication
- Fired once at **00:00:01Z** (j33 `foot-redpay-unreg-digest [0 0 * * *]`), alongside an 00:00 transient **DNS blip** (8× pg_net DNS-timeout 5000ms, `status=null`, content=null — never reached server → cannot be an auth 401).
- Root: `redpay-unreg-digest` EF has **verify_jwt=true**, but its wrapper `trigger_redpay_unreg_digest` sends `X-Internal-Cron` **without an `Authorization` header** → **gateway rejects for missing-auth-header, BEFORE the internal cron-secret is ever evaluated**.
- ⇒ **rotation-invariant** (fails identically on OLD or NEW; the secret value is never tested) and structurally distinct (`UNAUTHORIZED_NO_AUTH_HEADER` ≠ send-notification `Unauthorized`). It does **NOT** indicate the NEW leg is rejected. `redpay-unreg-digest` is a pre-existing broken/out-of-scope EF (excluded from the "6 live 검증 EF" in flip evidence).
- **DA/supervisor adjudication requested**: DA VOID condition is literally "실 caller가 X-Internal-Cron 전송하고 401". This caller *does* send X-Internal-Cron and *does* get 401 — but the 401 is a gateway missing-auth reject (rotation-invariant), not a secret-match failure. Per DA §ADDENDUM intent ("secret-path caller 실패하는가"), this is **outside the protected class** and should **not** trip VOID — but flagged transparently rather than silently absorbed.

---

## G3 — real-caller 200-on-NEW-leg (positive control) → **PASS**

**App-level (definitive), `notification_logs status='sent'` since flip:**

| day | event_type | sent | caller |
|---|---|---|---|
| 08-13 | resv_reminder_morning | **96** | j9 `notify_reminders_batch(morning)` 00:00 (today) |
| 08-13 | resv_confirm | 4 | webhook/manual |
| 08-12 | resv_reminder_d1 | **99** | j5 `notify_reminders_batch(d1)` 09:00 |
| 08-12 | resv_reminder_morning | 84 | j9 |
| 08-12 | resv_confirm | 279 | |
| 08-10 | resv_reminder_d1 | **78** | j5 09:00 |
| 08-10 | resv_confirm | 190 | |

Every `sent` ⟹ send-notification EF **accepted the batch's `X-Internal-Cron` = COALESCE(GUC NULL → vault NEW)** and completed the SMS. GUC `app.cron_secret` = NULL (flip evidence) → wrapper uses **vault = NEW** → NEW-leg accepted across a **multi-day soak spanning j5 (09:00) and j9 (00:00)**. (The 08-11 quiet day = no due reminders, only `skipped`.)

**Fleet-level (net._http_response 6h) — full `X-Internal-Cron` fleet returns non-401 ⇒ vault-NEW universally accepted:**

| caller (wrapper→EF) | status | n | meaning |
|---|---|---|---|
| j15 `trigger_attendance_sync` → attendance-sync | 200 | 24 (`*/15`) | NEW accepted |
| j27 `trigger_redpay_planb_match` → redpay-planb-match | 200 | 360 (`* * * * *`) | NEW accepted |
| j28 `payment_sync_drain` → crm-payment-sync-emit | 200 (dark) | 360 | NEW accepted |
| j36 `cancel_sync_drain` → crm-cancel-sync-emit | 200 (dark) | 360 | NEW accepted |
| j14 `trigger_redpay_reconcile` → redpay-reconcile | 500 (upstream 403) | 72 (`*/5`) | **auth PASSED** (reached upstream, not 401) |

All 5 wrappers send `X-Internal-Cron = vault NEW`; **zero 401** among them → EF fleet **dual-accepts {OLD, NEW}** and NEW is live. redpay-reconcile 500 = downstream RedPay VAN 403 (separate pre-existing redpay flap), **not** a cron-secret failure.

---

## 4-AND rollup (dev-foot ball) + ⛔ BLOCKER

| gate | owner | status |
|---|---|---|
| flip 착지 | dev-foot | ✓ (旣확인, `_flip_evidence.md`) |
| soak ≥ max cron cycle | dev-foot | ✓ (flip Aug10 → now ~3d; j5 09:00 + j9 00:00 multi-fire) |
| **G1** residual 401 = 100% jobid6 keep_warm, secret-mismatch 401 = 0 | dev-foot | **✓ PASS** |
| **G3** real-caller 200-on-NEW-leg | dev-foot | **✓ PASS** |
| stale caller 부재 (2 OLD poller → NEW cutover) | dev-foot | **⛔ NOT MET — see below** |
| G2 rotation-invariance (pg_proc) | supervisor | pending |
| G4 apply-time fresh re-probe (drift→ABORT) | supervisor | pending (at revoke) |

### ⛔ STALE-CALLER PRECONDITION FALSE — contradicts MQ "旣 PROVEN"
Fresh read (2026-08-13 00:52Z) shows the macstudio poller is **still OLD**, i.e. poller cutover (PREP step2) is **NOT done**:
- `~/.env.redpay-foot` `INTERNAL_CRON_SECRET` digest = **`bec0aa00…` (OLD)** — not `9eb7091f…` (NEW). Both foot poller plists (`…redpay-macstudio-poller`, `…-dailyfull`) do **not** inject the secret → value loaded from this file = OLD.
- Poller `triggerMatcher()` (redpay_macstudio_poller.mjs L1317, fires when `totalUpserted>0`) calls `POST /functions/v1/redpay-reconcile` with `x-internal-cron: INTERNAL_CRON_SECRET` = **OLD**. Currently succeeds via dual-accept; **last OLD EF-trigger = Aug12 15:02Z**.
- After revoke-old (OLD dropped from EF accept-set) this call → **401** (best-effort/non-fatal to reconcile — upserts already done via service_role — but the match_only re-tier silently stops + generates fresh secret-path 401 noise).

⇒ The MQ's "stale caller 부재 (2 OLD poller NEW cutover 포함) 旣 PROVEN" is **not** reflected by prod host state. Revoke-old is **NOT safe** until the poller is cut over OLD→NEW.

**Fix (dev-foot lane, PREP-documented, widen-green, reversible):** execute `PREP-T-20260810-…_step2-poller-cutover` — in-place swap `~/.env.redpay-foot INTERNAL_CRON_SECRET` OLD→NEW (perm 0600, backup), `launchctl kickstart -k` both foot pollers, verify digest==`9eb7091f…`. NEW-acceptance already proven by j14 (redpay-reconcile accepts NEW today). Held pending planner confirmation of the census conflict (not executed unilaterally, per scope).

---

## Verdict (dev-foot)
- **G1 = PASS · G3 = PASS** (fresh, post-flip, multi-day soak).
- **DO NOT mint a clean revoke GO-token yet** — stale-caller precondition FALSE (live OLD poller). Requesting a GO-token now would be a false-green.
- Ball → planner: reconcile "旣 PROVEN" vs this fresh read; authorize dev-foot PREP-step2 poller cutover; **then** supervisor mints fresh revoke DB-GATE GO-token (flip token c89d4098 does not cover revoke; no reuse/extend — apply_before_go class).
