# T-20260803-foot-REDPAY-BIZNO-ENVGAP-RETRO-BACKFILL — 진단 EVIDENCE

- 진단자: agent-fdd-dev-foot · 일시: 2026-08-03 · 스코프: READ-ONLY (mutation 0, 자동백필 미실행)
- 인증컨텍스트: **service_role** (RLS bypass, 전건 관측 — cross-CRM 진단 인증컨텍스트 표준 준수)
- 대상: 레드페이 풋(457) 수집(redpay_macstudio_poller) · 부모 = FAILCLOSED(deployed 08-03 09:18)
- 재현 스크립트: `_census.mjs`(일별 연속성+크래시루프+feasibility) / `_delta.mjs`(제로데이 RedPay↔DB delta)

---

## 결론 3줄 (총괄 최필경 3문 회신)

1. **(공백 시점) bizno env "공백→511 폴백" 구간은 로그 전 기간(07-11~08-03) 미발생.** 폴러 가동 로그의 `business_no=` 값이 flip 전(511)·flip 후(457)로 항상 정확했고, **BIZNO-READFAIL 경보 0건**. 우려하신 "env 비어서 511로 넘어가 457이 통째로 빠진" 구간은 **존재하지 않음.**
2. **(누락 규모) 전 기간 delta 대조 결과 실 미적재 = 07-22 단 2건(승인 1 + 즉시취소 1, net 0원).** 나머지는 정합. 매출 영향 0원. (독립 교차검증: 워치독 09:10 최근 7일 합계 RedPay 247건 = DB 247건, net ₩91,512,740 **정확 일치**.)
3. **(재수집) RedPay 조회API 과거조회 = 가능(전 일자 HTTP 200 success=true).** 폴러 upsert 멱등키(external_trxid,external_status,amount) 존재 → 재적재 안전. 07-22 2건은 net 0원이라 매출 무영향이나 grain 완전성 위해 백필 가능 → **자동 실행 금지, Data-Correction Backfill SOP 봉투 별건 승격.**

---

## 1. bizno env 공백 시작시점 규명 (Q1)

### 근거 A — 폴러 가동 로그의 business_no 시계열 (`~/logs/redpay_macstudio_poller.out`)
| 기간(KST) | 가동 라인 business_no | 판정 |
|---|---|---|
| 07-11 ~ 07-22 | `511-60-00988` | ✅ 정확 (flip 前 정본) |
| 07-23 (전환일) | 511 → 457 전환 | ✅ RedPay flip 반영 |
| 07-24 ~ 08-03 | `457-23-00938` | ✅ 정확 (flip 後 정본) |

- **BIZNO-READFAIL / 빈 business_no 라인 = 0건** (전 기간). env의 `REDPAY_BUSINESS_NO`가 비어 하드값(511)으로 폴백한 사이클 **관측 안 됨.**
- **핵심**: 구 코드 default = `cfg("REDPAY_BUSINESS_NO", "511-60-00988")` → default(511) 위험창은 **07-23 flip 後 ~ 07-28(SILENT-PATH-HARDEN이 default를 457로 교정)까지**뿐. 그 07-23~07-28 구간의 가동 라인이 **전부 457** = env가 안 비어(비었으면 당시 default 511이 찍혔어야 함) → **511 폴백 미발화 증명.** 07-28 이후엔 default=457이라 설령 env가 비어도 정답값 사용 → 무손실.

### 근거 B — "09:08 경보"의 정체
- 08-03 00:10 UTC(09:10 KST) 워치독 가동 로그: `business_no=457-23-00938`(정상, 공백 아님), 합계 대조 ✅ 일치. **런타임 bizno-readfail 경보 없음.**
- 09:08~09:10 경보 = 부모 FAILCLOSED(deploy_ready_at 09:10) **sign-off 재현 테스트(일부러 bizno 비워 알람 뜨는지)** 발원으로 정합. 즉 **"실 env 공백"이 아니라 배포검증 시뮬 경보**였음. (총괄 sign-off 기준 자체가 "일부러 비웠을 때 알람 재현".)

### 별개 실 인시던트 (정직 disclosure, bizno 아님)
- **08-03 07:47~08:03 KST**: 폴러 `~1분 간격` 크래시-루프(정상 5분 아님). `.err` 동시각 **Supabase "Invalid API key" 401**(service_role 키, restGet 상태조회). env 재작성(mtime **08:02:08 KST**)으로 해소 → 08:03 KST 5분 주기·200 OK 복귀.
- 이 인시던트는 **bizno가 아니라 Supabase 키** 문제(가동 라인 bizno=457 유지). 아래 §2-B에서 무손실 확인.

---

## 2. 누락 규모 정량화 (Q2) — delta1(RedPay 조회API 총량 − 적재 총량)

### [A] 풋 raw 일별 적재 연속성 (approved_at KST, `_census.mjs`)
```
day        rows   net금액        비고
07-20        26   5,931,200
07-21         0           0     제로 → §delta 진성휴무 확인
07-22         0           0     제로 → §delta ⚠2건 delta (아래)
07-23        27  10,779,980
07-24        40  18,779,600
07-25        34  12,537,790
07-26         0           0     제로 → §delta 진성휴무(RedPay foot 0)
07-27        56  29,554,500
07-28        53  18,075,560
07-29        37   7,609,300
07-30        44  19,318,300
07-31        35  10,276,600
08-01        43  11,363,900
08-02         0           0     제로 → §delta 진성휴무(RedPay foot 0)
08-03         0           0     당일 새벽/제로 → §delta 진성휴무
```

### [B] 제로데이 RedPay↔DB delta (`_delta.mjs`, foot merchant 27-set 필터)
```
day        DB풋  RedPay457총  RedPay풋  RedPay풋net  판정
07-21        0        0          0          0        진성 휴무(양쪽0) ✓
07-22        0        2          2          0        ⚠누락 2건 (net 0원)
07-26        0       14          0          0        진성 휴무(foot 0, 14=타도메인) ✓
08-02        0       17          0          0        진성 휴무(foot 0, 17=타도메인) ✓
08-03        0        0          0          0        진성 휴무 ✓
07-27(대조)  56       77         46   29,438,280      DB≥RedPay(무손실)
08-01(대조)  43       68         43   11,363,900      정합 ✓
```

### 유일 실 누락 = 07-22 2건 (정밀)
| trxid | status | amount | approved(KST) | cancelled | tid | merchant | DB |
|---|---|---|---|---|---|---|---|
| 0722C8038056 | 승인(Y) | +5,000 | 07-22 17:30:13 | 17:30:56 | 1047479158 | 1777289012 | 미적재 |
| 0722C8038132 | 취소(N) | −5,000 | 07-22 17:30:56 | 17:30:56 | 1047479158 | 1777289012 | 미적재 |

- **성격**: 같은 분(17:30) **승인 즉시 취소 pair = net 0원** (단말 테스트성). 해당 단말(merchant 1777289012 / TID 1047479158)은 워치독 ③에서 **휴면 단말(최근30일 거래 0)**로 확인 = 1회성.
- **bizno 공백과 무관**: 07-22는 flip 前 → 폴러가 **정상 511** 사용 중이었음(공백/폴백 아님). RedPay flip 시 과거건 재귀속/증분윈도 경계로 인한 누락으로 추정.
- **"0원(정상 clean)" vs "read-fail 미수집" 구분**: 본건은 read-fail 아닌 **grain 누락 2건(net 0원)**. 매출/정산 영향 0. 실 공백만 계상 시 **2건 / 0원.**

### [B-crashloop] 08-03 크래시루프 창 자가치유
- Aug3 07:00~09:30 KST approved 풋 거래 = **0건** (개원 전 새벽). 크래시루프가 삼킨 실데이터 없음(증분윈도 자가치유 + 실거래 0). → **무손실.**

---

## 3. env 복구 & 재수집 feasibility (Q3)

### env 복구 상태
- `~/.env.redpay-foot` 현재 `REDPAY_BUSINESS_NO="457-23-00938"` (정상값 존재). mtime **08-03 08:02:08 KST** = Supabase-키 인시던트 해소 시점.
- 폴러 현재: `launchctl` status=0(정상), 최근 **200 OK 10:04 KST 연속**, 워치독 합계 대조 ✅ 일치 → **정상조회 복귀·활성 경보 없음(경보해제).**
- fail-closed(commit 39a2a766) 배포·정상(env 유효 → 미발화). ※ 재설정 불필요(이미 정상값).

### 재수집 feasibility
- RedPay 조회API 과거조회: `07-25 / 07-27 / 07-30 / 07-22` 등 **HTTP 200 success=true** → 과거기간 재조회 **가능** (조회한도 내).
- idempotency: 폴러 upsert 멱등키 `(external_trxid, external_status, amount)` → 재적재 시 중복 없이 안전.
- **판정**: 07-22 2건 재적재 **feasible**. 단 net 0원(매출 무영향)이며 자동 백필 금지 지침에 따라 **본 티켓서 미실행.**

### 백필 실행 시 (별건 승격 필요)
Data-Correction Backfill SOP 봉투 요건: 대상셋 freeze(07-22 trxid 2건) · 판정근거 스냅샷 · dry-run · 멱등키 · rows-affected assert · 원장 무접점 · supervisor dry-run. → **planner FOLLOWUP로 별건 티켓화 제안(P2, net 0원이라 우선순위 낮음).**

---

## 게이트 준수
- no-DDL / mutation 0 / 자동 백필 미실행. READ-ONLY census·조회는 service_role 정규 env(macstudio)로 수행(anon RLS Silent-0-Row 회피).
- under-report 금지: 복구불가/미적재 공백 = 07-22 2건(net 0원) 전량 명시. 그 외 실 누락 0.
