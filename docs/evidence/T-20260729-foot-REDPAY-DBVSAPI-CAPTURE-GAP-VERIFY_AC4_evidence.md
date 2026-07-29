# T-20260729-foot-REDPAY-DBVSAPI-CAPTURE-GAP-VERIFY — AC-4 evidence

- date: 2026-07-29
- agent: dev-foot
- mode: **read-only 진단 (SELECT only, db_change=false)** — DA CONSULT/대표게이트/supervisor DDL-diff 면제(no-DDL·no-data) 유지
- project(prod): rxlomoozakkjesdqjtvd (foot). clinics: `jongno-foot`(457-23-00938), `songdo-foot`
- source: `redpay_raw_transactions`, `redpay_terminal_registry`, `redpay_poller_state` prod probe (Supabase Mgmt API `/database/query`)

---

## AC-4.1 — reporter 실측 3건 편측적재 여부

reporter TID: **1047479475 / 1047479158 / 1047479153** (각 승인+취소 net0 주장)

| TID | raw rows | 승인(Y) | 취소(N) | net | registry 상태 | 판정 |
|-----|---------|--------|--------|-----|--------------|------|
| 1047479475 | 6 | 3 | 3 | 0 | **superseded** (→1047538246, §11 0728 GAP) | **양측 전량 적재** (3쌍 balanced). 07-13·07-20 test txn(승인 직후 초단위 취소, 금액 100/444/2,000,000) |
| 1047479153 | 2 | 1 | 1 | 0 | active foot (merchant 1777289009) | **양측 전량 적재** (1쌍 balanced). 07-23 test txn(±1,004) |
| 1047479158 | **0** | 0 | 0 | 0 | active foot (merchant 1777289012) | **전량 미적재** (0행) — 양측 모두 부재 |

**편측(one-sided) 적재 = 없음.** 적재된 2 TID는 승인/취소 쌍이 완전 balanced(양측 다 걷힘 → net0는 "우연"이 아니라 실제 승인→취소 test 거래). 1 TID(1047479158)는 0행(양측 대칭 부재 → net0, 편측 아님).

> **AC-4.1 P1 트리거("편측 1건이라도 발견") = 미발화.** 3건 어디에도 승인/취소 카운트 불일치(편측) 없음.
> 단, 1047479158 0행은 (a)해당 단말 무거래 or (b)RedPay엔 있으나 미fetch 를 DB만으로는 구분 불가 — RedPay-side 실측(reporter 보유)과 대조 필요. 어느 경우든 **양측 대칭 부재 → 현재 금액 과대/과소 없음.**

---

## AC-4.2 — 구 회선(511 세대) 수집범위 점검 + fetch-scope map

### 아키텍처 사실 (코드 확인)
1. **business_no(511/457)는 raw_payload에 미보존** — payload key에 merchant.id/tid는 있으나 business_no 없음. 511↔457 구분은 stored data로 사후 분류 불가(RedPay API 요청 scope param에만 존재).
2. **business_no는 행-적재 술어가 아님** — `filterToFootScope`(scope-filter.ts)는 merchant_id(FOOT_MERCHANT_SET 27) 1차 권위 + TID 보조. dedup 키에 bizno 성분 없음(bizno-isolation.regress.test 불변식). ⇒ 07-23 511→457 flip은 "어느 행이 적재되나"에 무관.
3. **fetch window = 시간 기반** — daily_full: 어제 00:00 KST→now(≈2일), incremental: 슬라이딩 max 2h lookback. business_no 윈도 없음.

### 커버리지 map (redpay_raw_transactions, total 405행, span 07-10~07-28)
- 일자별 연속 존재: 07-10,11,13,14,15,16,17,18,20,23,24,25,27,28 (영업일 형태)
- 결측일: 07-12,19,21,22,26 (휴무/무거래 패턴, fetch gap 아님)
- **07-23 flip 경계 cliff 없음**: 07-23=27행 / 07-24=40행 (정상 증가). 511→457 flip이 수집 절벽을 만들지 않음.
- daily_full floor(어제 00:00)는 pre-07-27을 재fetch하지 않음 → 과거일은 live 캡처분에 의존(구조적 window-floor, 511 특이사항 아님). **511 scope 재fetch 필요 경로 없음**(floor가 pre-07-23에 미도달 → moot).

### ⚠ AC-4.2가 표면화한 결정적 발견 — **body(도수) 도메인 cross-domain 오염 (live·진행중)**
`filterToFootScope`가 drop해야 할 **BODY_MERCHANT_SET(1777274/275/276 band, 도수/재활)** merchant 행이 foot 테이블에 clinic_id=`jongno-foot`로 적재됨:

| kst_day | merchant_id | 명칭 | Y net | N net | matched→foot payment |
|---------|-------------|------|-------|-------|----------------------|
| 07-23 | 1777276003 | 도수(무선) | +1,004 | -1,004 | 0 (net0, 기존 62071914 leak 계열) |
| 07-24 | 1777275006 | 도수(멀티) | +10,000 | — | **1** ← foot payment에 매칭됨 |
| 07-25 | 1777275006 | 도수(멀티) | +50,150 | — | 0 |
| 07-27 | 1777275006 | 도수(멀티) | +126,220 | — | 0 |
| 07-28 | 1777275006 | 도수(멀티) | +4,764,400 | -205,200 | 0 |

- **07-24~present 도수 band 순증 = +₩4,745,570** (non-net-0). 07-28(1일 전)까지 **진행중** — legacy 아닌 live 누수.
- **1건(07-24 +10,000)은 foot payment에 이미 matched** → foot 정산에 실침투.
- scope-filter.ts(DOSU-CONTAM-FIX 파트A)에 merchant-drop 로직은 존재하나, 실 poller 경로에 미발효 추정(redpay-poller 전용 checkout Phase A가 07-29 착수). 07-25 dosu_contam_delete 마이그도 1777275006 band 잔존 미커버.

> 이 오염은 **AC-1(A12 07-24~present) delta≠0을 유발하는 구체 메커니즘**이며, reporter의 "P2=지금 라이브 매출영향 미발화" 전제를 falsify(+4.75M pooled, 1건 matched). → **P1 상향 근거.**

---

## AC-4.3 — registry SSOT 무접촉

- 본 진단 전량 SELECT — registry write 0건. 무접촉 유지 확정.
- 3 TID membership 온전: 1047479153 active foot ✓ / 1047479158 active foot ✓ / 1047479475 superseded(→1047538246, 정상 은퇴) ✓.

---

## poller_state (fetch window anchors, at db_now 2026-07-29 02:09 UTC)
- last_incremental_to = 2026-07-29 02:07:36Z (2분전, 정상 가동), last_fetched=0/upserted=0 (심야 무거래 정상)
- last_daily_to = 2026-07-28 20:31:02Z (daily_full 07-28 저녁 가동 — AC-2 재가동 정합)

---

## 결론 / escalation
- **AC-4.1 편측 = 미발화** (strict AC-4.1 P1 트리거 negative).
- **AC-4.2 = live cross-domain(body/도수) 오염 실증** — +₩4,745,570 순증(07-24~), 진행중, 1건 foot payment matched. **AC-1 delta≠0 driver → P1 상향 planner FOLLOWUP.**
- **AC-4.3 registry 무접촉 확정.**
- 후속 조치(오염 행 정리)는 **cross-domain(body) + destructive** → dev-foot 단독 불가. DA CONSULT(archive-first, Cross-CRM Data-Correction SOP) + poller scope-filter 실발효 배포는 planner 라우팅 대상. 본 티켓은 read-only 진단 종결.
