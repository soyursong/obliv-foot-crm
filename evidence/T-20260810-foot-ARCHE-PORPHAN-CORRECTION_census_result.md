# T-20260810-foot-ARCHE-PORPHAN-CORRECTION — dev-foot BLOCKING census (READ-ONLY)

- **ticket**: T-20260810-foot-ARCHE-PORPHAN-CORRECTION
- **msg**: MSG-20260810-015819-4nky (planner NEW-TASK · READ-ONLY BLOCKING census)
- **DA SSOT**: da_decision_foot_arche_porphan_correction_spec_20260810.md (verdict=조건부 GO)
- **governing template**: da_decision_scalp2_arche_chasu_misu_correction_spec_20260810.md
- **prod ref**: rxlomoozakkjesdqjtvd (obliv-foot-crm)
- **mode**: READ-ONLY / SELECT-only + code-inspection. **prod write/DDL 0. 정정/apply 착수 0.**
- **run date**: 2026-08-10
- **probes** (SELECT-only, repo scripts/):
  - `T-20260810-foot-ARCHE-PORPHAN-CORRECTION_census_probe.mjs` (Q-A + healthy-49 anchor reverse-eng)
  - `T-20260810-foot-ARCHE-PORPHAN-CORRECTION_qc_probe.mjs` (Q-C 3-partition)
  - `T-20260810-foot-ARCHE-PORPHAN-CORRECTION_absent_probe.mjs` (absent-class characterization)
- **freeze 대상셋**: 62 P-orphan PK = `evidence/T-20260810-scalp2-ARCHE-PORPHAN-CROSSFORK-CENSUS_foot_result.md` (변동 없음)

---

## Q-A (★DA 최우선 BLOCKING) — Leg-B(선수금 원장) 존재여부

### 판정 = **(i) 구매시점 완납/선납(prepaid-at-purchase) 모델 → 방문일별 선수금 원장 gap 부재 → Leg-B 불요 → 재-결선(Leg-A) 단독 정합**

**★scalp2(아르케 실손=방문일별 수납·선수금 1급)와 foot 은 이 축에서 DIVERGENCE(비동형).**

근거 (실측 + code-inspection):

1. **결제 grain = 패키지(계약) grain, 방문 grain 아님**
   - `packages`: `total_amount`(계약총액) + `paid_amount`(default 0) — 계약 grain 필드.
   - `package_payments`: 126 pkg w/ pay 中 **single-payment 104 / multi 22**, **same-day 121 / spread 5**. 총 결제행 168 / pkg 126 ≈ **1.33 결제/pkg** → 방문마다 수납이면 회차수(수~수십)만큼 결제행이 생겨야 함. 아님 = **구매시점 결제**(카드할부 `installment` 컬럼은 카드 금융할부이지 방문별 수납 아님).

2. **`package_sessions`(회차 소진/draw-down) 에는 결제/paid_amount 컬럼 자체가 없음**
   - 컬럼 = session_number/session_type/session_date/unit_price(참고표시)/surcharge/status. **회당 수납 원장 없음.** 회차 = 선납 크레딧의 순수 draw-down.

3. **`package_credit_ledger`(선납 크레딧 원장) 실측 = charge 17건(49.71M) / use 0건 / refund 0건 / transfer 0건**
   - 방문별 소진(use) tx **전무** = 회차 소진이 MONEY 원장으로 추적되지 않음(전환기·best-effort mirror·§10-5). scalp2 의 paid_amount=0 per-session gap 같은 재구성 대상 자체가 없음.

4. **재-결선 = money-field 무접촉 (G4 by-construction clean)**
   - `check_in_services` money 컬럼 = `price`/`original_price`. 정정 = **`package_session_id` FK 만 write** → price/original_price/payments/paid_amount/credit_ledger 전부 무접촉. phantom 미수 = **coverage/count offset**(패키지-커버 라인이 미인식)이지 방문별 현금 부족분 아님.

5. **참고 — 패키지-레벨 미수(paid_amount<total_amount)는 존재하나 무관**
   - underpaid pkg 120 / zero_paid 115 (of 512 active). 단 이는 **구매-레벨 선재(pre-existing) 미수**로, P-orphan 재-결선(FK write)이 **접촉하지 않음**(직교축). scalp2 Leg-B(방문별 paid_amount 재구성)와 성격 상이 → Leg-B parity 미발동.

**⟹ foot 정정 = Leg-A(재-결선 fill-on-NULL FK) 단독. Leg-B(MONEY 원장 게이트·박민지 comp-transparency·evidence floor) 불요.**
(DA §Q2-(2) "(i) 완납 → Leg-B 없음·재-결선 단독" 경로 착지. 재-CONSULT 트리거 #2 미발동.)

---

## Q-B — foot-schema exact-anchor (DETERMINISTIC 재-anchor)

### anchor = **`package_sessions.check_in_id = check_in_services.check_in_id` ∩ 동일 customer ∩ session_type 일치 ∩ target ps 미claim**

**★scalp2 arche-entitlement anchor blind-copy 아님 — foot 패키지 스키마로 재-bind.**

근거 — **healthy 49 역공학 (100% 일관)**:
| 지표 | 값 |
|---|---|
| healthy_total (is_pkg=T ∩ sid≠NULL) | 49 |
| ps.check_in_id == cis.check_in_id | **49 (100%)** |
| ps.check_in_id NULL | 0 |
| ps.check_in_id ≠ cis.check_in_id | 0 |

→ healthy 링크의 canonical 관계 = **회차(package_session)는 자신이 소진된 방문(check_in)을 `check_in_id`로 기록**. 이것이 foot-native exact-anchor.

**session_type ↔ service_name 매핑 (healthy 실측, 1:1 clean)**:
| session_type | service_name | healthy n |
|---|---|---|
| unheated_laser | 비가열성 진균증 레이저 치료 | 30 |
| podologue | 포돌로게(내성발톱 치료의료기기) | 11 |
| heated_laser | 가열성 진균증 레이저 치료 | 8 |

62 P-orphan service_name 분포: 비가열성 44 / 가열성 10 / 포돌로게 6 / **비가열레이저 - AF 2**.
- `비가열레이저 - AF`(2건, healthy 미출현 신규명) → session_type=`unheated_laser` 로 매핑(AF=비가열 계열). **per-row 확인 대상**(매핑 확정 근거 약함 → apply 전 현장/명세 확인 권고).
- 전체 session_type universe = heated_laser/podologue/reborn/trial/unheated_laser.

**exact-anchor 술어 (Leg-A, DETERMINISTIC · fill-on-NULL · preserve-on-non-NULL)**:
```
UPDATE 대상 = check_in_services cis  WHERE cis.is_package_session=true AND cis.package_session_id IS NULL
target ps  = package_sessions ps
   WHERE ps.check_in_id = cis.check_in_id                       -- 방문 일치(foot-native anchor)
     AND ps.package_id ∈ (SELECT id FROM packages WHERE customer_id = check_ins.customer_id)  -- 동일 고객
     AND ps.session_type = map(cis.service_name)                -- 회차종류 일치
     AND ps.deleted_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM check_in_services c2 WHERE c2.package_session_id = ps.id)    -- 미claim(healthy 49 overwrite 방지)
   → 유일확정(정확히 1건)일 때만 auto-link
```

---

## Q-C — 62 population 3-partition 분류 (fork-agnostic 술어)

| class | 술어 | count |
|---|---|---|
| **A : resolvable** | exact-anchor(위 Q-B) 유일확정 1건 | **28** |
| **B : ambiguous** | 후보 ≥2 | **0** |
| **B : absent** | 매칭 package_session 자체 부재(check_in 상 0) | **34** |
| 합 | | **62** ✓ |

### A-resolvable = 28
- target package_session **전건 status='used'** · 미claim · check_in_id 일치 · type 일치 = 정확히 1건.
- 27 distinct 고객에 분산(허유희 2건, 나머지 1건씩) = 실환자. **clean fill-on-NULL 재-결선 대상.**

### B-ambiguous = 0
- 후보 ≥2 (동일 check_in 에 동종 미claim session 복수) 케이스 **없음**. auto-link 모호성 0.

### B-absent = 34 (★per-row §2-F · under≫over)
- **check_in 상 매칭 package_session 0건** — 회차 소진(draw-down) 행 자체가 미생성. (cand_all=0 전건).
- 2차 앵커도 실패: 동일 고객·동종 session 中 **check_in_id=NULL 0건 / 동일일자 0건 / (타 check_in claim 포함) any 2건뿐**. → 32/34 는 해당 고객에 **동종 회차 session 자체가 전무** = date-match 등 완화 앵커로도 구제 불가.
- **집중/오염**: 김민경(83ab4fe1) **17건** · 박민석 3건 · 나머지 1건씩(16 distinct 고객). **다수가 테스트/더미 고객**("총괄테스트중","서류테스트","서류테스트2","풋 서류 테스트 입니다","풋테스트1","풋테스트3","송지현2","엄경은2" 등). is_simulation=false 이나 명백 테스트명.
- **⟹ 34/62 = 55% = partition B material** → DA §Q1 "B 비중 material 시 현장확정 배치·라우팅 계획 동반"(재-CONSULT #5 = 운영·재판정 아님) 조건 충족. 단 상당수 테스트-데이터 → 재-결선이 아니라 **테스트데이터 정리/void 라우팅** 후보(per-row 판정 시 분기 필요).

---

## 수렴 / 게이트

- **census 완료 (READ-ONLY·prod write/DDL 0·정정 착수 0).** → planner FOLLOWUP 회신.
- **정정 스코프 예상**: Leg-A(재-결선) 단독. **A-28 = auto fill-on-NULL** / **B-absent 34 = per-row(§2-F, under≫over, 테스트데이터 분기)** / **B-ambiguous 0**.
- **Leg-B 불요**(Q-A: foot=prepaid-at-purchase, 선수금 방문별 원장 gap 부재·G4 by-construction clean).
- **잔여 pre-apply 게이트(본 census 스코프 밖 — DA §Q4/§Q5)**:
  1. **★Q5 forward-seal 판별(dispositive)** — 20260723 PKGSESSION-LINK-UNWIRED = seal(H1) vs 상처(H2). 시계열 07-24 최종(fix 추정 이후)·§0-2 소스닫힘 증명 필요. code-pin(chokepoint live 여부) + forensic(guard-live 후 신규 P-orphan=0) = **apply 전 별 게이트**(H2=상처면 forward re-wire FIRST·소급 BLOCK).
  2. planner spec 확정 → status blocked→approved → dev-foot apply NEW-TASK.
  3. supervisor DB-GATE dry-run + 물리 GO-token 선행 + POSTCHECK(불변식 P=0 on frozen 62 · 매출축 불변 · outbox/도파민 push 0 · rows==freeze N).
