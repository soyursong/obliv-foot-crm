# T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON — leg[b] FLIP 독립 재검증 (dev-foot)

**결론: FLIP 이미 완결 — 재-flip 불요·금지. 본 GO-token(재발송 MSG-20260810-110434) 승인 작업 = 완료 상태(idempotent re-invoke).**

## 맥락
- GO-token `db-gate/..._GO.token.json` (commit c89d4098, branch …-dualaccept, key_id `supv-dbgate-2026a`, nonce `968b0df70e576cdf`) — ed25519 서명 **self-verify PASS** (dev-foot 독립 검증).
- 이 메시지(110434 DB-GATE-REPLY) = 앞선 110326(미등록type silent-skip) canonical 재발송. 내용 동일.
- flip 은 **선행 실행 완료**: vault.secrets.updated_at = `2026-08-10 02:13:03.530356Z` (11:13 KST), 증적 commit `e26abfdb` (author fdd-supervisor, 11:14:55 KST, main + db-gate `_flip_evidence.md`). GO-token 발급 02:01:57Z / 만료 03:31:57Z → **window 내**.

## dev-foot 독립 재검증 (READ-ONLY, 2026-08-10 02:24Z / 11:24 KST · Management API, ref=rxlomoozakkjesdqjtvd)
평문 미노출 — sha256 digest-hex only.

| surface | digest | 판정 |
|---|---|---|
| vault.secrets internal_cron_secret (cnt=1) | `9eb7091f39ab…` | NEW ✅ (≠ bec0aa00 old) |
| EF `INTERNAL_CRON_SECRET` (primary) | `bec0aa005956…` | OLD (soak 잔존·revoke 대상) |
| EF `CRON_SECRET` (primary) | `bec0aa005956…` | OLD |
| EF `INTERNAL_CRON_SECRET_NEXT` | `9eb7091f39ab…` | NEW ✅ (== vault) |
| EF `CRON_SECRET_NEXT` | `9eb7091f39ab…` | NEW ✅ (== vault) |
| GUC app.cron_secret | (null·미접촉) | P2 non-locus |

- vault digest `9eb7091f` == EF `_NEXT` digest `9eb7091f` (독립 2경로 산출 일치) → 신값 정합.
- EF primary digest `bec0aa00` == GO-token `old_digest_sha256` (bec0aa00595651…) → 구값 정합.
- 재-flip 시 정확히 이 mismatch(vault≠token.old_digest) 로 precheck FAIL → **harmful 3rd-value 재기입 차단됨** (`scripts/apply_internal_cron_rotation_flip_T-20260810.mjs` 가드).

## 초기 무중단 health (flip 02:13:03Z 이후 ~13분, cron.job_run_details)
전 job `succeeded` · `failed` **0건**:
- foot-attendance-sync(V2) 1× · foot-closing-confirmed-worker(V2) 13× · foot-dopamine-callback-worker(V1) 13× · foot-redpay-planb-match(V1) 13× · foot-redpay-reconcile(V1) 3× · foot-cancel-sync-drain 13× · foot-payment-sync-drain 13× · keep-warm(anon) 3×.
- caller(wrapper)=vault 신값 송신, receiver=`_NEXT`(신)∨primary(구) 수용 → 하드 401 window 부재 초기 정합(선례 body-sibling 622078d4→d50f589b net 200×9/401×0).
- ※ 완전한 401-rate=0 실측(EF net response)은 soak≥28h 창에서 확정.

## 잔여 (revoke-last 4-AND 게이트 — 미착수)
- [ ] soak ≥28h: `00:00Z(j9)`·`09:00Z(j5)` daily send-notification 발사 각 ≥1회 span. flip=Aug10 02:13Z → **revoke 최조기 = Aug11 09:00Z 이후**.
- [ ] 401-rate=0 실측 (6 live 검증 EF·Δ2/미배포 제외) + stale caller 부재.
- [ ] revoke-old (V1+V2 lockstep): EF-env primary `INTERNAL_CRON_SECRET`=new·`CRON_SECRET`=new·`*_NEXT` clear. 한쪽 선-revoke 금지.
- [ ] revoke 후 재-digest + 무중단 로그 → supervisor 사후검증.

*executor=dev-foot · 본 파일=dev-foot 독립 재검증 trail (supervisor `_flip_evidence.md` 보완). prod WRITE 0 (READ-ONLY re-verify).*
