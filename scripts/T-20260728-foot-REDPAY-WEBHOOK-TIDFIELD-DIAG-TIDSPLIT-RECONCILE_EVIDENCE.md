# T-20260728-foot-REDPAY-WEBHOOK-TIDFIELD-DIAG-TIDSPLIT-RECONCILE — build evidence

- **date**: 2026-07-29 (KST)
- **agent**: dev-foot
- **gate**: `db_change=false` → 대표 게이트 면제 / DA CONSULT 면제(AC-2 매칭 predicate·grain 무접촉 확인 → 재적용 불요) / risk=GO / e2e_exempt=db_only
- **reporter**: 최필경 총괄(doAI, U05L6HE7QF6) / origin C0ATE5P6JTH thread 1784708681.507149
- **scope**: 진단(AC-1) + 워치독 `redpay_terminal_watchdog.mjs` ⑤ TID별 소계 대조 additive(AC-2) + seed 후 수집실적 read-only 검증(AC-3). DDL 0 / 신규 테이블·컬럼·enum·뷰 0.

---

## AC-1 (URGENT) — 웹훅 payload tid/merchant_id 존재확인 → **분기 [B present] + [C reflected]**

권위 대상: `webhook_events` 테이블은 부재 → 실제 웹훅 payload 저장소 = `redpay_raw_transactions.raw_payload`(JSONB), `_source='webhook'` 마커로 폴러행과 구분.

| 검증 | 결과 |
|------|------|
| 웹훅행(`_source='webhook'`) 수 | 28건 (보존창=7/23~7/28, retention 시작=7/23) |
| `data.tid` **키** 존재 | 28/28 |
| `data.tid` **값** 실재(10자리) | **28/28** (빈/NULL 0건) |
| `data.merchant_id` 값 실재 | **28/28** |
| 컬럼 `tid` 매핑 | **0/28** (전량 NULL) |

- **[C] RedPay 7/22 "추가 반영" = 실반영 확인됨**: retention 이 시작되는 7/23 이후 **모든** 웹훅행(28/28, 100%)이 `data.tid`·`data.merchant_id` 를 실값으로 보유. 즉 웹훅 payload 에 tid 가 **구조적으로 존재**(★23:54 근인정정의 "웹훅 payload tid 구조적 부재" 가정은 실측상 뒤집힘 — 부재한 것은 payload 가 아니라 **컬럼 매핑**). retention 이 7/23 시작이라 7/22 이전 부재는 직접 관측 불가하나, "추가 예정 → 실반영" 은 100% 반영으로 확증.
- **[B] 컬럼 미매핑은 설계상 의도(gap 아님)**: `redpay-webhook/index.ts` L256 — 웹훅 EF 는 폴러-소유 컬럼(tid/root_trxid/matched_payment_id/match_rule) 을 **의도적으로 미기입**(onConflict 시 폴러 tid 클로버 방지). tid 는 `raw_payload.data.tid` 에 전량 보존.
- **downstream 손실 없음(확인)**: live 뷰 `v_redpay_reconciliation_daily` resolver = `COALESCE(r.tid, raw_payload->'data'->>'tid')` → 웹훅행 tid 가 대조에 정상 표면화됨. 유일 잔여: 뷰 resolver 를 우회해 raw `tid` 컬럼을 직접 읽는 소비자만 빈값 관측(현행 소비경로엔 해당 없음).
- **결론**: 현행 조회API/폴러 tid = 정본 유지. 웹훅 tid 는 payload(data.tid)에 존재하며 뷰 resolver 로 이미 소비 중. **추가 백필/재수집 불요.**

## AC-2 — 일일 대조에 TID별 {건수, net} 소계 additive

- 구현 위치: `redpay_terminal_watchdog.mjs`(일 1회 09:10 KST = 일일 대조 잡) 에 **⑤ TID별 소계 대조 pass** 신설. ④ TID-grain 대사에서 조회한 RedPay 정본 feed(511∪457 union) 재사용 + DB read-only 페이지 조회.
- **전체 합계 대조 유지** + 그 위에 membership TID별 `{건수, net}` 세분 비교 additive.
- **★불변식 준수(DA 면제 근거)**: 이 층은 read-only 집계/비교만. reconcile 매칭 predicate = trxid 전역유일키(APPROVALNO-NONUNIQUE-GUARD·TIER0-TRXID-HARDENING) **무접촉**. 매칭키를 TID 로 바꾸지 않음 → predicate/grain 미변경 → DA CONSULT 재적용 조건 미해당.
- `maskedByNetting` 신호: 전체 합계는 일치하나 TID별 어긋남 존재 = 현행 "합계만" 대조가 은폐하던 케이스(★핵심).
- **저소음 dedup**: 어긋남 `{건수,net}` 시그니처 기반 — 동일 상태 지속 시 매일 재알림 안 함(값 변경/해소 시에만 재알림·auto-release). state v2→v3 마이그(`alerted_subtotals`).

### evidence
- **self-test 전량 PASS** (`--self-test`):
  - (a) 정상: 239=5건/₩1,090,000 + 246=2건/₩10,200 → 합계·TID별 전량 일치, mismatch 0.
  - (b) ★상쇄 은폐 데모: 승인↔취소가 두 TID 간 뒤바뀜 → 전체 {건수, net} **완전 일치(현행 대조 통과)** 이나 TID별 2종 어긋남 탐지, `masked_by_netting=true`.
  - (c) resolved tid: webhook `data.tid`(컬럼 NULL)도 소계 집계.
  - (d) dedup 시그니처: 동일 어긋남=억제 / 값 변경=재알림.
- **live dry-run**(read-only, 슬랙 미발송·상태 미저장): ⑤ 정상 가동. 실데이터에서 TID `1047479158` = RedPay {2건, ₩0} ↔ DB {0건} 탐지(승인+취소 net-zero 쌍, DB 전량 미수집). **매출영향 ₩0**(완전취소분). AC-2 pass 의 실효 탐지 실증.

## AC-3 — 239/246 seed 후 수집실적 검증 (read-only, 재-seed 없음) → **일치 PASS**

parent 0728GAP(deployed b1f418ab) seed 결과 실측(재-INSERT 0):

| TID | 기대 | 실측(7/28, approved_at KST) | 판정 |
|-----|------|------|------|
| 1047538239 | 5건 / ₩1,090,000 | **5건 / ₩1,090,000** (distinct_trxid=5, 전량 승인) | ✅ 일치 |
| 1047538246 | 2건 / ₩10,200 | **2건 / ₩10,200** (전량 승인) | ✅ 일치 |

- 누락·중복·금액차 **0건** → P0 승격/현장 긴급알림 **불요**.

---

## 변경 파일
- `scripts/redpay_terminal_watchdog.mjs` — ⑤ TID별 소계 대조 pass(AC-2) + self-test + state v3 dedup. (AC-1/AC-3 는 read-only 진단, 코드변경 없음)

## 관찰(참고, non-blocking)
- ⑤ 가 실데이터에서 잡은 TID `1047479158`(superseded 계열, net ₩0 완전취소 쌍) DB 미수집 = 매출영향 없음이나 폴러의 superseded-TID 수집 스코프 재점검 여지. planner 통지에 관찰로 포함(P0 아님).
