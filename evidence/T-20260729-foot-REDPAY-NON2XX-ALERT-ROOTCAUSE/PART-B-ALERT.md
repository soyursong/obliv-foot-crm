# T-20260729-foot-REDPAY-NON2XX-ALERT-ROOTCAUSE — Part B non-2xx 상시 슬랙 알림 신설

**요청(최필경 총괄)**: 레드페이 웹훅에서 우리가 오류(2xx 아닌) 응답을 반환하면 즉시 슬랙 알림 상시감시 신설.
"결제 유실 직전 신호"이므로 상시 감시 대상 격상.

## 변경 요약

| 파일 | 내용 |
|---|---|
| `supabase/functions/redpay-webhook/non2xx-alert.ts` (신규) | 순수 로직 모듈 — non-2xx 판별·결제push 판별·에러요약 추출·알림 본문 생성·dedup 팩토리 |
| `supabase/functions/redpay-webhook/index.ts` (수정) | 핸들러를 `handleWebhook()`로 추출 + `Deno.serve` 래퍼가 응답 관측 → non-2xx 시 `alertNon2xx()` 발송 (choke point) |
| `supabase/functions/redpay-webhook/non2xx-alert.test.ts` (신규) | 8 테스트(판별/요약/본문/dedup) — 전건 PASS |

## AC 대응

### AC-B1 — non-2xx 반환 시 즉시 슬랙 알림 (choke point)
- `Deno.serve` 래퍼가 `handleWebhook()` 반환 응답의 status 를 관측 → `isNon2xx(status) && isRealWebhookDelivery(POST, !introspection)` 이면 `alertNon2xx` 발송.
- **단일 choke point** — 핸들러의 모든 non-2xx return(401/400/500 계열)이 한 곳에서 알림. return 지점마다 배선 불필요.
- 알림 내용(AC-B1 요건): **발생시각·응답코드·trxid·tid·merchant_id·event_id·에러요약**. `alertCtx` 를 envelope 검증 직후 채워 500(clinic/db) 단계에서도 trxid/tid 포함.

### AC-B2 — 장쳰봇 명의 발송 (사용자/대표 직접 발송 금지)
- 기존 `sendSlackMessage(REDPAY_ALERT_CHANNEL, text, REDPAY_SLACK_BOT_TOKEN)` 재사용 = **장쳰봇 토큰**.
- 채널 = **REDPAY_ALERT_CHANNEL** — 미등록 merchant 알림과 동일 채널(레드페이 계열 기존 배선 재사용, Open question "기존 채널 재사용" 충족).
- 채널/토큰 미설정 시 graceful degrade(로그만) — 결제 경로 무영향.

### AC-B3 — 폭주 방지 dedup (억제보다 도달 우선)
- `makeDedup(windowMs)` — key=`status:errorReason` 별 window(기본 60s) 내 동일원인 1건으로 묶음.
- **과억제 금지**: window 짧게(60s) → 지속 장애 시 분당 최소 1건 반드시 도달. 서로 다른 응답코드/원인은 독립 즉시 발송.
- 억제된 동일원인 건수는 다음 발송 본문에 `(동일원인 N건 묶임)` 표기(운영자 가시성). env `REDPAY_ALERT_DEDUP_WINDOW_MS` 로 조정 가능.

### AC-B4 — 발송 실측 검증
- 순수 로직: `non2xx-alert.test.ts` **8/8 PASS** (`deno test`).
- 라이브 유발 probe: `scripts/T-20260729-...ROOTCAUSE_partB_verify.mjs` — 고의로 틀린 서명 POST → **401 invalid_signature 확인**(결제 데이터 무영향, 서명실패로 미적재).
  - 실측(배포 전 구버전): `status=401 body={"ok":false,"error":"invalid_signature"}` ✅ 트리거 동작 확인.
  - **배포 후**: 동일 probe 재실행 → REDPAY_ALERT_CHANNEL 에서 `🚨 [redpay-webhook][foot] non-2xx 응답` 알림 육안 확인(supervisor QA 단계).

## 커버리지·격리 고지 (no silent cap)

- **커버 범위**: 우리 핸들러가 반환하는 non-2xx — 401 invalid_signature(구조적 서명불일치, Part A 가 가장 우려한 신호) / 400 body_read_failed / 500 clinic_resolve_failed·db_upsert_failed·observe_safety_violation·unexpected_error.
- **커버 못하는 것**: Part A 의 16:43 같은 **플랫폼 레벨 503**(Edge 게이트웨이·워커 실패, 우리 JS 도달 전) — in-code 알림은 우리 코드가 실행돼야 발화하므로 잡히지 않음. → 후속 P2로 **로그기반 모니터**(Part A probe analytics 조회 주기화) 권고.
- **격리**: 알림 처리는 결제 응답(Response)을 변형·지연·차단하지 않음. 원 응답을 그대로 반환하고, 알림은 `res.clone()` body 로 별도 수행하며 모든 예외를 삼킴(결제 경로 무영향). 관측/알림만 — 수집·매칭·매출 무접촉(read-only 감시, risk_verdict GO 준수).
