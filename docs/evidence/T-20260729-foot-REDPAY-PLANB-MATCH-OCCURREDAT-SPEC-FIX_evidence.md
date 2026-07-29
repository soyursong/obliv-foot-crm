# T-20260729-foot-REDPAY-PLANB-MATCH-OCCURREDAT-SPEC-FIX — dev-foot 구현 evidence

작성: dev-foot / 2026-07-29 / branch work/T-20260729-foot-REDPAY-PLANB-MATCH-OCCURREDAT-SPEC-FIX

## AC-5 — DB pre-check (occurred_at 영속 여부) ★게이트

**결론: db_change=false, DA CONSULT 재진입 불요. 순수 EF/cron 로직 변경.**

- 리터럴 컬럼 `occurred_at` 은 `redpay_raw_transactions` 에 없음. 그러나 **승인시각(occurred_at 의미) = `approved_at` 컬럼으로 이미 영속**.
  - 웹훅 `buildWebhookRawRow`(verify.ts:176): `parseTimestamp(data.approved_at ?? envelope.occurred_at)` → `row.approved_at`.
  - 폴러(redpay-reconcile)도 `approved_at` 세팅. 인덱스 `(clinic_id, approved_at DESC)` 기존 존재(pay_recon_port.sql).
- **prod 실측(HTTP 200)**: `GET redpay_raw_transactions?select=id,approved_at,cancelled_at,received_at,external_status,amount&limit=1` → 200, `approved_at` 컬럼 반환.
  - 샘플 행: `external_status='N'`(취소)인데도 `approved_at`(원 승인시각) 세팅됨 → **approved_at NOT NULL 만으론 승인 판별 불충분, `external_status='Y'` 가 1급 게이트(정정3 근거).**
- 신규 컬럼/마이그 없음 → 대표게이트 대상 아님. supervisor DDL-diff 도 대상 없음(마이그 파일 0).

## AC-1 (정정2 매칭 키) — received_at → occurred_at(approved_at)
- `match.ts isWithinValidWindow`: `approved_at ∈ [pending.created_at, pending.expires_at]`(닫힌 구간, expires=created+5분).
- 매처 index.ts 후보 raw select 에 `approved_at` 추가, 유효창 비교를 approved_at 로 전환. `received_at` 은 창 비교에서 완전 제거(웹훅 지연 무영향).
- FE SSOT `redpayPlanbTtl.isWithinAutoConnect(createdAt, occurredAt)` param 의미 정정(received_at→occurred_at) + 닫힌 구간.

## AC-2 (정정2 파라미터 2분리) — 선점 유효창 5분 / 보관 기간 1시간
- `match.ts RETENTION_MS = 1h`. `REDPAY_PLANB_RETENTION_MIN=60`(SSOT lib 신설).
- MATCH 후보 pending = `status ∈ {open,expired}` AND `expires_at > (now - 1h)`. 만료 후 1h 내 expired 도 후보(late 웹훅 자동연결). 1h 초과분 시간 필터로 자연 제외.
- **행 즉시삭제 없음** — EXPIRE 패스는 여전히 `status='expired'` 마킹(행 보존). EF 에 pending_payment DELETE 없음.

## AC-3 (정정3) — 승인만 매칭
- 후보 raw: `external_status='Y'` + `approved_at NOT NULL` + `received_at NOT NULL`(웹훅 수신분) + `amount>0`.
- 취소/환불(N/M/X)은 `external_status='Y'` 필터로 제외. `match.ts isApprovedRaw` 가 1급 게이트.
- 결제후즉시취소(양수 2건) 오연결 0 — deno test S3 로 검증.

## AC-4 — 비대기형 UX 회귀 0
- FE(PaymentPlanb.tsx) 무변경. 카운트다운/안내는 유효창(5분)·lockMin(6분)만 참조. `retentionMs`/`보관`/`1시간` 미노출.

## AC-7 — UNASSIGNED-INFLOW-METRIC 정합(교차확인)
- `redpayPlanbInflowMetric.ts` 는 status count 집계(즉시삭제 가정 없음). 보관창 1h 로 expired→matched 전이 가능 → 확정 미배정률은 대상기간 종료 후 (5분+60분) 경과 뒤 집계. 주석으로 명문화(비행위 doc 변경).

## AC-6 (관측4) — 분할카드결제 빈도 실측 → 현장 relay
- 소스: prod `redpay_raw_transactions` 승인(Y) 367건. 기준: (센터, 5분창) 버킷.
- 전체 5분창·센터 버킷 302 중 **2건+ 동시승인 버킷 54건(17.9%)**.
- 소액반복/테스트 노이즈 제외(버킷 내 ≥30,000원 1건 이상) → **실질 분할결제 추정 27건(8.9%)**.
- 예시: 10000+59000=69000 / 10000+8900=18900 / 5700+5700=11400 등.
- **판단(수동 유지 vs 분할모드 별도 SPEC)은 현장(최필경) 결정** — responder 경유 relay.

## self-test (AC-8)
- `deno test supabase/functions/redpay-planb-match/match.test.ts` → 10 passed / 0 failed.
- `npx playwright test T-20260729-...MATCH-OCCURREDAT + T-20260727-...TTL-FOLD` → 20 passed(내 12 + 부모 8, 부모 경계 assert 정정 반영).
- `npm run build` → OK (built in ~6.6s).
