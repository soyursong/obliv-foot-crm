# T-20260723-foot-INSCONSULT-WRITEPATH-FKLINK-FOLD — STEP 0 read-only 스코핑 (dev-foot)

**타입**: task STEP 0 (db_change=false, read-only). DA CONSULT-REPLY(MSG-20260723-191750-ks16) B1/B2/B3 회신.
**probe**: `scripts/T-20260723-foot-INSCONSULT-WRITEPATH-FKLINK-FOLD_B1B2_probe.mjs` (SELECT only, prod rxlomoozakkjesdqjtvd, 2026-07-23)
**연속**: 부모 진단 evidence `..._HIRACAT-NULL_probe.mjs` / `..._HIRACAT-NULL_findings.md` (commit 88e61f70)

---

## B1 — grade-null 공단 phantom 체크 (§2-2-4 판정2) → **위반 없음 (clean). live 리스크 아님.**

covered service_charges **11행 전수** 실측:

| 지표 | 값 |
|---|---|
| covered charges | 11 |
| grade=NULL charges | **0** |
| grade=NULL AND 공단>0 (phantom 후보) | **0** |
| grade=NULL AND rate=NULL | **0** |
| distinct grades | 1 (`general`) |
| rates seen | `0.300`, `1.000` |

- **모든 급여 명세가 `customer_grade_at_charge='general'` + rate 확정(0.300 또는 1.000)으로 적재**. grade=NULL 행 0건 → §2-2-4 판정2(grade=NULL인데 공단 70% 확정 적재) **위반 후보 0건**.
- rate=0.300 행: copay_pct 29.4~29.7% / gongdan_pct 70.3~70.6% = **클린 30/70 급여**(원 단위 반올림). rate=1.000 행(방문 ac0c2f1d): copay 100% / 공단 0 = 전액 본인부담.
- **parent PMW 리포트 "copay/base=42%"의 정체**: 한 방문 내 rate=0.300 명세 + rate=1.000 명세가 섞여 산출된 **blended 비율**이지 phantom/정액이 아님. 방문별 명세는 전부 rate별로 정합.
- **"grade=null 라이브 89%"(parent) 와의 관계**: 그 89%는 `customers` 테이블 grade 분포이고, 본 축은 **charge-time 스냅샷(`customer_grade_at_charge`)** 이다. 스냅샷은 charge 시점에 grade를 resolve(→'general' default)하고, `calc_copayment.data_incomplete=true`(자격/수가 미비) 행은 write에서 **skip**(PMW L1886, 금액 날조 금지) → 스냅샷 grain에 grade=NULL 유입 경로가 구조적으로 없음. **B1 phantom 공단 리스크 clear.**
- ⚠ 단서(B1 스코프 밖·별건): grade가 'general'로 **default resolve** 되는 것 자체의 정확성(고객 실제 자격이 다를 경우 소급 clawback) = INSGRADE-NULL-BACKFILL 트랙(B5 인접) 소관. 본 B1(grade=NULL→phantom)과는 별개 축, conflate 금지.

**→ B1 회신: phantom 공단 없음. FKLINK-FOLD 우선순위 상향 불요 / 에스컬레이션 불요.**

---

## B2 — 수납수단별 급여 열 live 렌더·소스 → **렌더되나 소스 실적 0건 → live 과소/오귀속 표시 오류 없음.**

`SalesDailyTab.tsx` 실측 대조:

- 급여 열은 우측 매트릭스에 **렌더된다**(`TAX_COLS=['과세','면세','급여','선수금']`, 각 method row에 급여 버킷 존재).
- **소스 = `taxTypeToCol(p.tax_type)` (L306) = `payments.tax_type='급여'`** — DA가 상정한 payments-FK(service_charge_id 링크) 축이 **아님**. 실제 구현은 tax_type 기반 집계.
- prod 실적(probe b2_1/b2_2):
  - `tax_type='급여'` payments = **0건** (분포: NULL 167건/13,036,160원, 선수금 21건/237,120원).
  - `service_charge_id` FK-링크 payment = **0건** (FK→covered charge 0건, 합계 0원).
- 결과: **급여 열 전 method 0 표시**. 게다가 좌우 대사(AC-2, L339)는 `rightCashTotal = totalRight − rightColTotals['급여']`로 **급여 열을 대사에서 제외** → 표시·대사 어느 쪽도 급여 열 실적 0에 영향받지 않음.

**→ B2 회신: 급여 열은 렌더되지만 소스(tax_type='급여')·FK축 모두 실적 0건 → 현재 live 과소/오귀속으로 인한 화면 오류 없음. going-forward 봉합만 필요(우선순위 상향 불요). ★DA 상정("payments-FK 읽기 중")과 실제 구현(tax_type 읽기)의 gap 존재 — 봉합 방향 확정 시 반영 요망.**

---

## B3 — Direction A/B 영향범위 스코핑 (read-only) → **A-a2(폴백 fold) 권장.**

### 현 write-path 이중 구조 (PaymentMiniWindow.tsx)

| | 원자 write-path | snapshot 폴백 |
|---|---|---|
| 함수 | `record_insurance_consult_payment` RPC | `snapshotCoveredServiceCharges` (L1846) |
| 발화 필터 | `is_insurance_covered && hira_category==='consultation'` (L1957-1958) | `is_insurance_covered` (L1852), hira_category 무관 |
| service_charges | 생성 | 생성 (idempotent: service_id 기존행 skip, L1862/1865) |
| payment | copay payment **생성 + FK 링크** + lump에서 copay 차감(L1991) | **미생성**(charge-only, L1842) — copay는 lump splits[0]에 흡수 |
| prod 상태 | **dead(0회 발화)** — 활성 consultation 서비스 0 | **활성**(11행 전부 이 경로) |

### Direction A-a1 (트리거 확장: 필터를 `is_insurance_covered`로)
- **코드 변경 작음**(필터 한 줄 flip) 그러나 **이중경로 재활성 = double-write 위험 도입**. 두 경로가 동일 조건(`is_insurance_covered`)으로 동시 발화 → service_charges 이중 생성 리스크. 폴백 idempotency(service_id Set skip)와 **실행 순서**에 의존(원자 RPC가 폴백보다 먼저 성공해야 폴백이 skip). 순서 보장·경합 검증 부담이 영구 잔존.
- 원자 RPC가 "진찰료 전용"으로 설계됨 → 처치(M0111)·검사(D620300HZ) svc에서 `calc_copayment` 정상 동작하나(범용 RPC라 OK 예상), RPC 내부 가정(단일 진찰 svc)·멱등키 재검증 필요.

### Direction A-a2 (폴백 fold: snapshot에 FK-링크 copay payment 생성 추가) — **권장**
- **단일 경로로 수렴**: dead 원자 경로를 은퇴시키고 폴백 하나만 유지 → 이중경로 double-write 경합 **원천 제거**.
- 폴백이 이미 올바른 조건(`is_insurance_covered`)·전 급여셋(진찰+처치+검사)에서 발화 중 → **FK-링크 copay payment 생성 + lump에서 copay 차감(원자 경로 L1991 로직 이식)** 만 추가하면 payments-FK 축 정합.
- 변경 surface는 A-a1보다 크나(폴백이 charge-only→payment 생성으로 확장 + effectiveSplits carve-out 로직 이식), **end-state가 단일 write path로 깨끗**하고 race 없음.
- ⚠ 반드시 함께: FK payment 생성 시 **lump splits[0]에서 copay 차감**(안 하면 copay 이중계상 — FK payment + lump 양쪽). 원자 경로 L1990-1993이 이미 이 패턴 → 그대로 이식.
- 멱등: 폴백은 이미 service_id 기존행 skip(L1862) → FK payment도 동일 멱등키(service_charge_id 존재 시 skip)로 재시도·더블클릭 방어.

### Direction B (data-only, hira_category seed) — 비권장 (DA 확정)
- 필터가 `hira_category==='consultation'` **단일값 매칭** → 진찰 3건만 부활, 처치/검사는 여전히 폴백. gap 부분해소.

**→ B3 회신: A-a2(폴백 fold) 권장 — 단일 write-path 수렴으로 이중경로 double-write 위험 없이 payments-FK 축 봉합. copay lump 차감 동반 필수. Direction 최종 확정은 DA ratify 대기.**

---

## hira_category HIRA 분류 접지 (dev-foot 확정, DA §2-2-2 등재용)

prod 활성 급여서비스 5건 실 명칭 기반 확정:

| service_code | name | hira_category (확정) |
|---|---|---|
| AA154 | 초진진찰료-의원 | `consultation` |
| AA254 | 재진진찰료-의원 | `consultation` |
| AA222 | 재진-물리치료,주사 등 시술받은 경우 | `consultation` (재진진찰료 계열 visit-fee) |
| M0111 | 단순처치 [1일] | `procedure` |
| D620300HZ | 일반진균검사-KOH도말-조갑조직 | `examination` |

- 기존 categorized 행(consultation/examination/prescription)은 전부 `active=false`·`service_code=NULL` legacy seed.
- **주의**: Direction A-a2 채택 시 write-path 필터는 `is_insurance_covered`로 hira_category와 무관해짐 → hira_category seed는 **write-path 발화 목적이 아니라 enum canonical·집계 라벨링·규제 접지 목적**으로만 유효. (Direction A-a1/B 채택 시에만 필터 발화에 직접 관여.)

---

## 종합 회신 요약 (planner + DA)

- **B1**: phantom 공단 **없음**(grade=NULL 0건, 전행 general+rate확정). live 리스크 아님, 우선순위 상향 불요.
- **B2**: 급여 열 렌더되나 소스(tax_type='급여')·FK축 실적 **0건** → live 화면 오류 없음. going-forward 봉합만. (DA 상정 payments-FK vs 실제 tax_type 소스 gap 플래그.)
- **B3**: **A-a2(폴백 fold) 권장** — 단일 write-path, double-write race 제거, copay lump 차감 동반. DA ratify 후 STEP 2 정정 실행.
- **hira_category**: AA154/AA254/AA222=consultation / M0111=procedure / D620300HZ=examination 확정.
- **스코프 유지**: 백필 deferred / base 1원 divergence(COPAY-BASE-GRAIN) 별개 축 / cross-CRM sweep(B4) forward item / grade default-resolve 정확성(INSGRADE-NULL-BACKFILL) 별개 축.
- **배포 코드 0** (read-only 스코핑) → deploy-ready 미마킹 유지. db_change=false 유지.
