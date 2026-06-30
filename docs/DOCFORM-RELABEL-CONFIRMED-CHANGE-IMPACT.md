# 서류 10종 → services 제증명 등재 relabel 확정본 + change_impact

- **티켓**: T-20260617-foot-DOCFORM-POPUP-OVERHAUL (Phase 2 가격/서류등재 슬라이스)
- **작성**: dev-foot · 2026-06-30
- **권위 근거**:
  - 가격(reporter) 게이트 = **RESOLVED_CONFIRMED** (김주연 총괄, responder MSG-20260630-095635-7oqz, slack ts 1782780811.291029) — 가격 mutate = **진료의뢰서 1행만 (0→3,000)**.
  - G2 가격 SSOT = data-architect GO (DA-20260629-foot-DOCFORM-PRICE-SSOT.md, MSG-20260629-231513-1uwa) — services 마스터 등재(category_label='제증명') + form_templates.service_id 브리지 + 진료기록사본 pricing_tiers JSONB.
- **본 문서 목적**: DA 'ADDITIVE→가격reconcile' **정식 재판정 CONSULT** 동반 자료. 라이브 catalog 실측 ↔ §6 확정스펙 대조 → relabel 매핑 확정 + change_impact(before/after) 명시. **DA GO 전 라이브 가격 미변경 hold(§S2.4).**

---

## 0. ★ 선행 사실 정정 (ticket frontmatter 불일치 2건)

1. **Migration A(구조 DDL, 005f8af0)는 commit만 되어 있고 라이브 DB에 미적용 상태였음** (form_templates.service_id / services.pricing_tiers / v_foot_form_master 부재 확인). → **2026-06-30 dev-foot가 적용 완료**(idempotent additive, 라이브 행 0 변경). 검증: ft_service_id=1, svc_tiers=1, v_foot_form_master view 29행(form_templates 행수 일치)·has_price_link 0(백필 전). supervisor DDL-diff 게이트 대상(autonomy §3.1 ADDITIVE).
2. **라이브 catalog drift = DA/planner 모델보다 더 큼.** catalog_reset 시드(8행) 가정과 달리, 라이브에는 **중복·레거시 행(C59000xx 계열) + inactive 행 + ★진료확인서 가격 분기**가 실재. 아래 §1 실측 참조.

---

## 1. 라이브 catalog 실측 (services, clinic 74967aea, 2026-06-30 조회)

### 1-A. 서류-관련 services 행 (active 우선, 가격 SSOT 후보)

| service_code | name | category_label | price | active | 비고 |
|---|---|---|---|---|---|
| C5900002 | 진단서 | 기본 | 20,000 | ✅ | §6 진단서 국문 2만 **일치** |
| 진단서(영문) | 진단서(영문) | 기본 | 30,000 | ✅ | §6 진단서 영문 3만 **일치** |
| C5900003 | 소견서 | 기본 | 20,000 | ✅ | §6 소견서 국문 1만과 **불일치** (중복 후보) |
| 진료소견서 | 진료소견서 | 기본 | 10,000 | ✅ | §6 소견서 국문 1만 **일치** (중복 후보) |
| 소견서(영문) | 소견서(영문) | 기본 | 30,000 | ✅ | §6 소견서 영문 2만과 **불일치** |
| C5900004 | 진료확인서 | 기본 | 3,000 | ✅ | ★3종 중 1 |
| 진료확인서1 | 진료확인서(코드,진단명 포함) | 기본 | **10,000** | ✅ | ★가격 분기 (코드포함) |
| 진료확인서2 | 진료확인서(코드,진단명 불포함) | 기본 | 3,000 | ✅ | ★가격 분기 (코드불포함) |
| 진료의뢰서 | 진료의뢰서 | 기본 | **0** | ✅ | §6 3,000 → **mutate 대상** |
| 통원확인서 | 통원확인서 | 기본 | 3,000 | ✅ | §6 3,000 **일치** (변경 불요) |
| 진료기록사본1 | 진료기록사본(1-5매) | 기본 | 1,000 | ✅ | 계단단가 short |
| 진료기록사본2 | 진료기록사본(6매 이상, 1매당) | 기본 | 100 | ✅ | 계단단가 long |
| C5900001 | 의무기록사본 | 기본 | 1,000 | ❌ inactive | 레거시 중복(진료기록사본과 동의) |
| C5900005 | 보험용진단서 | 기본 | 30,000 | ❌ inactive | 레거시(범위 외) |
| C5900006 | 상해진단서 | 기본 | 60,000 | ❌ inactive | 레거시(범위 외) |
| C5900007 | 사망진단서 | 기본 | 60,000 | ❌ inactive | 레거시(범위 외) |
| C5900008 | 후유장해진단서 | 기본 | 60,000 | ❌ inactive | 레거시(범위 외) |

> 영수증·세부내역서·KOH결과지·처방전 = **services 행 자체가 없음**(무료 서류 → 0원 제증명 행 신규 INSERT 필요).

### 1-B. form_templates (양식 정본, 29행 중 foot-service 제증명 후보)

| form_key | name_ko | 매핑 §6 서류 |
|---|---|---|
| bill_receipt | 진료비 계산서·영수증 | #1 진료비영수증 |
| bill_detail | 진료비내역서 | #2 진료비세부내역서 |
| koh_result | 검사결과 보고서 | #3 KOH균검사결과지 |
| diag_opinion / diag_opinion_v2 / opinion_doc | 소견서(3종) | #4 소견서 |
| diagnosis | 진단서 | #5 진단서 |
| treat_confirm | 진료확인서 | #6 진료확인서 |
| referral_letter | 진료의뢰서 | #7 진료의뢰서 |
| visit_confirm | 통원확인서 | #8 통원확인서 |
| medical_record_request | 의무기록사본발급신청서 | #9 진료기록사본 |
| rx_standard | 처방전(표준처방전) | #10 처방전 |
| payment_cert | 진료비 납입증명서 | (범위 외/무료) |

---

## 2. relabel 확정본 — 서류 10종 services 등재 매핑

> category_label='제증명' 통일. 가격 mutate = **진료의뢰서 1행만**. 소견서·진단서 = relabel-only(현 라이브가 보존, §11 의사영역). 무료 4종 = 0원 제증명 INSERT.

| # | §6 서류 | §6 가격 | 처리 유형 | 대상 services 행 | form_templates.service_id 브리지 | 가격 변경 |
|---|---|---|---|---|---|---|
| 1 | 진료비영수증 | 무료 | **INSERT** 0원 제증명 | (신규 service_code 예: `cert_bill_receipt`) | bill_receipt | 매출0 |
| 2 | 진료비세부내역서 | 무료 | **INSERT** 0원 제증명 | (신규 `cert_bill_detail`) | bill_detail | 매출0 |
| 3 | KOH균검사결과지 | 무료 | **INSERT** 0원 제증명 | (신규 `cert_koh_result`) | koh_result | 매출0 |
| 4 | 소견서(국문) | 1만 | **relabel-only** | 진료소견서(10,000) ※canonical 후보 | diag_opinion / opinion_doc | **불변**(의사영역) |
| 4e| 소견서(영문) | 영2만 | **relabel-only** | 소견서(영문)(30,000) | diag_opinion_v2(영문 variant) | **불변**(의사영역) |
| 5 | 진단서(국문) | 2만 | **relabel-only** | 진단서 C5900002(20,000) | diagnosis | **불변**(이미 2만, 의사영역) |
| 5e| 진단서(영문) | 영3만 | **relabel-only** | 진단서(영문)(30,000) | diagnosis(영문 variant) | **불변**(의사영역) |
| 6 | 진료확인서 | §6 3,000 | ★**HOLD — reporter 재게이트** | C5900004 / 진료확인서1 / 진료확인서2 (가격 분기) | treat_confirm | **결정 보류**(§3 참조) |
| 7 | 진료의뢰서 | 3,000 | **relabel + ✅MUTATE** | 진료의뢰서(0→**3,000**) | referral_letter | **0→3,000** ✅ |
| 8 | 통원확인서 | 3,000 | **relabel-only** | 통원확인서(3,000) | visit_confirm | 불변(이미 일치) |
| 9 | 진료기록사본 | 계단단가 | **relabel + pricing_tiers** | 진료기록사본1(1,000) canonical + tiers JSONB | medical_record_request | 매수산식 인코딩(flat price 불변) |
| 10| 처방전 | 무료 | **INSERT** 0원 제증명 | (신규 `cert_rx_standard`) | rx_standard | 매출0 |

### 2-A. 중복/레거시 행 처리 (가격 mutate 아님 — DA 판정 요청)
- **소견서 국문 중복**: `진료소견서`(10,000, §6일치) vs `소견서`C5900003(20,000). → canonical = `진료소견서`(§6 1만 일치)로 제안. C5900003은 relabel 제외 + (선택)deactivate. **가격 mutate 아님**(active 플래그만).
- **진료기록사본 중복**: `진료기록사본1/2`(active) + `의무기록사본`C5900001(inactive). canonical = 진료기록사본1 + pricing_tiers. 의무기록사본은 이미 inactive → 무처리.
- **레거시 진단서 4종**(보험용/상해/사망/후유장해, 전부 inactive·범위 외) → **무처리**(relabel 대상 아님).

---

## 3. ★ 진료확인서 가격 분기 발견 → reporter 재게이트 (planner FOLLOWUP)

§6 = 진료확인서 단일가 3,000원 전제. **그러나 라이브 catalog 실측 = 가격 분기 실재**:
- `진료확인서1`(코드,진단명 **포함**) = **10,000원** (active)
- `진료확인서2`(코드,진단명 **불포함**) = **3,000원** (active)
- `C5900004`(진료확인서) = 3,000원 (active)

→ **qb_determination_2026-06-30 근거1의 ★예외조건 충족** ("라이브 catalog에서 진료확인서 2행이 상이한 가격으로 실재하면 → Q-A형 reporter 가격 게이트 재트리거. §6 단일가 전제 깨질 때만"). code/nocode가 단순 HTML variant가 아니라 **가격 분기(10,000 vs 3,000)** 로 실재하므로, "code/nocode=가격분기 無, HTML variant 기술결정"이라는 planner 전제가 깨짐.

→ dev-foot는 본 1행(진료확인서)을 **Migration B에서 제외(HOLD)** 하고 planner에 FOLLOWUP 발행. reporter 결정 필요:
- (옵션 A) 진료확인서 = 단일 3,000원 SKU (코드포함분 10,000 폐지/통합) — §6 단일가 채택
- (옵션 B) 진료확인서 = 2 SKU 유지 (코드포함 10,000 / 코드불포함 3,000) — 가격 분기 정식화

나머지 9종은 본 CONSULT GO 시 Migration B 진행, 진료확인서만 reporter 결정 후 후속 슬라이스.

---

## 4. change_impact (before/after) — 매출 영향

| 항목 | before | after | 매출 영향 |
|---|---|---|---|
| **진료의뢰서** (referral_letter) | 0원 | **3,000원** | ✅ **유일 가격 mutate** (reporter confirm) |
| 소견서/진단서 (국·영 4행) | 현 라이브가 | **동일**(relabel-only) | 0 (의사영역, 가격 보존) |
| 통원확인서 | 3,000원 | 3,000원 | 0 (이미 일치) |
| 진료기록사본 | flat 1,000/100 | flat 불변 + pricing_tiers JSONB 인코딩 | 0 (산식 메타 추가, price 필드 불변) |
| 무료 4종 INSERT (영수증/세부내역서/KOH결과지/처방전) | 행 없음 | 0원 제증명 행 신규 | 0 (greenfield 0원) |
| category_label 기본→제증명 (전 서류 행) | '기본' | '제증명' | 0 (라벨 변경, name·price 불변 → UNIQUE(clinic_id,name) 무충돌) |
| form_templates.service_id 백필 | NULL | services.id 링크 | 0 (브리지 link) |
| **진료확인서** | (HOLD) | (HOLD) | reporter 결정 전 미변경 |

> **순 매출 mutate = 진료의뢰서 1행 (0→3,000) 단 1건.** 나머지 전부 relabel-only/greenfield/메타 = 매출 0.

---

## 5. DA 정식 재판정 질의 (CONSULT)

1. **Q1 — relabel 가격 UPDATE 재판정**: 본 변경의 유일 라이브 가격 mutate = 진료의뢰서 1행(0→3,000, reporter confirm). 나머지 relabel-only(category_label·service_id·pricing_tiers, 가격 불변). 이 범위가 **ADDITIVE 유지**인지, 아니면 1행 mutate 때문에 **가격reconcile(매출 split SSOT 접점)** 정식 처리가 필요한지 판정 요청. (DA INFO vrwx[B]: relabel 가격 UPDATE = ADDITIVE 초과 → 가격reconcile 정식 재판정 대상으로 명시한 바, 실측 mutate가 1행으로 축소된 상태에서 재확인.)
2. **Q2 — 중복/레거시 행 처리**: 소견서 국문 중복(진료소견서 10,000 vs 소견서 C5900003 20,000) canonical 선택 + 레거시 deactivate(active 플래그 변경)가 매출 롤업/SSOT에 영향 있는지. canonical = 진료소견서(§6 1만 일치) 제안.
3. **Q3 — 진료기록사본 pricing_tiers 인코딩**: `[{"min":1,"max":5,"unit":1000},{"min":6,"max":null,"unit":100}]` 단일 SKU(진료기록사본1) 인코딩 확정 + 진료기록사본2 행 deactivate 여부. 산식=app/Silver 강제(DB CHECK 아님, DA §Q2 계약).
4. **Q4 — 무료 4종 0원 제증명 service_code 네이밍**: cert_* 접두 신규 service_code 4건 INSERT(영수증/세부내역서/KOH결과지/처방전) 승인 — 순수 greenfield 0원, ADDITIVE.
5. **Q5 (FYI, reporter gate)**: 진료확인서 가격 분기(10,000 vs 3,000) 실재 → planner FOLLOWUP으로 reporter 재게이트 발행. 본 CONSULT 범위에서 **제외(HOLD)**. DA는 나머지 9종 기준 판정.

---

## 6. Migration B 초안 (★HOLD — DA GO 전 미적용, 진료확인서 제외)

> 실제 SQL은 `supabase/migrations/20260630_DRAFT_HOLD_form_service_backfill_migration_b.sql.txt` (`.txt` 확장 = 마이그 러너 비대상, 적용 차단). DA GO + reporter(진료확인서) 후 정식 `.sql`로 승격.
