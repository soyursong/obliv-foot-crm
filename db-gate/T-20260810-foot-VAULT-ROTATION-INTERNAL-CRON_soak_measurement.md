# T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON — soak 만료後 4-AND 측정 = ★DIRTY (revoke HOLD)

- **measurer**: dev-foot (READ-ONLY, supervisor 승인 "soak 모니터링/측정 자율 OK" 범위)
- **when**: 2026-08-11 ~13:50Z (22:50 KST)
- **prod_ref**: rxlomoozakkjesdqjtvd (foot canon) · Management API query/secrets endpoint (READ-ONLY, prod mutation 0)
- **secret VALUE 미기록** (digest-hex only)

## 4-AND revoke 게이트 측정 결과
| 게이트 | 상태 | 근거 |
|---|---|---|
| (1) flip 착지 | ✅ | vault digest=9eb7091f(NEW) |
| (2) soak ≥28h | ✅ | flip Aug10 02:15Z → now Aug11 13:50Z ≈ 35.5h |
| (3) 401-rate=0 실측 | ❌ **FAIL** | net._http_response 최근 retention(~6h) 내 **401 다수·정상상태 ~450–580/h** |
| (4) stale caller 부재 | ⚠ 미판정 | (3) 우선 — 아래 참조 |

→ **4-AND 미충족 → revoke GO-token 요청 보류(HOLD). false-green revoke 방지.**

## 측정치 (READ-ONLY)
- cron.job_run_details (flip後): succeeded 11748 / failed 0 — 단 cron SQL 함수는 fire-and-forget이라 EF 401을 흡수(작업성공 ≠ 콜 성공).
- net._http_response (retention 실측 ~6h: earliest 07:51Z / latest 13:50Z / total 3533):
  - 401 steady: 07h=54, 08h=504, 09h=582, 10h=475, 11h=429, 12h=408, 13h=356
  - 200: 시간당 ~120
- 401 본문 분포: `{"ok":false,"reason":"unauthorized"}`×1483 · `{"error":"Unauthorized"}`×941 · `{"ok":false,"error":"unauthorized"}`×384
- 본문 지문 → EF 매핑:
  - `reason:unauthorized` = dopamine-callback-dispatch(job12 매분) + closing-confirmed-publisher(job18 매분)
  - `error:Unauthorized` = redpay-reconcile(job14) / send-notification
  - `ok:false,error:unauthorized` = redpay-planb-match(job27) / attendance-sync(job15) 등

## ★ROOT CAUSE (deterministic, 하드 증거)
현재 prod 상태:
| surface | value |
|---|---|
| vault internal_cron_secret | NEW 9eb7091f |
| EF-env INTERNAL_CRON_SECRET / CRON_SECRET (primary) | **OLD bec0aa00** |
| EF-env *_NEXT | NEW 9eb7091f |
| GUC app.cron_secret | NULL |

- caller(process_dopamine_callback_outbox 등): `COALESCE(GUC app.cron_secret[NULL], vault internal_cron_secret[NEW])` → **NEW 송신**.
- EF 검증 코드(dopamine-callback-dispatch:86 / closing-confirmed-publisher:58 등): `if (got !== CRON_SECRET) return 401` — **단일값 검증, `CRON_SECRET_NEXT` 미읽음**.
- 즉 **dual-accept EF 코드가 prod에 배포된 적 없음**(leg[a] branch ca4dd709 = supervisor deploy NO-GO Aug10 00:29Z, main 미머지 — repo `_NEXT` refs=0, git log 확인).
- flip은 caller의 secret 소스(vault)를 NEW로 교체했으나 EF는 OLD만 수용 → **하드 cutover 미스매치 → 35h 정상상태 401**.
- flip GREEN ACK(Aug10 02:33Z)는 rotation-inert Δ2 EF(payment/cancel-sync-emit, anon-Bearer 축)만 검증 → 실 internal-cron EF의 post-flip 401 미검증 = **false-green**.

## 기능 영향 (PROD, ~35h)
- dopamine-callback-dispatch 401 → 도파민 콜백 미발송(D2/D4 데이터흐름 단절)
- closing-confirmed-publisher 401 → 매출마감 전령 미발행
- redpay-reconcile / redpay-planb-match / attendance-sync 401 → 정산·근태 sync 저하

## 잔여 결정 = supervisor RECONCILE + GO-token (dev-foot 자율 밖·apply_before_go)
현재 env가 이미 `*_NEXT`=NEW / vault=NEW로 staged 되어 있어 하기 3안 모두 즉시 401 해소:
- **(A) rotation 완결(=revoke)**: EF-env primary INTERNAL_CRON_SECRET/CRON_SECRET=NEW + `*_NEXT` clear → EF(NEW)==caller(NEW). 파괴 prod-write → supervisor 신규 GO-token.
- **(B) flip 롤백**: vault internal_cron_secret=OLD 복원 → caller(OLD)==EF(OLD). rotation 포기, 서비스 복구. 파괴 prod-write → GO-token.
- **(C) dual-accept EF 코드 실배포**: leg[a] `_NEXT` OR절 이식 후 정식 배포 → EF가 OLD∨NEW 수용. 그 후 정상 soak→revoke. supervisor 정상 EF 배포.

권고: 서비스 즉시 복구 관점 (A) 또는 (B)가 최단(env staged). 방향·GO-token = supervisor 결정. dev-foot는 GO-token/deploy 지시 수신 후 apply.
