# T-20260803-foot-REDPAY-NET0-HOLD-157-TIDMERCHANT-DRIFT — EVIDENCE (AC-A · AC-B)

- domain: foot · obliv-foot-crm · **READ-ONLY 진단** (registry write 0 · 원장 무접촉 · 파괴적 정정 0)
- reporter: 최필경 총괄 (thread 1785716108.106509) · 부모 = NOTXN-4TERM-RAWVERIFY-DEACTIVATE(6b0b1b15) FOLLOWUP 후속
- 실행일: 2026-08-03 (dev-foot) · P2
- 정본 우선순위: **TID↔merchant 짝 = 물리 단말이 실제 승인 올린 feed(=redpay payments.php) 가 정본.** registry 는 2026-07-11 prod probe 스냅샷(mutable) → drift 판정 기준은 feed.
- 산출 probe: `T-20260803-foot-REDPAY-NET0-HOLD-157-TIDMERCHANT-DRIFT_probe.mjs` / raw out: `_evidence/..._sweep.out`

---

## 0. 3-소스 진실표 (핵심)

| 소스 | merchant | tid | 근거 |
|---|---|---|---|
| **feed (정본, payments.php)** | **1777289013** | **1047479153** | 07-23 18:16 승인 +1,004 / 18:16 취소 −1,004 (net0 pair) |
| **persisted (redpay_raw_transactions)** | **1777289013** | **1047479153** | 적재행 2건, feed 와 100% 일치 (0722 backfill·daily_full resweep 로 적재됨) |
| registry (redpay_terminal_registry) | 1777289009 | 1047479153 | seed §2 (2026-07-11 DA prod probe) — ★outlier |
| registry (redpay_terminal_registry) | 1777289013 | **1047479157** | seed §2 — ★157 에 매핑됨(feed 무거래) |

→ **feed 와 persisted raw 는 "물리단말 153 = merchant 289013" 으로 일치. registry 홀로 어긋남**(289013↔157, 289009↔153). registry 가 유일 outlier.

---

## AC-A — 1047479157 비활성 HOLD 정식등재 (158-class)

- **판정 = ⛔ HOLD 유지 (자동 비활성 금지).** 157 TID 자체 feed 0건이나, 소속 merchant **1777289013 은 활성 거래주체**(07-23 순액0 승인+취소쌍 ±1,004원, sibling tid 1047479153 경유) → 비활성 대상 부적격.
- **158 과 동일 class**: 158(289012) HOLD 사유(feed net0 취소쌍) 와 동형 → 157 을 **net0-취소쌍 HOLD class(158-class)** 로 정식 등재.
- **비활성 시 실害(구체)**: 소비뷰 `v_redpay_reconciliation_daily` 는 merchant_id IN(active) ∧ tid IN(active) 두 IN-리스트로 필터(짝 무관). 157 을 active=false 하면 merchant 289013 이 active merchant-list 에서 이탈 → 위 persisted 2건(289013+153)이 **뷰에서 탈락 = 대사 undercount/매칭소실**. ∴ 157 HOLD 는 289013 매출 가시성 보호.
- **최종 판정 게이트**: merchant 289013 net0 활동 성격(테스트/실거래) **총괄 confirm + TID↔merchant 매핑 정정** 후 재판정. 정정 전까지 157 active=true 유지.

---

## AC-B — TID↔merchant 매핑 불일치 진단 (registry-reconcile / A11 DRIFT 축)

### B-0 (중복방지) — 기존 처방 포섭 여부 선결 대조 → **둘 다 미포섭(신규 class)**

| 처방 | 스코프 | 본 drift 포섭? | 근거 |
|---|---|---|---|
| **TIER0-TRXID-HARDENING** (composite Model A = approval_no∧tid∧amount∧same-day) | reconcile **matcher**(K2 raw↔payment 링크키) | ❌ 미포섭 (직교) | matcher.ts §208: admit 권위 키=merchant_id(TID 아님). 매칭은 composite → registry 짝 오류가 매칭키를 바꾸지 않음. drift 는 registry membership 축(K-layer)의 별개 문제. |
| **MEMBERSHIP-BLIND-RECONCILE** (delta1/delta2 count-delta 표면화) | 미전환/미등재 membership(admission gap) 탐지 | ❌ 미포섭 | count-delta 는 **누락(silent-miss)** 를 잡음. 본건은 289009·289013 **둘 다 active 등재** → merchant-grain admission 무영향 → count-delta 무발화(bidir census 07-28 foot silent-miss=0 정합). 두 active 행 간 **TID 전치(transposition)** 는 계수불변 → blind. |

→ **결론: 본 drift 는 두 처방 어디에도 안 잡히는 신규 class** = "둘 다 active 인 foot registry 2행 사이의 TID↔merchant 전치, feed-가시·count-불가시". registry-reconcile/A11 DRIFT 축 단독 신설 대상.

### B-1 (원인) — 후보 3분류 판정

- **(a) registry 등재오류 ★유력** — feed·persisted raw 2개 독립 소스가 "153=289013" 로 일치, registry 만 어긋남(289013↔157, 289009↔153). 물리단말이 승인마다 merchant.id+tid 를 함께 보고하는데 그 짝이 일관되게 289013+153 → registry seed(2026-07-11 prod probe)가 **289009/289013 무선단말 2행의 tid(153·157)를 전치 등재**했을 개연 최고.
- **(b) merchant 통합/분할·재프로비저닝** — 배제 못하나 근거 약함: 289xxx 대역에 superseded_tids 기록 0, 본 window(07-01~08-03) 내 bizno-churn/재프로비저닝 마커 없음, multi-merchant-tid=0(153 이 289009 로 관측된 적 전무).
- **(c) feed 라벨링 오류** — ✗ 반증됨: feed 내부 정합(승인·취소 동일쌍이 동일 merchant/tid 보고) + persisted raw 독립 일치. 라벨링 오류로 보기 어려움.
- **핵심 코드경로**: registry seed = `20260711140000_redpay_terminal_registry_ssot.sql` §2 VALUES `('1777289009','1047479153'),('1777289013','1047479157')`. 소비뷰는 merchant_id∧tid IN-리스트(짝 무관)라 drift 가 매칭/계수에는 inert, 그러나 **registry SSOT 정확성·비활성 판단 안전성**에는 실질 오류.

### B-2 (sweep) — registry 전체 READ-ONLY count sweep (window 07-01~08-03, feed 857건, foot registry 27행/멤버십 40 tid)

| 지표 | 값 | 의미 |
|---|---|---|
| **DRIFT (registry tid 등재 ∧ feed merchant 불일치)** | **1** | **오직 tid 1047479153.** 그 외 전무 |
| foot silent-miss (foot merchant·tid 미등재) | **0** | 매출 침묵누락 없음(bidir census 07-28 정합) |
| multi-merchant tid (feed 1 tid ↔ 복수 merchant) | 0 | 153 은 289013 단독 관측(공유/재프로비저닝 신호 없음) |
| feed-tid-unknown (타센터/미분류, bizno 457 공유) | 33 | 정상 부재(전부 non-foot merchant) |

→ **규모/패턴 = 고립 singleton.** 전 foot registry 에서 TID↔merchant 전치는 1047479153 1건뿐. 체계적 drift 아님.

### B-3 (판정) — 총괄 회신 형태

> **[레드페이 단말 매핑] 진단 결과 (READ-ONLY, 정정 미실행)**
> ① **1047479157(비활성 보류)** — 그대로 보류가 맞습니다. 이 단말번호 자체는 거래가 없지만, 이 단말이 속한 가맹점(289013)은 **7/23 승인+즉시취소(±1,004원, 순액0)** 활동이 있는 **살아있는 가맹점**이라 비활성 대상이 아닙니다. → **가맹점 289013 의 그 순액0 거래가 테스트였는지 실거래였는지 확인 부탁**드립니다.
> ② **원인** — 단말↔가맹점 짝이 어긋난 곳은 **딱 1건(단말 1047479153)** 뿐입니다. 실제 결제기록(정본)은 "단말 153 = 가맹점 289013" 인데, 내부 등록표만 "153 = 289009, 157 = 289013" 으로 **두 무선단말이 서로 바뀌어 등록**돼 있습니다. 등록표(7/11 스냅샷) 오등재로 보입니다.
> ③ **범위** — 전체 단말을 훑어도 이렇게 어긋난 건 이 1건뿐이고, 매출 누락은 0건입니다. 대사·매출 집계에는 영향 없습니다(등록표만의 표기 오류).
> ④ **다음** — 실제 정정(등록표 짝 교정)은 **별도 안전절차(Data-Correction Backfill SOP)** 로만 진행합니다. ①의 총괄 확인 후 승격하겠습니다.

- **실 정정 도출 시**: registry write 는 자동 금지 → **Data-Correction Backfill SOP 봉투 별건 승격**(cross_crm_write_rowcheck 준용: rows-affected assert · freeze-set · 롤백SQL · dry-run 무영속). 정정 방향(유력) = 289009↔153 / 289013↔157 → **289009↔157 / 289013↔153 로 tid swap** (단, 총괄 confirm 이 289009 무선단말의 실제 tid 를 확정한 뒤).

---

## 스코프 준수

- READ-ONLY: Supabase Management API **SELECT only** + RedPay payments.php **GET only**. registry UPDATE/INSERT/DELETE 0, 원장(payments/reconcile/raw) 무접촉, DDL 0.
- 157 hold 상태 유지 = 전부. 자동 비활성·매핑 정정·merchant 통합 미실행.
- 157 은 0722-MISS-BACKFILL 백필 대상 아님(TID 자체 무거래) — 혼동 없음. 본건은 매핑 진단 단독.
- READ-ONLY census 인증컨텍스트 = service_role(정규 token, anon RLS Silent-0-Row 회피).

## 산출 아티팩트

- `T-20260803-foot-REDPAY-NET0-HOLD-157-TIDMERCHANT-DRIFT_probe.mjs` — feed↔registry drift sweep(READ-ONLY, 재실행 가능)
- `_evidence/T-20260803-foot-REDPAY-NET0-HOLD-157-TIDMERCHANT-DRIFT_sweep.out` — probe raw 출력(feed 857건·drift 1·silent-miss 0)
