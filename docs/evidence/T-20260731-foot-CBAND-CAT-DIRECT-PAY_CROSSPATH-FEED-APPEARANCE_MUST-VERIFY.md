# §5 CROSS-PATH GUARD — MUST-VERIFY 결과 (wnl0)

> 티켓: T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD
> 질문(가정 금지·introspection으로 확정): **CAT-direct(코밴 CAT 단말 직결) 승인 거래가 RedPay 정산피드(`redpay_raw_transactions`)에 실제로 출현하는가?**
> 방법: READ-ONLY prod introspection (ref `rxlomoozakkjesdqjtvd`, write/DDL=0). probe = `scripts/T-20260731-foot-CBAND-CAT-DIRECT-PAY_CROSSPATH-FEED-APPEARANCE_probe.mjs`
> 실행: 2026-07-31 (KST 심야, poller live). dev-foot.

---

## 판정: **출현 O (near-certain YES)** — 아키텍처로 확정, 런타임 dispositive confirm은 field-soak로 이월

DA canon(zpas 23:19)의 "near-certain YES" 가정이 introspection으로 **강하게 뒷받침됨**. → **매처 skip-guard(③ DEDUP) 필수.** ① C2 ISOLATION RETRACT는 정당.

---

## 근거 (실측)

### E1. RedPay 피드 = foot VAN 카드단말 정산피드 그 자체 (결정적)
최근 VAN-CARD raw item 1건(마스킹):
```
tid=1047535843  pg_name=VAN-CARD  pg_type=P3  payment_method=단말기  status=승인
merchant.id=1777285002  merchant.name="오블리브-서울오리진점 풋2(VAN)"
```
- merchant 이름에 **"(VAN)"** 명시 = 이 피드에 실리는 거래는 **물리 카드단말(VAN) 정산분**.
- CAT-direct는 카운터의 **같은 VAN 단말**을 CAT 프로토콜로 구동 → 승인은 **동일 VAN을 통해 동일하게 정산** → 동일 `payments.php` 피드에 출현. VAN은 수기 키패드 개시 vs CAT 명령 개시를 **구분하지 않고** 동일하게 파트너 API로 보고.

### E2. 피드 provider 시그니처 = 전량 단말기 정산 (최근 500건)
| 건 | pg_name | pg_type | method |
|----|---------|---------|--------|
| 302 | PG | P2 | 단말기 |
| 158 | VAN-CARD | P3 | 단말기 |
| 28 | VAN-CASH | P3 | 단말기 |
| 12 | (null) | | |
- **460/500이 `method=단말기`** = 물리 단말 정산. CAT-direct 승인이 타는 바로 그 경로.

### E3. registry 41행 = foot/body VAN 단말 SSOT, foot TID가 피드 지배
- foot 등록 단말 27종(1777285xxx / 1777288xxx / 1777289xxx). 피드 TID 상위(1047535843 98건, 1047538231 35건 …)가 registry foot TID와 일치.
- 총괄 최필경이 **단말기·레드페이 정산**을 소유(티켓 역할구분) = CAT-direct가 붙는 단말 = 기존 RedPay 정산 단말. **별도 신설 단말 언급 없음.**

### E4. 피드 LIVE·최신
- `redpay_poller_state.last_incremental_to = 2026-07-31T14:45 UTC (=23:45 KST)`, last_upserted=35. 7/31 승인 raw 35건 실재. 피드는 실제로 돌고 있음.

---

## 정직한 한계 (not-fully-dispositive)

1. **7/31 코밴 대리점 실검증 거래는 foot 피드에 출현하지 않음.** 테스트금액대(1001~1006) 히트 0건. 7/31 피드 35건은 전부 실거래 금액(1,020,000 / 8,800 …). → **대리점 데모 단말 = foot 프로덕션 merchant 스코프 밖** → 대리점 검증은 "피드 출현"의 증거가 **아님**(별 단말).
2. **아직 CAT-origin 거래가 피드에 0건** (플래그 OFF·클리닉 미배포). **완전 dispositive 확정은 첫 프로덕션 CAT 승인 관측**이 필요 → field-soak 시 이 probe 재실행해 **동일 AUTHNO+TID가 피드에 출현**하는지 런타임 confirm 권고(§416 RC-first 정신).
3. **deploy-time config 사실 1건 확인 필요**: 총괄 최필경이 CAT 데몬으로 구동하는 단말의 **MERNO(가맹점번호)**가 foot registry 27종 안인지. registry 밖 별 merchant면 이론상 출현 X. → responder 경유 최필경 확인 권고(어느 단말/MERNO를 CAT가 구동하는가).

---

## 설계 함의 (canon zpas와 정합 — 확인/보정)

- **③ DEDUP 채택 유지 / ① C2 ISOLATION RETRACT 정당.** CAT payment를 매칭 pool에 정상 편입시켜(external_approval_no+external_tid) raw R↔P 매칭·`reconciled_at` set → 중복 INSERT 억제. C2(pool 제외)는 오히려 double-count 유발이므로 RETRACT가 옳음.

- **★보정 — 앵커는 단독키가 아니라 COMPOSITE corroborator (영구 불변식).**
  `matcher.ts` L201/236/240 불변식: 식별자(trxid/approval_no/tid) **단독 auto-link 금지 — 반드시 amount ∧ card ∧ same-KST-day ∧ forward 와 함께**. 특히 `approval_no=비고유(코반 재활용)`(L212). 따라서 canon의 "공유멱등앵커 = external_approval_no + tid"는 **composite corroborator**로 구현해야 함(단독 유일키 오해 금지). CAT payment는 이를 자연 충족(정확 amount·method='card'·paid_at=승인시각) → 기존 Tier0 불변식 무저촉으로 DEDUP 성립.

- **★중요 — double-INSERT 벡터는 `redpay-planb-match`가 아님.**
  `redpay-planb-match/index.ts` L28: "pending_payment 은 payments 를 write 하지 않는다." planb 매처는 pending_payment(예정) 전이만·payments INSERT 없음. 실 매출 대사는 `redpay-reconcile`(4-Tier, 기존 payments 파이프)가 계승. **실 중복 INSERT 벡터 = Plan B auto-create 경로(webhook, 현재 INERT — PLANB-GOLIVE-0805 활성화 시점)**. → skip-guard는 그 golive와 동기화되는 forward 요구이며, DEDUP(CAT payment가 pool에 anchor와 함께 존재)이 이를 무력화(raw R이 orphan 판정 전에 기존 CAT payment로 claim/match됨).

- **MERNO/TID cross-tenant 격리**: `redpay_terminal_registry`(domain=foot 27 merchant/tid) 대사 유지 — 출현 여부와 무관하게 REQUIRED.

---

## 결론 한 줄
CAT-direct 승인은 **기존 foot VAN 카드단말과 동일 VAN 정산경로**를 타므로 RedPay 피드에 **출현함(near-certain)** → **③ DEDUP + reconcile Tier0 composite 앵커(external_approval_no+external_tid)** 로 중복수납 차단. C2 ISOLATION RETRACT 정당. 완전확정은 첫 프로덕션 CAT 거래 field-soak 관측 + 최필경 MERNO 확인.
