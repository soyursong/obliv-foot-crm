# T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY — 진단 evidence (READ-ONLY)

- 실행: `node scripts/T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY_diag.mjs` (SELECT only, **prod write 0 / DDL 0 / 배포 0**)
- DB: obliv-foot-crm PROD (rxlomoozakkjesdqjtvd) · service_role read-only
- 재진단 계기: **FIX-REQUEST MSG-20260808-214354-pce0** (QA NO-GO Red, insufficient_verification). 커밋 39994045 진단에서 Item C 누락 + Item A payments 미조회(잘못된 테이블 조회로 false-negative) 지적.
- 본 라운드 보강: (1) **payments 테이블 실쿼리** + 실제 결과 전량 첨부, (2) **Item C(김병완) 진단 신규 수행**, (3) **SalesStaffTab 집계 소스 코드 확인**, (4) 1차 재진단(fb84f0fd)의 R2/R3b **broken-query 버그(false-negative) 수정**.

---

## 0. 스키마 실측 — payments 귀속축 (모든 결론의 전제)
`payments` select('*') 실측 결과, 다음 컬럼이 **존재하지 않음**:
- `seller_staff_id` ❌ · `pg_provider` ❌ · `paid_at` ❌

→ **payments 테이블에는 seller(판매자) 귀속 컬럼 자체가 없다.** payment 의 실 귀속축은 `payments.check_in_id → check_ins.therapist_id`.
> ⚠ 1차 재진단(fb84f0fd)의 R2/R3b 가 `select('id,...,seller_staff_id,pg_provider,paid_at,...')` 로 조회 → PostgREST 42703(column not exist) 에러 → data=null → **false-negative `[]`** 를 산출했다(에러 미로깅). 본 라운드에서 `select('*')`/유효컬럼 + 에러 명시로깅으로 수정, 실제로는 레코드가 전부 존재함을 확인.

## 0b. SalesStaffTab 집계 소스 (코드 확인 — src/components/sales/SalesStaffTab.tsx)
| 컬럼 | 소스 테이블 | 버킷/필터 | pg_provider·external 필터 |
|------|------------|-----------|--------------------------|
| **화장품 매출** | `check_in_services` (L406~424) | 버킷=COALESCE(`seller_staff_id`,`check_ins.therapist_id`), service_id∈풋화장품, `voided_at IS NULL`, `price>0`, 기간=checked_in_at | **없음** (payments 미조회) |
| 치료(수납) 매출 | `payments` (L281~291) | 기간=accounting_date, `status≠deleted`, is_simulation 제외 | **없음** (컬럼 부재) |

→ **화장품 집계는 payments 를 전혀 읽지 않고 `check_in_services` 만 읽는다.** 따라서 cis 판매라인이 없는 **payment-only 화장품 결제**는 화장품 칸에 **구조적으로 미표시**. 그리고 두 경로 어디에도 external/manual `pg_provider` 제외 필터가 없다 → **"external/manual 제외 필터버그" 가설 = 명백히 거짓.**

---

## A. 현은호 (F-4717, customer 6412fbf7-8a53-4d49-af7a-491e1d731b4c)

### A-1) 지정 payment 2e8f7aa5 실쿼리 (al93 fold 대상) — **실재 확인**
```
id=2e8f7aa5-3e83-4d4a-8900-ab1f0048694a
amount=15,000 · method=card · payment_type=payment · status=active
check_in_id=c33dfc76(=7/28 재진, therapist=김규리 3a0c6774)
accounting_date=2026-08-06 · package_id=NULL · external/manual(pg 미결속)
memo="케어토어밴드 15,000 카드 — 결제 누락 사후기록. T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD …"
```
- **현재 귀속값(실 귀속축=check_in.therapist_id)** = **3a0c6774 김규리** (payments 에 seller 컬럼 없음).
- 즉 이 결제는 **김규리 check_in 에 결속** → 치료(수납) 매출 집계에는 김규리로 잡힘(accounting_date 8/6).

### A-2) 미표시 원인 분기 (FIX-REQUEST 2-(b))
- **(i) 귀속-NULL? → 아니오.** payment 는 김규리 check_in 에 결속(귀속 존재). NULL 아님.
- **(ii) SalesStaffTab 이 external/manual 을 제외하는 필터버그? → 아니오.** §0b 코드확인 — 화장품 칸은 payments 를 안 읽고, payments 경로에도 pg_provider 필터 없음.
- **실제 원인 = 소스-테이블 불일치(제3원인).** CTB 15,000 은 `payments` 직접 INSERT(payment-only)로만 존재하고 **대응하는 `check_in_services` 풋화장품 라인이 없다**(아래 A-3). 화장품 칸은 cis 만 읽으므로 미표시. (1차 "화장품 0건" 결론은 *화장품 칸 소스=cis* 사실과 정합하나 payment 실재 확인이 빠져 불완전 → 본 라운드 보강.)

### A-3) 현은호 check_in_services 화장품 라인 = **0건**
- 전체 서비스라인 26건 중 풋화장품 라인 0. → CTB 15,000 의 **cis 판매라인 부재**(payment-only).

### A-4) 현은호 payments 전량 (참고, 귀속축 병기)
| payment_id(선두8) | amount | type | acct_date | check_in→therapist | 김규리? |
|---|---|---|---|---|---|
| 2e8f7aa5 | 15,000 | payment | 08-06 | c33dfc76→김규리 | ✅ |
| 8bf6ac26 | 5,760,000 | payment | 07-28 | c33dfc76→김규리 | ✅ |
| 748ea872 | 240,000 | payment | 07-28 | c33dfc76→김규리 | ✅ |
| ee440850 | 240,000 | refund | 07-28 | c33dfc76→김규리 | ✅ |
| a0572a5b | 1,400 | payment | 07-28 | c33dfc76→김규리 | ✅ |
| 6f9de7ef | 1,400 | payment | 08-05 | 526e0aa8→윤시하 | ❌ |
| b695bea6 | 8,800 | payment | 07-20 | (없음) | — |

### A-5) SALESLIST backfill(T-20260725, F-4550/5016/4906) — 현은호(F-4717) **미포함** (OK, 재확인)

---

## C. 김병완 (F-4741, customer 259abd32-d784-4c45-b59e-1ccae1b69492) — ★FIX-REQUEST 신규 진단 항목

### C-1) 지정 payment b7ab6496 실쿼리 — **실재 확인**
```
id=b7ab6496-9efc-429c-9d5c-60a248eabc15
amount=73,000 · method=card · payment_type=payment · status=active
check_in_id=dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf (therapist=김규리 3a0c6774, checked_in 08-01)
accounting_date=2026-08-01 · package_id=NULL
external_approval_no=89808755 · external_trxid=K1047535843260801… · external_status=Y  → 실 VAN 카드결제(수동 아님)
```
- **현재 귀속값(실 귀속축=check_in.therapist_id)** = **김규리**. → 8월 치료(수납) 매출 집계에 **김규리로 반영됨**(status active, accounting_date 8/1).

### C-2) 김병완 8월 payments 전량
| payment_id(선두8) | amount | acct_date | check_in→therapist | 김규리? |
|---|---|---|---|---|
| b7ab6496 | 73,000 | 08-01 | dec7e6c4→김규리 | ✅ |
| 982cd78d | 5,200 | 08-01 | dec7e6c4→김규리 | ✅ |

### C-3) 김병완 8월 check_in_services = 7건, **풋화장품 라인 0건 · 전부 seller_staff_id=NULL**
| service | price | seller | check_in→therapist |
|---|---|---|---|
| 재진진찰료-의원 | 13,370 | NULL | 2a605d76→김규리 |
| 비가열성 진균증 레이저 | 240,000 | NULL | 2a605d76→김규리 |
| 재진진찰료-의원 | 13,370 | NULL | dec7e6c4→김규리 |
| 비가열성 진균증 레이저 | 240,000 | NULL | dec7e6c4→김규리 |
| 손발톱백선 / 발백선 / 터미졸크림 | 0 | NULL | dec7e6c4→김규리 |

### C-4) Item C 결론 (현재값 vs 기대값)
- **결제(payment) 축**: 73,000(b7ab6496) 은 실재하며 **김규리 check_in 에 결속 → 김규리 치료(수납) 매출 8월 집계에 이미 반영됨**(현재값=기대값 일치).
- **화장품(cosmetic) 칸 축**: 8/1 결제분에 대응하는 **풋화장품 cis 판매라인이 없음**(cis 7건 모두 진찰/레이저/투약, 화장품 0). → 만약 이 73,000 이 화장품 재결제라면 **화장품 칸(김규리)에는 미표시**(현재값=미표시 / 기대값=김규리 화장품).
- 원인 = 현은호 A 와 동일 구조: payment-only(대응 cis 화장품 라인 부재) → 화장품 칸은 cis 만 읽어 미표시.
- 정정 경로(별건, 본 티켓 아님): **T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI** 로 분리(화장품 cis 라인 재삽입 seller=김규리, Data-Correction Backfill SOP). 본 진단은 READ-ONLY로 실재·귀속·미표시 원인만 규명.

---

## B. 화장품 팝업 / 김규리 데이터원 (인프라 정상 — 재확인)
- 김규리 버킷 풋화장품 cis 라인 = **18건 / 391,000** (6/27~8/8, 기간 무한정 all-time 집계값). ※ SalesStaffTab UI 는 조회기간 필터 적용 → 특정 월 화면값은 이 부분집합(FIX-REQUEST 의 "17건"=특정기간분, 본 실행 all-time=18건, 8/8 신규라인 포함으로 증가). 데이터원 건강·팝업 인프라 정상.
- 현은호 CTB·김병완 8/1 결제분은 화장품 cis 라인이 없어 어떤 드릴다운에도 안 뜸 = **데이터 부재(렌더버그 아님)**.

---

## AC 대조표
| AC 항목 | 판정 | 근거 |
|---|---|---|
| A. 현은호 payment 2e8f7aa5 실재·귀속값 | ✅ 실재, 귀속=김규리(check_in축) | A-1/A-4 |
| A. 미표시 원인 분기 (NULL vs 필터버그) | ✅ 둘 다 아님 = 소스-테이블 불일치 | A-2, §0b |
| A. SalesStaffTab 화장품 소스=payments? cis? | ✅ **cis** (payments 미조회) | §0b (L406~424 vs L281) |
| A2. 현은호=F-4717 단일 + 07-28 재진 김규리 귀속 | ✅ | A-1, 통과항목 |
| A3. SALESLIST backfill 현은호 미포함 | ✅ | A-5, 통과항목 |
| B. 라이브번들·팝업fix·김규리 cis 실재 | ✅ 18건/391,000 | B |
| C. 김병완 payment b7ab6496 실재·귀속·8월 반영 | ✅ 실재, 김규리 결속, payment축 반영됨 / 화장품칸 미표시 | C-1~C-4 |

## 통합 근본원인
payment-only 화장품 결제(현은호 2e8f7aa5, 김병완 b7ab6496)는 대응 `check_in_services` 풋화장품 판매라인이 없어, **cis 만 읽는 SalesStaffTab 화장품 칸에 구조적으로 미표시**. payment 자체는 김규리 check_in 에 결속되어 치료(수납) 매출에는 반영됨. 귀속-NULL 아님, external/manual 제외 필터버그 아님(코드확인). 정정 경로 = 코드수정 아님, **화장품 cis 판매라인 데이터 정정/재삽입(seller=김규리)** 별건 backfill (Data-Correction Backfill SOP + seller 재귀속 zero-sum, Track A T-20260804-foot-COSMETIC-CORRECTION-CRM 선례). 현은호=본 티켓 원항 / 김병완=별건 T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI.

**READ-ONLY 준수: prod write / DDL / 배포 = 0.**
