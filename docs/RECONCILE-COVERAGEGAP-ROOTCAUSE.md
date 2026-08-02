# RECONCILE coverage-gap orphan — 근본원인 진단 + 파이프 보정 설계

- ticket: `T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE` (P2, GO_WARN)
- parent: `T-20260728-foot-PMW-RECONCILE-AUTOPROMOTE-FORWARDFIX` (deploy-ready, d1668759 — 승격 술어 SSOT, 손대지 않음)
- sibling(class-A): `T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE` (무수납 31건, 별건)
- evidence: `db-gate/T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE_phase1_evidence.{json,md}` (READ-ONLY, write 0)
- 폴러 술어 SSOT: `supabase/functions/redpay-reconcile/index.ts` L671-704

---

## 0. ⚠️ 절대 가드 (masking 금지) — 계승

- 승격 술어 `reconciled_at IS NOT NULL`(FORWARDFIX, DA Q3 앵커, REAFFIRM으로 LITERAL 확정)를 **손대지 않는다.**
- reconcile 못한 결제를 `settled` 광의 술어로 승격시켜 증상만 지우는 것 = DA REAFFIRM(MSG-20260802-110350-7yit)이 반려한 방향.
- 본 트랙 목표 = **파이프를 고쳐 reconcile 되게** 하는 것(또는 non-card는 reconcile 무관 경로로 정합). 승격 게이트 무접점.
- Phase1 = READ-ONLY 자율(write 0). Phase2 write-path/파이프 변경 = **supervisor gate** + (술어가 cross-CRM 공통이면) **DA CONSULT**.

---

## 1. coverage gap 원인 (1줄 확정, AC2)

> **reconcile 매칭풀(`redpay-reconcile` EF)이 `created_at >= now-14d` 인 payment 만 조회한다(index.ts L671·679·694·704, `since14d`). 14일 안에 매칭되지 못한 미대사 결제는 aged-out 후 매칭풀에서 영구 이탈하며, aged-out 행에 대한 재시도·백필 경로가 부재하다 → 사실상 영구 미reconcile.**

폴러 매칭풀 술어(3개 풀 공통, index.ts):
```
.from('payments')
  .eq('payment_type','payment')
  .is('reconciled_at', null)
  .is('external_trxid', null)
  .gte('created_at', since14d)        // ← since14d = now - 14*24h  (coverage 경계)
  // pool1: + .eq('method','card')
  // pool2: + .not('external_approval_no','is',null)
  // pool3: + .not('external_tid','is',null)
```
5분 폴러(cron `foot-redpay-reconcile`)는 정상 동작하지만(286/526 reconciled), 위 `since14d` 술어 때문에 **한 번 14일을 넘긴 미대사 행은 다시는 후보가 되지 않는다.** = "reconcile lag max-ever 14d 초과 = 영구 미reconcile" 재현.

---

## 2. Phase1 실측 (2026-08-02T06:09Z, prod READ-ONLY)

| 구분 | 건수 |
|---|---|
| 미대사 orphan (`payment_type='payment' ∩ reconciled_at NULL`) | **178** |
| 영구 orphan (age > 14d, aged-out) | **44** |
| class-B (payment_waiting stuck ∩ 영구 orphan) | **5** |
| 배제사유 `aged_out_14d` / `within14d_awaiting_raw`(정상대기) / `within14d_no_pool_key` | 45 / 112 / 21 |

**티켓 창설시(11:16 KST) class-B 3건 → 진단시 5건.** 시간이 지나며 07-08 결제쌍이 14d 경계를 넘어 aged-out 집합에 추가됨 — orphan 집합이 **시간에 따라 단조 증가**하는 것 자체가 근본결함(재시도 부재)의 직접 신호. 3→5 증가는 정합(카운트 확대 = masking되지 않은 결함의 자연 노출).

### aged orphan 44건 method 분포 — **2개 서브원인으로 분해**
| method | 건수 | 외부식별자(trxid/appr/tid) |
|---|---|---|
| card | 38 | **전건 NULL (0/38)** |
| cash | 5 | 전건 NULL |
| transfer | 1 | NULL |

전체 aged 44건 중 **external id 보유 0/44** — 어떤 행도 RedPay webhook raw와 링크된 적이 없음.

---

## 3. 근본원인 2-분해 (masking-ban의 근거)

승격 술어를 `settled` 로 완화하면 아래 두 서브원인이 **한꺼번에 쓸려 masking** 되지만, 둘은 **원인도 정당한 처방도 다르다.** 이것이 DA가 완화를 반려한 정확한 이유.

### 서브원인 B1 — aged card orphan (38건, dominant)
- **정체**: 데스크 card 결제가 생성되었으나 그 RedPay VAN 승인 raw 와 14일 내 매칭 실패 → aged-out → 영구.
- **왜 14일 내 매칭 실패했나(후보 가설, Phase2 확정)**:
  - 폴러 활성화(secrets/DRY_RUN=false) 이전 기간 결제 → 그 시점 feed pull 부재로 raw 미수집. 이후엔 window(2h lookback)·since14d 밖 → 영구 미회수.
  - TID whitelist 밖 단말(롱레 TID 혼입 가드로 raw 제외) 또는 non-RedPay 단말 결제.
  - amount·same-KST-day 휴리스틱 다중후보 → tier4_manual 로 강등 후 수동매칭 미이행.
- **처방 방향(masking 아님)**: 파이프가 **실제로 매칭을 완료**하게 — aged-out 재시도(백필 sweep) 또는 매칭풀 lookback 확장. VAN에 실제 승인이 있었는지(돈이 실제 들어왔는지)를 **검증한 뒤** reconciled 스탬프. 승격 술어 무접점.

### 서브원인 B2 — non-card orphan (cash 5 + transfer 1)
- **정체**: `redpay-reconcile` 은 **card-VAN 대사기**다(pool1 `method='card'`, raw = RedPay 카드승인). cash/transfer 는 VAN 대응물이 원천적으로 없음 → `reconciled_at` 은 **설계상 영원히 NULL**.
- **함의**: cash/transfer로 결제된 payment_waiting 은 FORWARDFIX 승격 술어(`reconciled_at NOT NULL`)로 **영원히 승격 불가** — 이건 폴러 버그가 아니라 **승격 술어가 non-card에 부적합**한 것.
- **처방 방향**: non-card settled 는 **reconcile 무관 desk-settle 신호**(예: 결제기록 존재 + method∈{cash,transfer} + 유효 amount)로 별도 승격 경로 설계. **card-VAN reconcile을 기다리게 하면 안 됨.** ← 이 경로를 `settled` 광의로 뭉뚱그려 승격하면 B1 card의 실제 VAN divergence(돈 안 들어옴)를 함께 masking → 반려 사유.

> **결론**: 단일 `settled` 완화 = B1(검증 필요)과 B2(reconcile 무관)를 융합해 둘 다 오판. 파이프는 **서브원인별로 분기**해야 한다.

---

## 4. Phase2 파이프 보정 설계 (→ 구현은 supervisor gate)

> ⛔ 아래는 **설계**다. write-path/파이프 코드 변경·cron 신설·DDL은 **supervisor GO** 후 착수. `since14d` 매칭풀 술어는 `redpay-reconcile` 포크 공통 패턴(longre/body/derm 동형) 가능성 → **DA CONSULT(공통술어 여부 확정)** 선행. 승격 술어(FORWARDFIX) 무접점을 매 변경마다 재검증(masking 0).

### Fix-B1 — aged card 재회수 (택1, DA/supervisor 판정)
- **B1-a (권장, 최소침습)**: 매칭풀 조회에서 `since14d` 를 제거하거나 넉넉히(예: 90d) 확장 — 단, 매칭 성공 시에만 reconciled. 비용: 풀 크기 증가(178→전건), 인덱스 확인(`payments(payment_type, reconciled_at, created_at)`).
- **B1-b (별도 sweep)**: aged-out(`created_at < now-14d ∩ reconciled_at NULL ∩ method=card`) 전용 저빈도(일 1회) 백필 배치 — RedPay 히스토리 API로 과거 raw 재pull 후 매칭. 5분 폴러와 분리해 부하 격리.
- **공통 불변식**: 매칭 근거(amount·card·KST-day·trxid) 없이 강제 reconciled write **금지**(payments read-only 정신). raw 부재로 검증 불가한 건은 **수동매칭 큐(tier4)** 로 남기고 reconciled 스탬프 안 함.

### Fix-B2 — non-card settled 승격 경로 분리
- FORWARDFIX(`reconciled_at NOT NULL`) 는 card 전용 유지. non-card(cash/transfer)는 **별도 술어**(payment 존재 ∩ method∈{cash,transfer} ∩ amount>0 ∩ deleted 아님)로 payment_waiting → 완료 승격 설계.
- 이 술어는 승격 정책 변경 → **DA CONSULT 필수**(FORWARDFIX와 직교 확인 + cross-CRM 정합). 본 트랙에서 **구현하지 않음**, 별건 승격 트랙으로 핸드오프 권고.

### Fix-C — 관측성 경보 (AC4, 재발 조기탐지)
- read-only 모니터: `scripts/T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE_orphan_lag_monitor.mjs` (본 커밋 동봉, write 0).
  age 버킷별 orphan 카운트 + `lag > N일` 임계 초과 건수 산출.
- 경보 wiring(cron/Slack post)은 write-path → supervisor gate. FORWARDFIX GO조건6(관측성)과 정합: `reconcile lag > 14d orphan 건수`를 일일 지표로 노출, 임계 초과 시 알림.

---

## 5. AC 대사

| AC | 상태 |
|---|---|
| AC1 — class-B per-row root-cause(폴러 배제지점 grounding + 재현 evidence, write0) | ✅ evidence.{json,md} + §1 코드 grounding |
| AC2 — coverage gap 원인 1줄 | ✅ §1 (`since14d` aged-out, 재시도 부재) |
| AC3 — Phase2 보정안 설계 + 승격술어 무접점(masking0) + gate | ✅ §4 설계 / 구현은 supervisor+DA gate로 유보(본 커밋 write0) |
| AC4 — reconcile lag 초과 orphan 경보(관측성) | ✅ orphan_lag_monitor(read-only) 동봉 / 경보 wiring은 gate |

## 6. 산출물 (본 커밋, 전부 write 0 · DDL 0)
- `scripts/…_phase1_probe.mjs` — READ-ONLY per-row 진단 프로브
- `scripts/…_orphan_lag_monitor.mjs` — READ-ONLY lag 버킷 모니터(관측성 근거)
- `db-gate/…_phase1_evidence.{json,md}` — 실측 evidence
- `docs/RECONCILE-COVERAGEGAP-ROOTCAUSE.md` — 본 문서

> Phase2 파이프 코드/cron/DDL 변경 없음 → `db_change:false`, `e2e_spec_exempt:db_only` 유지. 파이프 구현 귀결 시 별도 티켓 + 면제 해제 + MIG-GATE.
