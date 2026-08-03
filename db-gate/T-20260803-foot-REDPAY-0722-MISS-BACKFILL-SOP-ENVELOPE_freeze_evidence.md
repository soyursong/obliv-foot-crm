# T-20260803-foot-REDPAY-0722-MISS-BACKFILL-SOP-ENVELOPE — FREEZE 봉투 증거

> **Cross-CRM Data-Correction Backfill SOP 봉투** — 07-22 RedPay 폴러 미적재 소급 재적재.
> READ-ONLY dry-run (`scripts/T-20260803-foot-REDPAY-0722-MISS-BACKFILL-SOP-ENVELOPE_dryrun.mjs`).
> 실행: 2026-08-03 (dev-foot). **INSERT/UPDATE/DELETE 0 — 자동백필 미실행.**
> ★ 실 apply(착수)는 SOP per-row comp-gate(박민지/총괄) 승인 + `_apply.mjs --apply` + `COMP_GATE_APPROVER` 서명 후에만.
> ★ net 0원 trivial 1건 → '완전성 재적재 vs 문서화만' 최종판단은 총괄 위임(responder DECISION-REQUEST). 본 문서는 봉투(freeze 스냅샷 + 실행자산) 준비 전용.

---

## 0. freeze-set (dep A ROOTCAUSE AC-2 확정 + 본 dry-run 4번째 독립 재현)

| 축 | 값 |
|---|---|
| 날짜(KST) | 2026-07-22 |
| business_no 버킷 | 457-23-00938 (flip 후 전 이력 귀속처 — 2건 실재) |
| clinic_id | 74967aea-a60b-4da3-a0e7-9c997a930bc8 (종로 풋) |
| merchant_id | 1777289012 |
| TID | 1047479158 |
| 행 수 | **2행** (취소쌍) · net **0원** |

### 지문 (idempotency key = external_trxid \| external_status \| amount)
| external_trxid | status | amount | tid | approved_at(KST) | approved_at(UTC) |
|---|---|---|---|---|---|
| 0722C8038056 | Y (승인) | +5000 | 1047479158 | 2026-07-22 17:30:13 | 2026-07-22T08:30:13Z |
| 0722C8038132 | N (취소) | −5000 | 1047479158 | 2026-07-22 17:30:56 | 2026-07-22T08:30:56Z |

**확증 4중** (동일 결론):
1. dev delta1 스윕 (ROOTCAUSE `_ac2_sweep.mjs`) — 07-11~08-02 전기간 07-22 단 1일 Δ2건.
2. ENVGAP RedPay↔DB 전기간 delta — 실 미적재 = 07-22 딱 2건 `[0722C8038056, 0722C8038132]`.
3. supervisor 독립 `delta.mjs` 재실행 (dev 출력 신뢰 아님) — 동일 2건.
4. **본 backfill dry-run (2026-08-03)** — feed 457 merchant 1777289012 = 2건 모두 `⚠미적재`, raw 부재 재확인.

---

## 1. AC-1 — 버그경로 지문 교집합 (대상셋 산정)

미적재 대상 = **`day=07-22` ∧ `merchant=1777289012` ∧ `RedPay feed(457)에 실재` ∧ `redpay_raw_transactions에 부재`**.
단일-count blanket UPDATE 금지 원칙 준수 — 도출셋을 확정 freeze-set 과 3중 assert 로 재검증(크기=2 / 집합동일 / TID동일). 하나라도 불일치 시 ABORT(범위 drift → apply 금지).

### dry-run 판정근거 스냅샷 (2026-08-03 실측)
```
trxid          status  amount   tid          approved_at          in_raw?
0722C8038132   N        -5000 1047479158   2026-07-22 17:30:56  ⚠미적재
0722C8038056   Y         5000 1047479158   2026-07-22 17:30:13  ⚠미적재

freeze-set 재검증: 도출 미적재셋(2) == 확정 freeze-set(2), 크기=2, TID=1047479158 → ✅ PASS
INSERT 예정 net = 0원 (Y+5000 ∧ N-5000 취소쌍)
```

---

## 2. AC-2 — SOP 표준 준수 항목

| SOP 요건 | 구현 | 상태 |
|---|---|---|
| dry-run | `_dryrun.mjs` (write 0, freeze 재검증 + 스냅샷 + INSERT 미리보기) | ✅ 실행완료 |
| 대상셋 freeze | 확정 freeze-set 2행으로만. 3중 assert(크기/집합/TID) drift 시 ABORT | ✅ |
| 판정근거 스냅샷 동봉 | 본 문서 §0·§1 + dry-run stdout | ✅ |
| rows-affected assert | `_apply.mjs` EXPECT_ROWS=2, return=representation 반영행 카운트 검증 | ✅ (apply 러너 내장) |
| 멱등 | `on_conflict=external_trxid,external_status,amount` + resolution=merge-duplicates (폴러 upsert 와 동일 SSOT) | ✅ |
| 폴백 | `_rollback.sql` (정확히 2행 idempotency-key 스코프 DELETE, BEGIN/ROLLBACK 기본 무영속) | ✅ |
| 원장 무접점 | redpay_raw_transactions 단일. payments/reconcile/ledger/취소경로 미접촉 | ✅ |
| comp-gate 하드게이트 | `--apply` + `COMP_GATE_APPROVER` 서명 이중 fail-closed (미충족 시 write 0) | ✅ (apply 러너 내장) |

INSERT 행은 폴러 `toRawTrxRow` 매핑을 그대로 미러 — 정상 수집됐을 경우와 **바이트 동형**의 행을 재적재(스키마·부호·타임존 동일).

---

## 3. AC-3 — 하류 reconcile 파급

- net 0원 취소쌍(Y+5000 즉시 N−5000) → **매출·정합 영향 실질 0**. 매칭풀·수납·매출 집계 왜곡 없음.
- apply 후 검증: `redpay_terminal_watchdog.mjs` ④ TID-grain 대사로 raw↔feed 정합 재확인(247=247 유형).
- 원장(장부) 무접점 — 기존 결제·수납·매칭·취소 경로 불변.

---

## 4. 실행 절차 (comp-gate 통과 후, 사람 실행 전용)

```bash
# (1) freeze 재검증 (write 0)
node scripts/T-20260803-foot-REDPAY-0722-MISS-BACKFILL-SOP-ENVELOPE_dryrun.mjs

# (2) 박민지/총괄 per-row comp-gate 승인 확보 + '완전성 재적재' 결정(총괄) 수신 후:
COMP_GATE_APPROVER="<승인자>" \
  node scripts/T-20260803-foot-REDPAY-0722-MISS-BACKFILL-SOP-ENVELOPE_apply.mjs --apply

# (3) 롤백 필요 시 (SELECT 2행 확인 → COMMIT 주석 해제)
psql "$DATABASE_URL" -f scripts/T-20260803-foot-REDPAY-0722-MISS-BACKFILL-SOP-ENVELOPE_rollback.sql
```

## 5. 스코프 가드 (준수)

- **자동 백필 절대 금지** — comp-gate 통과 전 write 0. (본 커밋 시점 write 0 확인.)
- freeze-set = dep A 확정셋으로만. 임의 확대 금지(3중 assert 로 강제).
- 원장 무접점. 기존 결제·수납·매칭·취소 경로 불변.
- `db_change=false` — 스키마 변경 없음(기존 raw 테이블 소급 INSERT, 신규 컬럼·테이블·enum 0 → DA CONSULT 게이트 비대상).
