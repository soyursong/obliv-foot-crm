# T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT — 결제 sync-back 이식 설계 1-pager

> 상태: **DA CONSULT 1차 게이트 대기** (MSG-20260730-184534-ok2u). **DA GO 전 DDL 착수 금지.**
> 본 문서 = 게이트 선행 산출물(happy-flow-queue 패턴 분석 + emitter wiring 설계)까지만. 마이그/EF 코드 미작성.
> 작성: dev-foot / 2026-07-30 · 부모 EPIC: T-20260730-xcrm-CUECARD-FUNNEL-P0 (CEO MSG-20260730-183638-8ky1)
> 근거: happy-flow-queue 정본 3-컴포넌트 + obliv-foot-crm 현행 스키마/EF READ (코드레벨, prod write 0)

---

## 0. 한 줄 요약
풋 7월 결제 회수 **0/44**의 근본원인 = 결제완료→도파민 sync-back 이 **단일 FE 경로(`PaymentDialog.tsx`)에 결합**돼 있고, 그 경로가 **emit 시점 `reservations.external_id` 조인**으로 cue_card_id를 해소한다. 새 결제 write surface(패키지 결제 RPC·마감편집·redpay Plan B 등)가 이 콜백을 안 쏘므로 조용히 미회수. 수선 = HFQ Phase2 정본대로 **payments AFTER INSERT 트리거 → payment_sync_outbox → cron drain → emit EF → 도파민 crm-payment-callback** 의 **경로-독립 서버측 SoT emit** 로 전환. 풋 고유 제약: **cue_card_id 를 outbox 행에 enqueue-time 1회 해소·적재하고 payload에 직접 실어(emit-time 조인 의존 제거)**.

---

## 1. 근본원인 (RC) — 풋 결제 회수 0/44

### 현행 결제 sync-back 경로 (레거시, FE-coupled)
- **발사기**: `supabase/functions/dopamine-callback` EF — 헤더 주석 "풋CRM → 도파민 Reverse 콜백 공통 Emitter / TA4: paid (첫 패키지 결제, 1회만 발사)".
- **발사 트리거**: `src/components/PaymentDialog.tsx:531-540` — 결제 UI 저장 성공 직후 `functions.invoke(DOPAMINE_CALLBACK, { type:'paid', ... })`.
- **cue_card 해소**: 같은 지점에서 `reservations.select('source_system, external_id').eq('id', checkIn.reservation_id)` **emit-time 조인**.

### 결함 클래스 (HFQ §4-2d-7 RC 와 동형)
1. **경로 결합**: 결제 write surface 가 `PaymentDialog` 하나가 아니다. 풋에는 최소 아래 write surface 가 병존한다 —
   - 패키지 결제 RPC (`consume_package_sessions_for_checkin` / `package_payments_created_by` 계열),
   - 일마감 편집뷰(`closing_manual_payments` / softvoid),
   - redpay Plan B pending payment (`foot_redpay_planb_pending_payment*`),
   - redpay 역방향매칭 수납 훅(`redpay-reverse-match`).
   이 중 `PaymentDialog` 외 경로는 **paid 콜백을 발사하지 않는다** → sync-back 누락. **write surface 가 늘 때마다 조용히 재파손** = 0/44 의 구조적 원인.
2. **fire-and-forget**: FE invoke 실패(네트워크·EF 4xx·사용자 이탈) 시 **영속 재시도·DLQ 없음** → 유실.
3. **emit-time 조인 의존**: cue_card_id 를 payments 행이 아니라 emit 시점 reservations 조인으로 해소 → 조인 축(reservation_id, source_system) 오염 시 조용히 skip.

> 결론: FE 경로 패치로는 재발. HFQ 가 이미 밟은 길(payment-completed-emitter → payment_sync_outbox trigger)을 풋에 이식하는 것이 정답.

---

## 2. HFQ 정본 3-컴포넌트 분석 (이식 원본)

| 컴포넌트 | 파일 | 역할 | 이식 여부 |
|---|---|---|---|
| **payment_sync_outbox_trigger** | `migrations/20260706120000_payment_sync_outbox_trigger.sql` | payments AFTER INSERT → 도파민-귀속 판정 → `payment_sync_outbox` 적재(트리거). drain fn + DLQ alert fn + cron `*/2`. | **핵심 이식** (풋 변형) |
| **crm-payment-sync-emit** | `functions/crm-payment-sync-emit/index.ts` | outbox drain → 도파민 `crm-payment-callback` POST. bounded retry(6·지수백오프 15→120s) + 영구4xx 즉시 DLQ. amount/paid_at 를 payments SUM/MIN 재산출. | **핵심 이식** (풋 변형) |
| **payment-completed-emitter** | `functions/payment-completed-emitter/index.ts` | (레거시 FE-invoke 발사기) 방문 총액 재산출 거동의 원형. | **행동만 참조** (풋의 `dopamine-callback` paid 가 이미 대응 = 신규 이식 불요) |

### HFQ 설계 핵심 (그대로 계승)
- **DA fork ③ = 별도 `payment_sync_outbox` 테이블** (①공유 lifecycle outbox·②pg_net 직발 반려). granularity·blast-radius 격리.
- **멱등 이중방어**: outbox `crm_payment_id` UNIQUE + 수신부 `cue_cards.crm_payment_id` 전역 UNIQUE → 재발사 이중발화 물리 불가.
- **트리거 결제 tx 비차단**: `EXCEPTION WHEN OTHERS → RAISE WARNING`, best-effort enqueue.
- **payload(§4-2d-3)**: `{ source_system, external_id(=cue_card_id), crm_payment_id, amount, currency='KRW', paid_at, payment_status='paid' }`. 수신부 화이트리스트 `{crm, foot, scalp}` — **foot 이미 등재**.

---

## 3. 풋 현행 인프라 실측 (READ, 2026-07-30)

### 이미 존재 (재사용)
- `reservations.external_id` (UUID, = 도파민 cue_cards.id) — 20260520000040.
- **`payments.external_id` (UUID) — "도파민 cue_card.id carry-over. paid 콜백 발사 시 사용"** (20260520000040). ← **cue_card_id 직접 보유 컬럼**.
- `payments.check_in_id` (UUID FK → check_ins).
- `dopamine_callback_outbox` (lifecycle outbox: visited/no_show/cancelled/rejected/reschedule) + worker `process_dopamine_callback_outbox` + cron + DLQ alert + `dopamine-callback-dispatch` EF (20260603 / 20260716 / 20260718).
- `dopamine_outbound_log` (callback_type CHECK IN ('visited','**paid**')) — **paid 슬롯 이미 scaffold, 미배선**.
- 풋 컨벤션: `get_vault_secret()` / `internal_cron_secret` / `app.supabase_url` / `net.http_post(named-arg, body JSONB)` / cron prefix `foot-`.

### 부재 (= 이식 대상)
- 결제 전용 outbox (`payment_sync_outbox` 또는 등가) **없음**.
- payments AFTER INSERT 결제 sync-back 트리거 **없음**.
- 도파민 `crm-payment-callback` 로 향하는 풋 emit EF **없음** (기존 worker 는 lifecycle → `crm-lifecycle-callback` 만 라우팅).

---

## 4. 풋 emitter wiring 설계 (DA GO 후 착수 대상)

```
[payments INSERT]  ── (모든 write surface: PaymentDialog / 패키지RPC / 마감편집 / redpay PlanB)
     │  AFTER INSERT trigger (신규)  ── 결제 tx 비차단(EXCEPTION→WARNING)
     ▼
[enqueue_foot_payment_sync()]
     │  (a) 비대상 skip: refund/0원/check_in_id NULL
     │  (b) cue_card_id 해소(★enqueue-time 1회):
     │        1순위  NEW.external_id (payments 행 직접 보유; carry-over)
     │        2순위  check_ins→reservations(source_system='dopamine', external_id) 폴백 1회
     │        둘 다 NULL → 도파민 비귀속 → skip (무손실)
     │  (c) payment_sync_outbox INSERT (crm_payment_id=check_in_id::text, cue_card_id 적재)
     │        ON CONFLICT (crm_payment_id) DO NOTHING  ← 방문당 1발화 멱등
     ▼
[payment_sync_outbox]  status: pending→sent/failed→dlq
     │  cron 'foot-payment-sync-drain' */2  →  payment_sync_drain() (due 있을 때만 발화 + 매틱 DLQ alert)
     ▼
[crm-payment-sync-emit EF (풋 신규)]
     │  drain 배치(≤50) → payload 조립 → 도파민 crm-payment-callback POST (X-Callback-Secret)
     │  amount/paid_at = payments(non-refund) SUM/MIN 재산출(방문 총액 정합)
     │  상태머신: 2xx→sent / 400·401·403→즉시 dlq / 422·404·429·5xx·net→bounded retry(6)→dlq
     ▼
[도파민 crm-payment-callback]  cue_cards.crm_payment_id 전역 UNIQUE → 중복 200{applied:false}
```

### 풋 변형점 (HFQ divergence)
1. **cue_card_id 직접 포함 (★ 티켓 필수제약 충족)**: enqueue 시 **payments.external_id 를 1순위**로 outbox.cue_card_id 에 적재. HFQ 는 payments 에 external_id 컬럼이 없어 check_ins→reservations 조인이 필수였으나, 풋은 payments 가 cue_card_id 를 carry-over 로 직접 보유 → **emit-time 조인 의존 제거**. (carry-over 미충전 행 대비 reservations 폴백 1회는 enqueue-time 이지 emit-time 아님 → payload 는 항상 저장된 cue_card_id 를 직송.)
2. **풋 컨벤션 준수**: `get_vault_secret()` / `app.supabase_url` / `net.http_post` named-arg + body JSONB (20260718130000 fix 미러) / cron prefix `foot-` / DLQ alert 슬랙 문구 "[풋CRM]".
3. **레거시 경로 공존·컷오버**: `PaymentDialog` 의 FE invoke(dopamine-callback paid)는 shadow 기간 병존 → live 컷오버 후 제거(또는 outbox 로 흡수). 이중발화는 수신부 `crm_payment_id` UNIQUE 가 흡수(중복계상 0).

### 멱등 (동일 결제 재수신 중복계상 0) — 티켓 필수제약 충족
- **발신 멱등**: `payment_sync_outbox.crm_payment_id` (=check_in_id::text) UNIQUE + ON CONFLICT DO NOTHING → 방문당 1행.
- **수신 멱등**: 도파민 `cue_cards.crm_payment_id` 전역 UNIQUE → 중복 POST 는 200{applied:false, duplicate}.
- 재시도는 동일 crm_payment_id 재전송(신규 행 생성 안 함).

### outbox + retry + DLQ (fire-and-forget 금지) — 티켓 필수제약 충족
- 영속 outbox(pending/sent/failed/dlq) + attempts + next_attempt_at(지수백오프) + last_error + dlq_alerted.
- cron `*/2` drain 백스톱 + DLQ 신규 슬랙 알람. FE invoke 성패와 무관하게 트리거가 무손실 적재.

---

## 5. 아키텍처 결정점 (★ DA CONSULT 회신 필요 — DDL 착수 전 확정)

| # | 질문 | dev-foot 권고 | 근거 |
|---|---|---|---|
| **Q1** | 결제 outbox = **별도 `payment_sync_outbox`** vs 기존 `dopamine_callback_outbox` 에 event_type='payment' 확장? | **별도 테이블(HFQ fork ③)** | HFQ DA-20260706 가 공유 lifecycle outbox 를 §4-2d-4-★★ granularity·live 경로 blast-radius 로 반려. 풋도 동일 논리. 또한 수신 endpoint 가 다름(lifecycle=crm-lifecycle-callback / payment=crm-payment-callback) → dispatch 라우팅 분기보다 테이블 분리가 격리 우월. |
| **Q2** | cue_card_id 해소 = payments.external_id 1순위 + reservations 폴백. **payments.external_id 실충전율**은? (carry-over 트리거 존재 여부 / NULL 비율) | 폴백 유지(안전). 다만 회수율 DoD(≥95%) 달성엔 carry-over 충전율이 관건. | 코드 READ 상 `PaymentDialog` 는 external_id 를 payments 에 안 쓰고 reservations 재조인 → **payments.external_id 가 실제로 채워지는지 prod READ-ONLY 확인 필요**(§7 probe). |
| **Q3** | 멱등 grain = `crm_payment_id = check_in_id`(방문당 1발화). 풋 패키지 다회 결제·분할결제(split_payment)·redpay Plan B 는 방문당 다행 payments 가능 → 방문 총액 SUM 재산출로 흡수하는 HFQ 방식 그대로 OK? | HFQ 방식(방문당 1발화 + SUM 재산출) 계승 | 풋 payments grain = check_in_id 보유(HFQ 동형). 단 §4-2d-5 parity 한계(첫 emit 후 동일방문 추가결제는 수신부 duplicate 로 미갱신) 를 풋 패키지 특성상 수용 가능한지 DA 판정 필요. |
| **Q4** | change-class = ADDITIVE(신규 테이블1 + payments 트리거1 + drain/dlq fn + cron). 대표게이트 면제(DA GO + ADDITIVE §3.1) 적용? | ADDITIVE 확인 | payments 본체·기존 outbox 무접촉. 롤백 = DROP TRIGGER + DROP TABLE(+fn/cron). |

---

## 6. change-class & MIG-GATE 예고 (db_change=true)
- **change-class**: ADDITIVE (신규 테이블 `payment_sync_outbox` 1 + payments AFTER INSERT 트리거 1 + `payment_sync_drain()`/`alert_payment_sync_dlq()` fn + cron `foot-payment-sync-drain`).
- **deploy-ready 마킹 전 의무**: `mig_*` 5필드(mig_change_class / mig_dryrun / mig_rollback / mig_ledger / mig_da_consult) 채움 (MIG-GATE). 현 시점 **미충족**(DA GO 전) → deploy-ready 마킹 금지.
- **§S2.4 데이터 정책 자문 게이트**: 신규 테이블 추가 → DA CONSULT 선행 필수. MSG-20260730-184534-ok2u 발행됨, **GO 대기**.

## 7. DA GO 후 실행 순서 (착수 시)
1. (prep) prod READ-ONLY probe: ① payments.external_id NULL 비율 / ② 7월 도파민-귀속 결제 모수(=44 재현) / ③ 기존 dopamine_outbound_log paid 발사 실적. → Q2/DoD 근거.
2. migration `up.sql` + `rollback.sql` + `dryrun` (풋 컨벤션, ADDITIVE).
3. EF `crm-payment-sync-emit` (풋 변형: 풋 env·vault·payload).
4. env: `CRM_CALLBACK_SECRET`(또는 DOPAMINE_CALLBACK_SECRET), `DOPAMINE_PAYMENT_CALLBACK_URL`(또는 DOPAMINE_FUNCTIONS_URL) — supervisor 주입.
5. shadow(dry-run) → 회수율 관측 → live 컷오버 → 레거시 FE invoke 정리.
6. E2E spec `tests/e2e/T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT.spec.ts` + 회귀.
7. mig_* 5필드 충전 → deploy-ready 마킹 → supervisor QA.
- **DoD**: 결제 회수율 ≥95%, 7일 대사 GREEN.

---

*dev-foot / 2026-07-30 / DA CONSULT 게이트 선행 산출물 — DDL/EF 코드 미포함, DA GO 전 착수 금지*
