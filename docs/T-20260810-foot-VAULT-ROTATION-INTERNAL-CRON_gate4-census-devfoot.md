# T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON — gate(4) census + widen-ordering blocker (dev-foot)

> READ-ONLY census evidence for supervisor DECISION MSG-20260811-234159-7h5m (revoke DB-GATE GO-token 선결조건 1·2).
> No prod/host mutation performed (apply_before_go honored). Digest-only — no plaintext secret in this file.
> Host: domasui-MacStudio.local · captured 2026-08-11 ~23:16–23:48 KST.

## Reference digests (sha256, first 8 hex)
| label | digest | meaning |
|---|---|---|
| OLD | `bec0aa00` | pre-rotation INTERNAL_CRON_SECRET — **revoke target** |
| NEW | `9eb7091f` | post-flip vault value (current pg_cron caller value) |
| redpay-sep | `a6f49c3c` | `~/.env.redpay` value — separate hygiene track |
| redpay-hist | `1500de94` | historical `~/.env.redpay` (T-20260705 bak) |

## 1. Census completeness — "남은 live OLD-caller = 0 beyond the 2 gate-4 jobs" (PROVEN)

Method: enumerate every `INTERNAL_CRON_SECRET`/`CRON_SECRET` literal assignment across host config roots
(`~/.env*`, `~/fdd-agent-orchestrator`, `~/ops`, `~/scripts`, `~/Library/LaunchAgents`, `~/claude-sync/agents`),
sha256 each value, classify. Plists inspected for embedded literals. User crontab checked.

### OLD (`bec0aa00`) holders — host-wide, complete
| location | live-sourced? | note |
|---|---|---|
| `~/.env.redpay-foot` | **✅ LIVE** | sourced by the **2 gate-4 jobs** (`com.obliv.foot.redpay-macstudio-poller`, `…-poller-dailyfull`). Single shared env file. |
| `~/.env.redpay-foot.bak-0808gap-20260809135610` | ❌ inert | backup — poller sources only `.env.redpay` + `.env.redpay-foot`, never `.bak*` |
| `~/.env.redpay-foot.bak-20260728-175950` | ❌ inert | backup |
| `~/.env.redpay-foot.bak-20260803-075921` | ❌ inert | backup |
| `~/.env.redpay-foot.bak-511-20260723` | ❌ inert | backup |
| `~/.env.redpay-foot.bak.20260808-0806gap` | ❌ inert | backup |
| `~/.env.redpay-foot.bak.T-0728GAP` | ❌ inert | backup |

**⇒ The only LIVE process that sends OLD `bec0aa00` (via `x-internal-cron`) = the obliv.foot poller family
(2 launchd jobs, one shared env file `~/.env.redpay-foot`).** All other OLD occurrences are inert `.bak*` files
(hygiene cleanup, non-blocking for revoke). Matches supervisor's "발견된 2건(poller/dailyfull) 뿐" — CONFIRMED.

### Not OLD (documented per DECISION cond.1)
| location | digest | disposition |
|---|---|---|
| `~/.env.redpay` (+ `…bak-T20260811-legacyjwt-authfix`) | `a6f49c3c` | separate hygiene track. Sourced by `com.medibuilder.redpay-recon(+daily)` → **200 live**, but via **service-role path** (`Authorization: Bearer <sb_secret_ service key>`), NOT the `x-internal-cron` secret. Rotation-independent → **not an OLD caller**. |
| `~/.env.redpay.bak.T-20260705` | `1500de94` | historical, inert |

- **No plist embeds a literal secret** — all env-source (`grep 'x-internal-cron: <literal>'` = 0 hits).
- **No user crontab** cron_secret/redpay refs.

## 2. EF secret identity + caller-auth map (settled read-only)

`redpay-reconcile` auth (index.ts:307-314) = strict single-secret equality, **no dark short-circuit**:
`isInternalCron = INTERNAL_CRON_SECRET !== "" && cronHeader === INTERNAL_CRON_SECRET` **OR**
`isServiceRole = authHeader === "Bearer " + SERVICE_ROLE_KEY` → else 401.

- **EF `INTERNAL_CRON_SECRET` == OLD `bec0aa00`** — proven by obliv poller live log:
  `EF match_only 트리거 완료 {"status":"ok",…}` while sending `x-internal-cron`=OLD (14:37/14:42/14:47Z, 200).
- **obliv.foot poller** (`redpay_macstudio_poller.mjs`): env precedence `process.env → .env.redpay-foot (hi) → .env.redpay (lo)`
  → `INTERNAL_CRON_SECRET` = OLD. Its EF call is the **best-effort `match_only` trigger only** (line 1272-1282, non-fatal on 401).
  Its critical work (RedPay fetch + `redpay_raw_transactions` REST upsert) uses `sb_secret_` service-role → **rotation-independent**.
- **medibuilder recon**: `a6f49c3c` mismatches EF's `bec0aa00` → its 200 is the **service-role Bearer** path → cutover-inert.

## 3. ⚠ BLOCKER — widen-first-verify-200 is NOT satisfiable in current state

DECISION cond.2 asks: widen `~/.env.redpay-foot` OLD→NEW + reload → **verify redpay-reconcile 200 via actual NEW-match**,
**and complete widen+verify BEFORE revoke**; cond.3 attaches "widen evidence" to the FOLLOWUP that mints the revoke GO-token.

**This ordering is physically impossible as written**, because:
- EF `INTERNAL_CRON_SECRET` is currently **OLD**, and the dual-accept EF code (`ca4dd709`) is **NOT deployed** (this is the incident RC).
- ⇒ The EF accepts **only OLD** right now. Widening the poller env to **NEW** makes its `x-internal-cron`=NEW → **401**, not 200.
- ⇒ "200 via NEW-match" can only be observed **after** the EF primary is flipped to NEW — but that flip **is** the gated apply/revoke step (cond.3). Circular: verify-200 needs the flip; the flip needs the (post-widen-evidence) GO-token.

### Two viable executions (supervisor to choose — GO-token bound to the choice)

- **Plan A — dual-accept as the EF-side widen (zero-window, matches invariant literally).**
  Deploy `ca4dd709` dual-accept (EF accepts OLD∨NEW via `*_NEXT`=NEW) = the "widen". Then widen poller env→NEW + reload →
  **verify poller match_only 200 via NEW (`*_NEXT`) path** = the widen-evidence cond.2/3 asks for. Then under fresh revoke
  GO-token: flip EF primary V1+V2 OLD→NEW, **clear `*_NEXT`** (= revoke). Zero 401 window for any caller.
  Note: supervisor's RECONCILE rejected dual-accept **as a pg_cron fix** (no OLD pg_cron caller to protect). Census now
  shows a **real OLD caller (obliv poller)** → dual-accept regains its original purpose here: it is precisely "이 caller 를
  widen 불변식에 편입" with zero window.

- **Plan B — lockstep flip+widen (no redeploy; ≤5-min non-fatal window).**
  Under fresh revoke GO-token: (1) flip EF primary V1+V2 OLD→NEW [pg_cron 401→0 immediately; obliv poller `match_only`
  trigger enters ≤5-min 401 — **non-fatal**, RedPay fetch+REST upsert unaffected]; (2) immediately widen `~/.env.redpay-foot`
  →NEW + `launchctl kickstart` poller; (3) clear `*_NEXT`; (4) verify pg_cron 6-EF 401→0 fresh + poller match_only 200 NEW.
  "widen-evidence" here is **post-flip** (can't precede the flip). Accepts one ≤5-min degraded-matcher window on a
  best-effort, idempotent path.

**Recommendation: Plan A** (true zero-window widen→verify→revoke; satisfies cond.2/3 literally; low incremental cost —
`ca4dd709` already reviewed/PASSED code-gate 2026-08-10, only its deploy was withheld). Plan B is acceptable if supervisor
wants no EF redeploy and tolerates the ≤5-min non-fatal window.

## 4. apply_before_go status
Zero prod/host mutation. `~/.env.redpay-foot` **NOT** widened (widening pre-flip would 401 a currently-200 caller and is
part of the gated apply lockstep). Awaiting supervisor: (a) ordering ruling (Plan A/B) + (b) fresh revoke DB-GATE GO-token.
No new safe-cutover-불명 OLD-caller found ⇒ 협약 재발동(A-pause/CEO) **not** triggered; this is an execution-ordering clarification.
