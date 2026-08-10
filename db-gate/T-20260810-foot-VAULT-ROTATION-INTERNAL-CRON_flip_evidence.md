# T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON — leg[b] value-swap FLIP evidence

- **executor**: dev-foot
- **gate**: DB-GATE-GO token `db-gate/T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON_GO.token.json` (commit c89d4098, branch …-dualaccept), key_id `supv-dbgate-2026a`, nonce `968b0df70e576cdf`.
- **flip executed**: 2026-08-10 ~02:15Z (11:15 KST) — GO-token window issued 02:01:57Z / expires 03:31:57Z → **within window**.
- **prod_ref**: rxlomoozakkjesdqjtvd (foot canon). apply surface = Supabase Management API (query endpoint + secrets endpoint), ref explicitly scoped (dev-isolation kcdqtyivtqcjmcrdjkqi 오접속 원천차단).
- **secret VALUE = plaintext 미기록** (digest-hex only per RRN/PGSodium Runbook).

## PREFLIGHT (apply_before_go-safe, READ-ONLY)
- conn: `db=postgres` · `server_addr=2406:da18:243:...` present · ref=rxlomoozakkjesdqjtvd → foot prod 확정.
- pre-state: `vault_total=11` · `icron_cnt=1` (EXISTS) · vault digest = `bec0aa00595651a51aff3002cca82665d14e54dd311ace171a695d1641eaa728` → **GO-token old_digest_sha256 정확일치** (DIVERGENCE=가설A RESOLVED 재확인·09:21 EMPTY=dev-isolation artifact 확정).
- GUC `app.cron_secret`: `guc_is_null=true` · `guc_len=0` → **P2 live locus 아님. 미접촉**(신규 set 금지 준수).
- EF-env pre-state: `INTERNAL_CRON_SECRET`=bec0aa00 · `CRON_SECRET`=bec0aa00 · `*_NEXT`=unset(dual-accept no-op).

## FLIP (DA revoke-last 불변식 순서: widen(旣충족) → *_NEXT=new → vault → re-digest)
- **NEW digest (sha256-hex)**: `9eb7091f39ab5a0e93aa365c8dab6ab26216bc84c4b943cfa641d6fa3a92631f` (256-bit random).
1. **EF-env `*_NEXT`=new** (HTTP 201): `INTERNAL_CRON_SECRET_NEXT`=9eb7091f (V1, 5EF group incl. dopamine-callback-dispatch const-name mismatch→reads INTERNAL_CRON_SECRET_NEXT) · `CRON_SECRET_NEXT`=9eb7091f (V2, 2EF group). masked digest 재조회 == NEWDIGEST 확인.
2. **vault P1 UPDATE** (HTTP 201): `vault.update_secret()` inside DO block with **rows-affected=1 assert** (`v_cnt<>1 → RAISE EXCEPTION` abort guard). 예외 없이 완료 → 1-row target write 성공 (0-row silent write 위험 CLEARED, cross_crm_write_rowcheck_standard 준수).
3. **fresh-conn 재-digest** (HTTP 201): `icron_cnt=1` · digest = `9eb7091f39ab5a0e93aa365c8dab6ab26216bc84c4b943cfa641d6fa3a92631f` == NEWDIGEST, **≠ bec0aa00** → vault flip 확정.

## POST-FLIP STATE (dual-accept 병존 확인)
| surface | value |
|---|---|
| vault.secrets internal_cron_secret | NEW (9eb7091f) |
| EF `INTERNAL_CRON_SECRET` (primary) | OLD (bec0aa00) |
| EF `INTERNAL_CRON_SECRET_NEXT` | NEW (9eb7091f) |
| EF `CRON_SECRET` (primary) | OLD (bec0aa00) |
| EF `CRON_SECRET_NEXT` | NEW (9eb7091f) |
| GUC app.cron_secret | NULL (미접촉) |

→ caller(pg_cron wrapper)는 vault 신값 송신, receiver(6 live 검증 EF)는 `_NEXT`(신)·primary(구) 양쪽 수용 → **하드 401 window 부재**. Δ2 EF(crm-payment/cancel-sync-emit)=rotation-inert(anon-Bearer JWT축·미read)·무영향.

## 잔여 (revoke-last 4-AND 게이트 — 미착수, 별 실행)
- [ ] **soak ≥28h**: `00:00Z(j9)`·`09:00Z(j5)` daily send-notification 발사 각 ≥1회 span 필수. flip=Aug10 02:15Z → 최소 span 충족 = Aug11 09:00Z 이후.
- [ ] **401-rate=0 실측**: 6 live 검증 EF 로그(Δ2·미배포 redpay-unreg-digest 제외) + stale caller 부재.
- [ ] **revoke-old (V1+V2 lockstep)**: EF-env primary `INTERNAL_CRON_SECRET`=new · `CRON_SECRET`=new · `*_NEXT` clear. 한쪽 선-revoke 금지. (vault old=flip 시점 旣교체.)
- [ ] evidence 갱신(revoke 후 재-digest + 무중단 로그) → supervisor 사후검증.

## 선례 정합
- body-sibling(hmxnjdmdgfxmsfvytssm) 동일 rotation: 09:16 GO → 09:41 무중단 완결(digest 622078d4→d50f589b · net 200×9 / 401×0).
