# T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX — census 결과 + preserve-reinsert 설계

> status = **blocked/dependency** (DA CONSULT GO 前 코드 착수 보류). 본 문서 = READ-ONLY census 수치 +
> preserve-reinsert 설계안 + DA CONSULT 질의 근거. **prod DML·DDL 0 / FE 코드 변경 0.**
> planner MSG-20260805-034317-nm7x 트리아지 지시 이행. 기준 커밋 = fa0631cb (현행 prod main HEAD).

---

## 1. census 결과 (prod, _ctx=service_role via Management API /database/query, READ-ONLY)

실행: `scripts/T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX_census.mjs`
원시결과: `docs/T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX_census_result.json`
인증컨텍스트 = postgres role(RLS 우회) — anon 0-row 오독 위험 배제(Cross-CRM 진단 인증컨텍스트 표준 준수).

### §1 재저장 지문 (delete-all→reinsert)
| 지표 | 값 |
|------|----|
| resave_after_payment_checkins (결제 후 재저장 지문) | **34** |
| homogeneous_ct_checkins (단일 트랜잭션 지문) | 163 |
| total_paid_checkins_with_cis | 163 |

→ 163 결제 check_in 전건이 homogeneous cis created_at(재저장 지문), 그 중 **34건이 결제 이후 재저장** 발생.

### §2 결제-라인 unlink (payment_items witness)
| 지표 | 값 |
|------|----|
| unlink_checkins | 0 |
| unlink_customers | 0 |
| unlink_cosmetic_amount | 0 |
| **no_pi_witness_checkins** | **163** |

→ **witness(payment_items) 사실상 부재** — payment_items 총 3행/화장품 0행(probe D). 163건 전부 witness 없음.
§2 강한-증거 경로는 **구조적으로 측정 불가**(과대·과소 아님, witness 소스 자체가 비어있음). 이것이 소급 backfill
의 핵심 제약 → **소급 backfill 은 복원 소스가 없다**(payment_items 스냅샷 부재). forward-seal 우선 정당성 강화.

### §3 화장품 cis vs payment_items 월별 정합
| month | cis_lines | pi_lines | lines_delta | amount_delta |
|-------|-----------|----------|-------------|--------------|
| 2026-06 | 7 | 0 | −7 | −277,000 |
| 2026-07 | 24 | 1 | −23 | −923,000 |
| 2026-08 | 8 | 0 | −8 | −214,000 |

→ delta 전부 **음수**(pi < cis). 이는 "cis wipe"(delta>0)가 아니라 payment_items 미채움을 반영. §3 은 witness 부재
로 소멸분 정량화 불가. **현행 생존 화장품 cis** = 6월 7 / 7월 24 / 8월 8 라인(합계 39라인, 약 1.41M).

### §4 + probe: forward-risk (다음 재저장 시 silent-drop 예정 라인)
| 벡터 | 라인 | 비고 |
|------|------|------|
| null_service_id_lines (벡터 B) | **2** | service_id NULL → svcs.find 매칭 불가 |
| inactive_service_lines (벡터 A) | **38** | active=false service 지시 → 로드쿼리 `.eq('active',true)` 제외 |
| missing_service_lines | 0 | 하드삭제 service 지시 없음 |
| inactive_cosmetic_lines | **0** | 현재 forward-risk 라인 중 풋화장품 카테고리 0 |

**forward-risk 총 surface = 40 cis 라인 / 23 check_in**, 카테고리 분해:
상병 16 · 풋케어 13 · 기본 5 · 수액 2 · 처방약 2 · NULL service_id 2.
그 중 **alive-payment 동반 = 9 check_in** (재저장 시 실제 unlink 실현 대상).

> ★핵심 재해석: silent-drop 메커니즘은 **카테고리 무관**(화장품 국한 아님). 현재 화장품 forward-risk 는 0이나
> 상병·풋케어 등 40라인이 동일 메커니즘으로 소멸 예정. → preserve-reinsert fix 는 화장품보다 넓은 surface 보호.

### §5/probe A soft-void 컬럼 실재
`check_in_services.voided_at` 컬럼 = **부재(count 0)** → 소프트보이드 mig 20260805110000(commit 9326fb7c)
**prod 미적용 확정(apply HELD)**. → CONSULT Q2 시퀀싱 판정 live.

---

## 2. 근본원인 (DIAG 확정 재확인)

`saveCheckInServices()` (PaymentMiniWindow.tsx L2110~) 의 **DELETE-all→reinsert** 에서 reinsert 소스인
`selectedItems` 가 PMW 오픈 시 (L1287 `svcs.find(s => s.id===ci.service_id)`) **활성 서비스 매칭분만** 재구성
하고 매칭 실패분(비활성/NULL service_id)을 `else` 없이 silent drop. → 재저장이 그 라인을 영구 소멸. payments 는
별 grain(cis DELETE 무영향)이라 alive 잔존 → **결제-라인 unlink**.

기존 선례: 같은 함수가 이미 `package_session_id`(C3, L2116~), examFlags(Surface B, L2141) 를 **snapshot→
reinsert 재적용** 패턴으로 보존 중. preserve-reinsert 는 **동일 패턴을 orphan 라인 + void 컬럼으로 확장**.

---

## 3. preserve-reinsert 설계안 (DA GO 前 미착수)

### 3.1 통합 snapshot-partition (단일 save 트랜잭션 내)
`saveCheckInServices()` 에서 DELETE 직전 cis full-snapshot(현행은 package_session_id·examFlags 부분 스냅샷만).
snapshot 을 3 버킷으로 partition:

| 버킷 | 술어 | 재삽입 처리 |
|------|------|-------------|
| **B1 live 매칭** | service_id ∈ 활성 svcs | 기존 경로(selectedItems→rows). 변경 없음. |
| **B2 orphan(비활성/NULL/missing)** | svcs.find 실패 & voided_at IS NULL | ⚠️신규: 스냅샷 원본(service_id·service_name·price·original_price·seller_staff_id) **그대로 preserve-reinsert** (live 라인으로 복원). selectedItems 에는 미노출(UI 편집 대상 아님). |
| **B3 voided** | voided_at IS NOT NULL | ⚠️신규(soft-void 랜딩 후): void 컬럼(voided_at/reason/by) 동반 **preserve-reinsert** — 감사행 생존, live 집계 제외. selectedItems live-set 에서 배제(부활 금지). |

### 3.2 멱등 (CONSULT Q1 대상)
- orphan 식별 술어 = **오픈시 재구성 drop 술어의 정확한 역**(`svcs.find(s.id===ci.service_id)` 실패). 재구성이
  버린 라인 = save 시 preserve 대상 → 대칭.
- orphan 라인은 UI 에 노출된 적 없음 → 사용자 편집 불가 → 스냅샷 원본 그대로가 항상 정답.
- 이미 1회 재저장된 check_in(orphan 이미 소멸)은 재-실행 시 snapshot 에 orphan 0 → preserve 대상 0 → **멱등**.
- service_id NULL·중복 service_name → business-key 부재. 멱등은 **단일 트랜잭션 내 snapshot-then-partition
  (물리 cis 행 기준)** 으로 확보. cross-transaction 재실행도 위 항으로 무중복.
- ⚠️ DELETE→reinsert 는 현행도 **새 PK 발번**(active 라인 포함). orphan 도 동일하게 new PK. → cis.id 참조
  다운스트림 존재 여부가 DA 확인 포인트(현재 grep 상 payment_items→services.id 참조, cis.id FK 미발견).

### 3.3 change-class 예비판정
- 신규 컬럼·테이블·enum **0**. 기존 컬럼 보존 로직 확장(select 에 service_name·voided_at 추가 + reinsert
  재적용). → **ADDITIVE 후보**(§3.1 대표게이트 면제 가능성). 단 soft-void 컬럼 의존 → 시퀀싱이 관건(Q2).
- write 경로(cis insert row shape) 변경 → §S2.4 DA CONSULT 게이트 대상 → 본 CONSULT.

---

## 4. DA CONSULT 질의 (planner 지정 2항)

**Q1 (멱등키)**: orphan(비활성/NULL service_id) 라인을 §3.2 snapshot-partition(물리 cis 행, drop술어 역)으로
식별·보존하는 방식이 재삽입 중복/유령을 방지하는가. (i) new-PK 재삽입이 cis.id 참조 다운스트림을 깨는가,
(ii) NULL service_id·중복 service_name 라인의 멱등 보장이 물리-스냅샷 기준으로 충분한가.

**Q2 (soft-void 정합·시퀀싱)**: (a) soft-void mig(20260805110000, ADDITIVE, 현재 HELD) prod 랜딩 **선행**
후 preserve-reinsert 설계 / (b) delete-all→reinsert 를 `voided_at IS NULL` live + `voided_at IS NOT NULL`
audit-preserve 로 **공동설계**. dev-foot 코드컨텍스트 leaning = **(b) 공동설계 + 시퀀싱: soft-void DDL 선행
→ preserve-reinsert FE 후행**(B3 버킷이 voided_at 컬럼을 read/preserve 해야 하므로 컬럼 실재 필수. 컬럼 부재
상태 FE ship 시 PostgREST "column does not exist"). 최종 판정 = DA.

> ★정합 필수: soft-void 가 추가할 감사행(voided_at NOT NULL)을 현행 delete-all→reinsert 가 hard-wipe 하면
> void 감사·정정이 소실 + service_id 매칭 시 부활(un-void→phantom 재출현). 두 변경은 반드시 공동정합.
