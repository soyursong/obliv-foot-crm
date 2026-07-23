# T-20260723-foot-INSCONSULT-WRITEPATH-FKLINK-FOLD — STEP 0 read-only 스코핑 evidence (dev-foot)

**타입**: read-only 스코핑 (db_change=false, DDL/DML 0건, deploy-ready 미마킹). 방향·정정 실행은 DA ratify 후 별건.
**probes**: `_B1probe.mjs`(grade phantom), `_B3probe.mjs`(service 메타), 부모 `..._HIRACAT-NULL_probe.mjs`(계승). prod rxlomoozakkjesdqjtvd, 2026-07-23, SELECT only.
**근거 계승**: 부모 HIRACAT-NULL findings + DA CONSULT-REPLY(MSG-20260723-191750-ks16) verdict=live 매출 오류 아님(권위 grain clean).

---

## B1 — grade-null 공단 phantom 실측 → **phantom 아님 (live 리스크 없음)**

**실측(b1_1/b1_2)**: covered service_charges **11행 전부 `customer_grade_at_charge='general'`** (unverified/NULL 0건). 6방문 고객 현재 `insurance_grade` 도 전원 `general`(b1_3). 공단합 95,940 = 확정 general 30%/70% split 의 정합 산출 — phantom 아님.
  - 2행 공단=0 (base=copay, rate=1.000) = "초진진찰료(hira_score NULL)" general 분기(calc_copayment L89-92: general+hira_score NULL → full copay, 공단 0). 정합.
  - 9행 공단>0 = general 30% 정률(rate 0.300). §2-2-4 판정2 위반 아님.

**판정**: grade 확정(general) → **정합. P1 격상 불요.** DA "live 매출 오류 아님" verdict 과 일치.

**⚠ 잔존 latent 위험(going-forward, live 아님)**: 전체 고객 447/650 = grade-NULL(b1_4). calc_copayment v1.6 는 grade NULL→`unverified`→ELSE 30% 분기로 **공단(base−copay ≈70%)을 data_incomplete=false 로 반환**. `snapshotCoveredServiceCharges` 폴백(PMW L1887-1901)은 이 값을 **zeroing 없이 그대로 INSERT** — 원자 RPC W5(`v_grade_confirmed ELSE 0`) 와 달리 grade-null 방어 없음.
  → 오늘까지는 covered 체크아웃 도달 고객이 전원 general(데스크/셀프체크인 grade capture)이라 **미실현**. 그러나 grade-NULL 고객이 covered 체크아웃 시 **phantom 공단 확정 적재** 가능. **어느 방향을 택하든 폴백에 W5 zeroing 이식 = going-forward 하드닝 대상**(B3 fold 시 동반).

---

## B2 — 수납수단별 급여 열 live 렌더 여부 → **렌더되나 payments-FK 미배선 (live 오류 없음)**

SalesDailyTab 우측 "수납 수단별 집계" 매트릭스에 **'급여' 열 존재(렌더 중)** (TAX_COLS `['과세','면세','급여','선수금']`, L45).
그러나 급여 열 소스 = `taxTypeToCol(payments.tax_type)` (L61-67) → `tax_type==='급여'` 인 payment 만 급여 열 적재. **payments.service_charge_id FK 는 읽지 않음.**
- write-path canonical(mig 20260715160000 W2)은 `tax_type='급여'` 를 **절대 기록 안 함**(급여 귀속=FK 축, tax_type 아님). 부모 probe q4: `tax_type='급여'` payment **0건**.
- → 급여 열은 **항상 0/'—'** 렌더. 코드 주석도 명시: "우측 급여 열(Stage B, C4)은 현재 payments.tax_type='급여'(=0건) → 오늘 표시/대사 무변화" (L338).
- 좌측 "발생 기준" 급여 3값(급여총액/본부금/공단청구액)은 **service_charges(명세 grain)** 에서 산출(L182-198, 251-256) → 폴백이 명세를 적재하므로 **순매출 유실 0**(DA verdict 계승).

**판정**: 급여 열은 **미배선(dead tax_type 축, 급여 0건 시대 잔존)** → **live 과소/오귀속 없음. 본 티켓 우선순위 상향 불요(P2 유지).** going-forward 봉합만.

---

## B3 — Direction A/B 영향범위 스코핑

### 현 write-path 아키텍처 (PMW executeAutoDone, L1940-2086)
1. **원자 경로**: 필터 `is_insurance_covered===true && hira_category==='consultation'` + `splits.length===1` + `비선수금`(L1955-1962) → 각 서비스 `record_insurance_consult_payment` RPC → service_charge(engine=`consult_writepath_v1`) + **copay payment(FK 링크, tax_type NULL) 원자·멱등 생성**. copay 만큼 plain split 차감(L1990-1993).
2. **폴백**: `snapshotCoveredServiceCharges`(L1846-1907, best-effort post-commit) → covered 전체(hira_category 무관) service_charge(engine=`pmw_checkout_snapshot_v1`) 생성. **payment/FK 미생성**(charge-only).
→ 활성 covered 5종 전부 hira_category=NULL(아래) → **원자 경로 항상 미발화**, 폴백만 흐름. copay 는 plain payment(FK NULL)에 흡수, 명세만 폴백 적재.

### hira_category 분류 접지 (b3_svc 실측 — DA 확정 대상, dev 추정 아님)
| service_code | name | category(현 컬럼) | hira_category | hira_score | active | 잠정 분류(티켓) |
|---|---|---|---|---|---|---|
| AA154 | 초진진찰료-의원 | 기본 | **NULL** | 197.07 | ✅ | consultation |
| AA254 | 재진진찰료-의원 | 기본 | **NULL** | 139.85 | ✅ | consultation |
| AA222 | 재진-물리치료,주사 등 시술받은 경우 | 기본 | **NULL** | 49.09 | ✅ | consultation(재진계열) |
| M0111 | 단순처치 [1일] | 기본 | **NULL** | 75.51 | ✅ | procedure |
| D620300HZ | 일반진균검사-KOH도말-조갑조직 | 검사 | **NULL** | 110.20 | ✅ | examination |
| (NULL) | 진찰료(초진)/KOH균검사/일반처방료 | 진료/검사/처방 | consultation/examination/prescription | — | ❌(price=0 레거시 seed) | — |

→ hira_category 세팅된 3행은 전부 **active=false·service_code=NULL·price=0 레거시** → 원자 필터 매칭 불가. 활성 5종은 전부 NULL.

### Direction A (권장) — FK-링크 copay payment(W3)을 `is_insurance_covered` 전체 적용
- **(a1) 원자 트리거 필터 확장** `hira_category==='consultation'` → `is_insurance_covered` (PMW L1955-1962, 1개 predicate 삭제).
  - RPC 가드는 이미 `is_insurance_covered` 만 검사(mig L104-106) → RPC 무변경. 폴백 `already` set 은 check_in_id 기준(engine 무관, L1857-1862) → 원자 선행 시 폴백 자동 skip(중복 0).
  - **영향범위**: 단일수단·비선수금 covered 체크아웃의 5종 전부 원자 경로 → FK payment 생성. grade-null 은 RPC **W5 zeroing 자동 적용(phantom-safe, B1 잔존위험 동시 해소)**.
  - **안전성**: 최소 델타(1 predicate). 기존 원자·멱등·advisory-lock RPC 재사용. 폴백은 split/선수금 경로 안전망으로 잔존.
  - **bonus**: 트리거가 hira_category 를 안 봄 → **hira_category seed(Direction B) 불요**, mutable services 데이터 변경·DA 분류 의존 제거.
  - **잔존 gap**: split(splits.length>1)·선수금 혼합 경로는 여전히 원자 미발화 → 폴백(FK 無). 이는 **부모 C4(1:N payment↔charge 배분) deferred** 와 동일 스코프.
- **(a2) FK payment 생성을 폴백에 fold**.
  - 폴백은 post-commit·best-effort·never-throw·charge-only. 여기서 payment 생성 시: (i) plain split 에 이미 copay 포함 → **이중계상 위험**(relink/차감 필요), (ii) payment insert 와 비원자(부분쓰기 위험), (iii) 폴백은 W5 zeroing 부재 → **W5 이식 동반 필수**.
  - **장점**: split/선수금 포함 전 경로 커버(폴백 universal). **단점**: 머니-grain correctness 를 best-effort 경로에 얹는 구조적 미스매치 → a1 대비 위험 큼.

### Direction B (비권장) — 진찰료 3건만 hira_category='consultation' seed
- AA154/AA254/AA222 seed → 원자 발화. 그러나 **M0111(procedure)·D620300HZ(examination)는 여전히 폴백(FK 無)** = 부분 봉합. + mutable `services.hira_category` 데이터 변경(DA 분류 확정 선행) + 검사/처치에 'consultation' 강제는 의미 오염. a1 이 이 데이터 변경을 아예 불요화하므로 열위.

### dev-foot 엔지니어링 권고 (방향 확정은 DA)
**Direction A / (a1)** — 트리거 predicate 1개 확장이 최소·최안전 델타. 이미 원자+멱등+grade-safe(W5)인 RPC 재사용, 폴백에 머니-mutation 얹지 않음, hira_category seed·분류 의존 제거. split/선수금 잔여 gap 은 부모 C4 deferred 와 동일. **어느 방향이든 폴백 W5 zeroing 이식은 B1 latent phantom 하드닝으로 동반 권고.**

---

## 게이트/스코프
- 본 STEP = read-only 종료(db_change=false, deploy-ready 미마킹). 방향/정정 실행 = B1~B3 회신 → DA ratify → 별건 게이트(a1 ADDITIVE 예상 → §3.1 면제 후보).
- 트랙 분리 준수: HIRA-COPAY-BASE-GRAIN-RECONCILE(B5) / INSGRADE-NULL-BACKFILL 과 conflate 안 함.
- 과거 6방문 FK-링크 백필 = deferred(SALESDAILY C4), 본 티켓 미실행.
