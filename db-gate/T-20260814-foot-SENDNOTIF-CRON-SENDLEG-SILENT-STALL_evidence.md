# T-20260814-foot-SENDNOTIF-CRON-SENDLEG-SILENT-STALL — RC + fix + drain evidence

- **executor**: dev-foot
- **commit**: `71f75af856778f6ff207fd806f7149a9ce339ce4` (branch `fix/T-20260814-foot-SENDNOTIF-CRON-SENDLEG-SILENT-STALL`)
- **artifact-class**: `ef_only` (send-notification Edge Function). db_change=false · MIG-GATE 무대상 · secret write/vault 접촉 0.
- **prod_ref**: rxlomoozakkjesdqjtvd (foot canon). deployed version=**47** · verify_jwt=**false**(landmine 회피) · status=ACTIVE.
- **secret plaintext 미기록** (digest-hex prefix only, per RRN/PGSodium Runbook).

## RC — 격리 + VAULT 연계 판정 (AC-1)
부모 T-20260813-VERIFYJWT-REGRESSION 로 게이트웨이 open(verify_jwt=false, no-auth probe 200) 후에도 실 send 미재개.
= **하류 실발신 leg(X-Internal-Cron 인증) 별개 결함**.

- **caller**(pg_cron `notify_reminders_batch`/`notify_retry_failed`, messaging_module.sql L623/709):
  `X-Internal-Cron = COALESCE(GUC app.cron_secret[NULL], vault get_vault_secret('internal_cron_secret'))` → **vault 값 송신**.
- **EF**(send-notification/index.ts, 구 L484): `isCronCall = INTERNAL_CRON_SECRET!=="" && cronSecret===INTERNAL_CRON_SECRET`
  → **primary env 단일값만 대조** (코드에서 `_NEXT` 미read).

### LIVE 실측 대조 (2026-08-14 ~01:45Z, digest-hex)
| side | source | digest prefix |
|---|---|---|
| caller sends | vault `internal_cron_secret` | `9eb7091f…` (=NEW) |
| EF checks (code) | env `INTERNAL_CRON_SECRET` | `bec0aa00…` (=OLD) |
| EF has (unused by code) | env `INTERNAL_CRON_SECRET_NEXT` | `9eb7091f…` (=NEW) |

→ caller NEW(9eb7091f) ≠ EF primary OLD(bec0aa00) → **매 크론 POST 401** at index.ts (구 L506, auth 게이트) →
`logNotification` 도달 前 반환 → pre-inserted pending row 무진행 = **recipient_phone/body_rendered/solapi_message_id/error_code
전부 NULL = silent no-op**(지문 정확 일치).

**VAULT rotation 연계 = 확정.** T-20260810-VAULT-ROTATION-INTERNAL-CRON 이 mid-window(vault=NEW / EF primary=OLD /
`_NEXT`=NEW)로 방치됐고, 그 rotation 의 "dual-accept" 는 **env-only no-op**(어떤 EF 도 `_NEXT` 를 코드에서 read 안 함 —
evidence L13 "dual-accept no-op" 자인)이었던 것이 근본. revoke-last(primary→NEW) 미착수 상태와 결합해 401 window 상시화.
retry sweep(`notify_retry_failed`)은 `UPDATE ...SET status='pending'` 후 POST → row 는 touch(→pending)되나 EF 401 로
render/stamp 무발생 = supervisor 관측 "retry sweep touch됐으나 sent0·error0" 정합.

## FIX (index.ts)
1. **code-level dual-accept**: `INTERNAL_CRON_SECRET` + `INTERNAL_CRON_SECRET_NEXT` 를 모두 read →
   `CRON_ACCEPT_SET`(빈값 제외) → `isAcceptedCronSecret(presented)` = 집합 포함 판정. caller NEW(=_NEXT) 즉시 수용.
   revoke 후(primary=NEW, _NEXT clear)에도 무결(어느 rotation phase 든 accept).
2. **AC-4 silent no-op seal**: 401 경로에서 X-Internal-Cron 실림 + accept-set 불일치 시
   `[CRON-SECRET-MISMATCH]` **console.error** 격상(plaintext 미기록, presented_len/accept_set_size 만) →
   rotation drift 를 edge_logs raw grep 로 즉시 관측(무징후 stall 재발 클래스 차단).

시크릿 write/vault 접촉 0 (env 이름 read 만) → secret 재취급 아님 → **T-20260810 revoke GO-token hold(cond-3) 유지**.

## 실 send drain 검증 (AC-2 / AC-3) — 2026-08-14 01:46Z prod
| metric | PRE (01:45Z) | POST (01:47Z) |
|---|---|---|
| latest sent_at | 2026-08-13 06:17:33Z (frozen 28h+) | **2026-08-14 01:46:26Z** |
| pending (silent-fp: rp/body/err NULL) | **75** | **0** |
| sent (sent_at > fix 01:46Z) | 0 | **75** |
| failed (updated > fix) | — | **0** |

- recovery = sanctioned `notify_retry_failed(false)` × 2 sweep(50 + 25, LIMIT 50/run) — vault secret server-side read(무 plaintext).
- 75 pending 전건 sent 전이(0 fail) → **AC-2 실 send 재개 + AC-3 backlog 잔여 0** 동시 충족.
- 신규 pending 은 게이트 정상화로 스케줄 크론(jobid5/9/10 + retry) 자연 드레인(forward-safe).

## 잔여 / 인접
- **T-20260810 revoke-last**: 이제 EF 가 primary+_NEXT 양쪽 수용 → revoke(primary=NEW, _NEXT clear) **무중단 안전**.
  단 secret 재취급은 supervisor DB-GATE/secret lane 소관 — 본 티켓은 미착수(hold 유지).
- supervisor QA: prod 실 send drain(AC-2/AC-3) 재실측 + edge_logs 401-rate=0 확인 권장.
