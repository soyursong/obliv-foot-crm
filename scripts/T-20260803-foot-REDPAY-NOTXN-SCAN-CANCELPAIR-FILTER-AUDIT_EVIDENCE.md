# T-20260803-foot-REDPAY-NOTXN-SCAN-CANCELPAIR-FILTER-AUDIT — READ-ONLY 진단 EVIDENCE

- domain: foot · obliv-foot-crm · READ-ONLY audit (ef_only, no write/DDL)
- reporter: 최필경 총괄 (C0ATE5P6JTH, thread 1785716108.106509)
- 대상: 단말 1047479158(7/22 승인+즉시취소, 순액0) — "무거래 단말 스캔 결과 0건" 우려
- 진단 실행일: 2026-08-03 (dev-foot)

---

## 결론 요약 (총괄 회신용)

1. **취소쌍/순액0 "제외 필터"는 존재하지 않는다.** 적재 폴러·워치독·대사뷰 어디에도
   취소(reverse)/순액0을 admission에서 떨어뜨리는 조건식이 없다. 취소는 **음수 금액으로 그대로 적재**되고,
   완전성 대사는 **건수-우선(count-first)** 이라 순액0이어도 안 놓친다.
2. 그러나 단말 1047479158의 7/22 승인+취소쌍은 **실제로 우리 시스템에 안 들어와 있다(진짜 silent-miss).**
   원인은 "순액0 필터"가 아니라 **폴러가 7/22 창을 적재하지 못한 커버리지 공백**이다(단말은 07-18 이미 명단 등록됨 → 배제 아님).
3. 이 누락은 이미 배포된 **A12 membership-blind 완전성 대사(delta1 count-first)가 정확히 HIGH로 잡는다**(아래 실측).
   즉 "실제 취소가 다른 경로로 안전히 잡히는 근거"가 존재 = 본건은 신규 필터-제거 fix 대상 아님.
4. 총괄이 돌린 "무거래 단말 스캔"이 **raw 테이블만 보는 스캔**(예: 워치독 ③ 휴면감지 / freshness raw_count)이면
   (a)순액0-취소상쇄 (b)진짜 무거래 (c)미적재-silent-miss를 **구분하지 못하고 전부 '무거래(0건)'로 보인다**
   = total-blindness 단일점. 3상태 구분은 **feed↔raw를 맞대보는 A12에만 존재**한다.
   → **raw-only 스캔을 '누락 없음'의 근거로 쓰면 안 된다**(부모 REVERSEMISS-COVERAGE-AUDIT 결론과 동일).

---

## AC-0 (중복방지) — 기존 처방에 포섭되는가: **YES (포섭 확인)**

- 부모 `T-20260728-foot-REDPAY-WATCHDOG-REVERSEMISS-COVERAGE-AUDIT` + 자매
  `T-20260728-foot-REDPAY-MEMBERSHIP-BLIND-RECONCILE`(A12, `~/ops/etl/recon/redpay_completeness_reconcile_probe.py`)가
  **feed↔적재 count-delta(delta1) 처방**을 이미 배포함(2026-07-28 deployed).
- DA 정정②(SSOT da_decision_..._membership_blind_reconcile): delta1 = `settled-window + net-amount(cancel-aware) + **count-first**`.
  → 승인+취소가 순액0으로 상쇄돼도 **건수 차이(feed cnt − 적재 cnt)** 로 표면화. 본건 취소쌍/순액0을 구조적으로 커버.
- ∴ 본건은 신규 구현 아님 → **"그 처방이 취소쌍/순액0을 실제 커버하는지 검증"으로 좁혀 수행**(중복구현 회피). 아래 실측이 커버 확증.

## AC-1 (필터 존재/위치 코드경로 규명) — 제외 필터 **부재 확인**

취소/순액0/reverse 제외 admission 필터를 전 경로에서 탐색한 결과 **없음**. 근거 코드경로:

| 경로 | 파일:라인 | 취소/순액0 취급 |
|---|---|---|
| 적재 폴러 행매핑 | `scripts/redpay_macstudio_poller.mjs:581-583` | `external_status: t.status; amount: t.amount` — 취소(N/X/M)는 **음수 그대로 보존**, 상태·금액 제외 없음 |
| 적재 스코프 필터 | `scripts/redpay_macstudio_poller.mjs:605-628` `filterToFootScope()` | admit 판정 = **merchant_id allowlist(TID-agnostic)** — status/amount 무관 |
| 워치독 ① 미분류감지 | `scripts/redpay_terminal_watchdog.mjs:336-360` `classifyUnclassified()` | 전 item `trx_count += 1` — 상태/금액 무필터 |
| 워치독 ⑤ 소계대조 | `scripts/redpay_terminal_watchdog.mjs:496-517` `compareTidSubtotals()` | 건수 AND net(부호보존) 동시 비교. `maskedByNetting` = **승인↔취소 상쇄를 오히려 잡아내는** 장치(제외 아님) |
| 대사뷰 | `supabase/migrations/20260708230000_redpay_recon_daily_view.sql:60-65` | 취소 = `refund_not_in_crm` **상태로 표면화**(제외 아님) |
| A12 delta1 | `~/ops/.../redpay_completeness_reconcile_probe.py:316,332-336` | `d1_cnt = feed.cnt − raw.cnt`, `d1_cnt>0 → under-ingestion HIGH` = **count-first(순액 무관)** |

★유일하게 존재하는 status 필터 = `redpay-reverse-match/index.ts:132 .eq("external_status","Y")` 와
gap-remap dryrun들의 `WHERE external_status='Y'`. 이는 **[수납] 역매칭 후보선택/gap 계량용**이지
완전성 스캔의 admission 필터가 아니다(취소를 무거래로 분류하는 경로 아님).

## AC-2 (실제 취소 누락 재현) — 재현 **성공** (단, 원인 ≠ 순액0 필터)

RedPay 정본 feed(권위소스, 한국IP live pull) vs 우리 적재(`redpay_raw_transactions`) 실측:

```
[정본 feed 2026-07-22]  TID 1047479158 / merchant 1777289012 "오블리브-서울오리진점 풋(무선) OL"
  · status Y  amount +5000  approved 17:30:13  trxid 0722C8038056   (승인)
  · status N  amount -5000  approved 17:30:56  cancelled 17:30:56  trxid 0722C8038132  (즉시취소)
  → 건수 2, 순액 0

[우리 적재 redpay_raw_transactions]
  · tid=1047479158            : 0행 (전기간)
  · merchant 1777289012        : 0행 (전기간)
  · 2026-07-22 (KST) 전체 foot : 0행 (7/20=26,7/23=27,7/24=40 이나 7/21·7/22 적재 0)
```

→ **feed엔 승인+취소 2건이 실재하나 적재는 0건 = 실제 취소 누락 확증.** 단 "스캔이 승인+취소를 순액0으로 떨어뜨린" 게 아니라
**애초에 2건이 적재 파이프라인에 안 들어옴**. 단말은 **07-18 명단 등록 완료**(registry created_at 2026-07-18, active) →
merchant-admission 배제도 아님. ∴ 원인 = **폴러 7/22 창 적재 커버리지 공백**(별건 root-cause 대상, 아래).

## AC-3 (3상태 구분 진단) — raw-only 스캔은 **미구분(total-blindness)** / A12만 구분

| 스캔 | (a)순액0 취소상쇄 | (b)진짜 무거래 | (c)미적재 silent-miss | 판정 |
|---|---|---|---|---|
| 워치독 ③ 휴면감지 `detectDormant` (watchdog.mjs:583-598, `approved_at=gte` raw-only) | 못구분 | 못구분 | 못구분 | ❌ 3상태 전부 "무거래"로 보임 |
| `get_redpay_feed_freshness()` (view.sql:149, raw_count_today) | 못구분 | poller-fresh로 부분구분 | **못구분**(폴러 정상이어도 특정창 누락 못봄) | ⚠ (c) 미봉인 |
| **A12 delta1 (feed↔raw count-first)** | net0이어도 cnt로 구분 | feed=raw=0 → GREEN | **feed>raw → under-ingestion HIGH** | ✅ 3상태 구분 |

→ raw만 보는 "무거래 스캔"은 (a)/(b)/(c)를 **단일 신호로 뭉갠다**. 이는
`BIZNO-FAILCLOSED '금액0↔못읽음' 불변식`의 확장 축(관측불가를 정상0으로 오인)과 동형. **feed를 대조축으로 끼워야만** 구분 가능.

## AC-0/AC-4 검증 실측 — A12가 본건(순액0 취소쌍)을 실제 커버하는가: **YES**

`python3 ~/ops/etl/recon/redpay_completeness_reconcile_probe.py --days 15 --lag-days 2` (2026-08-03 실행):

```
verdict: HIGH | window 2026-07-18 -> 2026-08-01
2026-07-22 HIGH | feed {cnt:2, net:0} raw {cnt:0, net:0} | delta1 cnt=2 net=0 class=under-ingestion verdict=HIGH
```

→ **순액0(net=0)인 취소쌍을 count-first로 정확히 under-ingestion HIGH로 포착.** 순액0 상쇄에 눈멀지 않음 = AC-4 "실제 취소가 안전히 잡히는 근거".

---

## AC-4 disposition (총괄 회신)

- **버그(순액0 제외필터)로 인한 오분류 = 아님.** 그런 필터는 없다(AC-1). 취소는 음수적재+count-first로 커버(AC-0 실측).
- **의도된 설계가 실제 취소를 안전히 잡는 근거 = 있음.** A12 delta1이 7/22 순액0 취소쌍을 HIGH로 포착(위 실측).
- **단, 두 개의 진짜 잔여 갭(별건 권고, 본 티켓 스코프 밖):**
  1. **raw-only "무거래 스캔"의 3상태 미구분** — 총괄이 그 스캔을 '누락 없음' 근거로 신뢰하면 안 됨.
     현장 판단은 **feed↔raw 대조(A12/freshness+feed)** 축으로 봐야 함. (부모 REVERSEMISS audit_verdict와 동일 결론)
  2. **7/22 폴러 커버리지 공백의 근본원인** — 단말은 등록됐고 admission도 status-agnostic인데 왜 7/22 batch가
     미적재됐는지(폴러 incremental cursor/daily_full 창 누락)는 별도 root-cause 조사 필요.
     또한 A12 HIGH는 settled-window(기본7d) 내에서만 발화 → 미조치 시 창 밖으로 aging되며 재침묵(retention 갭).
- **fix 방향(권고, 미착수):** 필터 제거 아님. (a) 폴러 7/22-class 커버리지 RC 별건, (b) A12 HIGH의 지속/에스컬레이션
  (Mode B 로그테이블)은 **DDL 수반 → DA CONSULT 1차 게이트 후** 진행. 실 데이터 소급/재집계는 Data-Correction Backfill SOP 봉투 별건.

## 스코프 가드 준수

- READ-ONLY 완료. write/DDL 0, CRM 화면 무변경(ef_only). 기존 결제·수납·매칭·취소 경로 무접촉.
- 코드 로직 변경 0 (본 파일 = 진단 evidence 문서 아티팩트만). DDL 필요 판정분은 DA CONSULT/별건 승격으로 이관.
