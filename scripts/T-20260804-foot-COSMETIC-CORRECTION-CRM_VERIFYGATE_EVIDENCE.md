# T-20260804-foot-COSMETIC-CORRECTION-CRM — STEP3 BLOCKING verify-gate 결과 (Q1-5 + Q3)

> DA CONSULT-REPLY (DA-20260804-foot-COSMETIC-CORRECTION-LINEEXCL, MSG-20260804-191806-g5rl) 게이트순서 step1.
> 실행: `scripts/…_03_verifygate.mjs` (READ-ONLY, prod write 0). prod `rxlomoozakkjesdqjtvd`.
> 결론: **재-CONSULT 트리거 발동** — DA premise("제외 3라인 전부 payment 有/real money moved") = **FALSIFIED**. apply/deploy-ready HOLD 유지.

## Q1-5 — 제외 4라인 매출-진성 분류 (net cash-in 기준, refund 상쇄 반영)

| tag | 라인 | 방문 payment(gross) | **refund 상쇄 후 net** | 진성판정 | 총괄 사유 |
|---|---|---|---|---|---|
| #1a | 김OO 안티펑거스 287,000 (7/3) | **0건** | **0** | 매출-**비진성** | "테스트" |
| #1b | 김OO 풋샴푸 42,000 (7/14) | 290,900 pay **+ 290,900 refund** | **0 (phantom pair)** | 매출-**비진성** | "테스트" |
| #2b | 오렌지족 풋샴푸 42,000 (7/13) | 313,370 pay **+ 313,370 refund** | **0 (phantom pair)** | 매출-**비진성** | "테스트" |
| #4 | 정가언 CTB 15,000 (7/23) | **0건** (고객 pay_total=0 전기간) | **0** | 매출-**비진성** | "명단에없음/오귀속" |

### 핵심 발견 — Gate-0 raw sum이 refund를 상쇄하지 않았음
- Gate-0 evidence는 payment **gross sum**(오렌지족 626,740·김OO 방문 581,800)을 읽어 "payment 有"로 판정했으나, **type=payment / type=refund 동일액·동일일 phantom 자기상쇄쌍**을 net하면 **4라인 전부 net cash-in = 0**.
- #1b/#2b의 gross payment는 **의료(레이저+진찰료) 금액**이지 화장품(샴푸 42,000)이 아님 (오렌지족: 300,000 laser + 13,370 재진 = 313,370, 샴푸 42,000 미포함). 그마저 전액 refund → 순현금 0.
- #1a(287,000)·#4(15,000)는 방문 payment 자체가 0.
- ∴ **제외 4라인은 전량 "화장품 라인이 등록됐으나 실제 판매/수금 없음"(오등록/샘플/test)** — DA가 가정한 "real money moved, metric-miscounted"가 **아님**.

### DA 판정축(1-3/1-5) 대입 결과
- DA rule: `real money → metric-scoped(is_excluded_from_sales)` / `non-genuine → is_test/is_simulation 트랙`.
- 4라인 전량 **non-genuine** → DA 기본권고(metric-scoped)와 **반대 방향** → DA re-CONSULT 트리거 명시 해당:
  > "어느 제외 라인이 non-genuine(매출-비진성)로 판명 → 매출 제외 경로(is_test/is_simulation)+동반 payment 처리 재검토."

### dev 권고 (DA 최종판단 보조 — 뉘앙스)
- **단일 사유는 성립**(4라인 균질: cash-in 0/오등록). 사유 혼재로 인한 트랙 분리는 불요 — 단 방향이 non-genuine.
- **payment 은닉 리스크 부재**: 이 라인들은 애초 `v_daily_revenue` 밖(FE client-side 집계) + cash-in 0. line-grain flag는 김OO ₩7M(OTHER 방문) 무접촉 → is_simulation 재사용 REJECT 근거(₩7M 은닉)는 line-grain flag엔 미적용.
- **동반 payment 처리 대상 없음**: void할 cosmetic cash 자체가 없음. #1b/#2b의 phantom pay+refund는 **이미 net-zero 의료결제**로 본 화장품 정정과 무관(별개 데이터품질 이슈 = body 7월 phantom-refund 계열).
- ∴ 저장 메커니즘은 여전히 **line-grain check_in_services boolean flag(정확히 이 4 PK)**로 동일하게 안전. 남는 결정 = **semantic/naming**: cash-in 0을 반영하면 `is_excluded_from_sales`(real-but-excluded)보다 **"판매 아님/void/test"** semantic이 정직. **DA 최종 확정 요청**(naming + read-path 계약 재확정).

## Q3 — #3 김정숙 F-4872 풋샴푸 42,000 실수금 vs 미수

- 김정숙 3방문(7/18·7/25·8/1) 전량 스캔: **풋샴푸 라인 0건, 42,000 payment 0건** (`(4c)=[]`). 유일 payment = 8/1 ₩1,800(무관).
- DA Q3 분기: (a)실수금→line+payment / (b)미수→line-only+payment_waiting.
- **데이터상 42,000 cash-in 흔적 전무 → (a) 실수금 확인 불가.** (b) 미수 또는 non-event 방향.
- dev 단독 판정 불가(무단 원장 INSERT 금지, DA 3-3). → **현장(김주연 총괄) 확인 필요**: ① 42,000 실제 수금 여부, ② 판매일/host 방문(7/18·7/25·8/1 중), ③ 판매자(임별 확정?). 확인 전 #3 INSERT HOLD.

## FREEZE SET 무변동 확인
- 제외 4 PK(b81521e2/aaec854c/81682cf7/31ea7f5e) + 재귀속 2 PK(76199926/3a8ed9f3) = STEP1 실측과 동일. 지문 불일치 0.

## 게이트 상태 (변동)
- [x] STEP1 dev BLOCKING verify-gate **완료** — 결과 = **재-CONSULT**(제외 premise falsified) + Q3 **현장확인 필요**.
- [ ] DA read-path 계약 **재확정 대기** (naming: is_excluded_from_sales vs is_test/void — cash-in 0 반영).
- [ ] #3 Q3 현장확인(총괄) 대기.
- [ ] (변동없음) 박민지 comp-gate(Track A 재귀속) · supervisor dry-run.
- **apply/deploy-ready HOLD 유지.** prod write 0.
