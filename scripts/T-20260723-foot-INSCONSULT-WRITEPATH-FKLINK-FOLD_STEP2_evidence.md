# T-20260723-foot-INSCONSULT-WRITEPATH-FKLINK-FOLD — STEP 2 실행 evidence (dev-foot)

**게이트**: db_change=false / ADDITIVE / no-DDL. DA STEP 1 RATIFY(A-a1 authoritative,
DA-20260723-foot-INSCONSULT-FKLINK-FOLD-RATIFY). deploy-ready 마킹 전 supervisor 코드리뷰 + write-rowcheck 게이트.
DDL-diff 불요(no-DDL). build PASS(6.03s) / e2e 30 PASS.

---

## 1) a1 — 원자 write-path 트리거 필터 확장 (코어)

`src/components/PaymentMiniWindow.tsx` `executeAutoDone`:
- **필터 predicate 삭제**: `is_insurance_covered && hira_category==='consultation'` → **`is_insurance_covered` 단독**.
- 변수명 `coveredConsultServices` → `coveredServices`(진찰 전용 아님 반영).
- hira_category 는 write-path 게이트로 미사용(DA BINDING: display/분석 분류축) → dead-path 근본원인 봉인.
- 효과: 진찰(AA154/254/222)뿐 아니라 처치(M0111)·검사(D620300HZ KOH) 등 **전 급여건**이 원자 RPC
  (`record_insurance_consult_payment`)로 라우팅 → service_charge(명세) + FK-copay payment(tax_type NULL) 원자 생성.
- a2(폴백 fold) 미채택 — copay 이중계상·relink·비원자·W5 이식 위험(self-reverse 근거 계승).
- RPC 재검증: RPC 본문에 consultation 고유 가정 **없음**(generic — p_service_id + is_insurance_covered 체크 +
  calc_copayment 호출). 멱등키 = (check_in_id, service_id) + engine 'consult_writepath_v1' → 처치/검사 svc 도 동일 멱등.

### G1 (이중 write 금지) — 검증 PASS

| 경로 | 조건 | service_charges write | payments write |
|---|---|---|---|
| 원자 RPC | `!isDeductSettle && splits.length===1` 인 covered 셋 | 생성(engine 'consult_writepath_v1') | FK-copay payment 생성 |
| 폴백 snapshot(L2082) | 항상(best-effort, executeAutoDone 말미) | **check_in_id dedup** → skip | 무접촉(charge-only) |

- 폴백은 `service_charges.service_id WHERE check_in_id=checkIn.id` 를 **DB에서 fresh 조회**(L1858-1862) →
  `already` Set. 원자 RPC 가 방금 적재한 covered 셋의 service_id 가 전부 포함 → `already.has(svc.id)` true → **skip**.
  → 확장된 covered 셋 전체를 폴백 dedup 이 커버. **service_charges 이중 생성 없음.**
- payments 는 폴백이 아예 미생성(charge-only, L1842·insert('service_charges')만) → **copay payment 이중 생성 없음.**
- 원자 RPC 가 data_incomplete 로 BLOCK한 svc → `already` 에 없어 폴백이 시도하나, 폴백도 `data_incomplete continue`(L1886)
  → service_charge 미생성. phantom 재적재 없음(§B1 참조).
- 순서 의존성: 원자 RPC(executeAutoDone 상단) → 폴백(말미 L2082) → 항상 원자 선행 → 폴백 dedup 유효.

### G2 (rows-affected) — 검증 PASS (cross_crm_write_rowcheck_standard)

- FK-링크 copay payment INSERT 는 RPC(SECURITY INVOKER, RLS 적용) **서버 트랜잭션 내부** `RETURNING id INTO v_pay_id`.
  RLS 거부 시 plpgsql INSERT 는 **0-row silent 아니라 정책위반 EXCEPTION** → 클라 `rpcErr` 로 포착.
- 추가 클라 가드: RPC 성공(error=null)인데 반환 row 부재/`payment_id` NULL → **`throw`**(silent write-failure 오인 금지).
  RPC 는 정상경로(신규 or 멱등 hit)에서 반드시 1행(payment_id 비-NULL) 반환 → 부재 = 명세/FK-copay 미적재 신호.
- copay 합산은 `row.copayment_amount ?? 0`(payment_id 검증 통과 후) → 0-row 를 0원 성공으로 오인하지 않음.

---

## 2) B1 완전봉합 — a1과 한 배포로 묶음 (PASS)

- ★조건: RPC가 BLOCK(data_incomplete)한 charge를 폴백이 phantom 공단 copay 재적재하지 않아야 완전봉합.
- 봉합 방식 = **MQ 옵션 2(폴백에 §2-2-1b default-deny 이식)** 채택. 근거: 폴백은 선수금차감·분할결제(parent C4)
  경로에서 **여전히 유일 명세 write-path** → 완전 은퇴 불가 → 폴백 자체를 원자 RPC 와 동일 default-deny 로 정합화.
- `snapshotCoveredServiceCharges` 에 원자 RPC **W5 grade-confirmed zeroing 이식**:
  ```
  const gradeConfirmed = r.applied_grade != null && r.applied_grade !== 'unverified';
  const coveredAmount = gradeConfirmed ? r.insurance_covered_amount : 0;   // phantom 공단 0 보수
  ```
- 근거: calc_copayment 는 grade 미확정(unverified/NULL)을 general 정률(30%)로 반환(data_incomplete=false,
  20260720193000 v1.6 ELSE 분기). 폴백이 반환값 그대로 적재하면 **공단 70% phantom 확정 적재**(§2-2-4 판정2 위반).
  이제 두 write-path(원자 W5·폴백)가 **byte-identical** default-deny → grade≠확정 시 공단부담=0.
- data_incomplete(hira_score/hira_unit_value NULL, non-general) → 두 경로 모두 skip(원자=EXCEPTION, 폴백=continue)
  → 명세 미생성 → phantom 없음.
- copay 는 두 경로 모두 잠정 30% 유지(재정산 경로 전제) — 일치.
- **한 배포**: a1 + B1 + B2 동일 커밋(no-DDL 코드-only).

---

## 3) B2 read-side re-source — 스코핑 결과: **bounded, 그러나 authoritative RATIFY(oalw) = 디커플 → 본 티켓 미포함**

### 스코핑(read-only) 결론

- 급여 열 read-path 소비처 = `SalesDailyTab.tsx` **단일 파일**. `taxTypeToCol` 소비처 = 우측 매트릭스 1곳 → **bounded**.
- **★ 디커플 안전성 검증(a1 alone = display-neutral)**:
  - PRE-a1: covered 급여 copay 가 lump plain payment(tax_type NULL)에 흡수 → 면세 버킷 + service_charges copay
    → **이중계상이 이미 존재**(status quo).
  - POST-a1(no B2): copay 가 별도 FK-copay payment(tax_type NULL)로 분리되나 **여전히 면세 버킷**(같은 위치)
    → 좌/우 **표시 status quo 와 동일**. a1 단독은 회귀를 만들지 않음(display-neutral).
  - B2(read-side)가 실제로 이중계상을 제거하는 fix(FK-copay 를 좌측 skip + 우측 급여 열). PRE-a1 lump 이중계상은
    C4 백필(deferred) 소관.
- → **a1 write-path 먼저 → C4 read-side(B2) 후속**(oalw delta 1)이 안전하게 성립. a1 없이 B2 만으로는 급여 열이
  살아나지 않고(FK-copay payment 부재), a1 없이 a1 배포해도 표시 악화 없음.

### authoritative 조정 (planner 티켓 로그 21:22)

- DA 보충 RATIFY **MSG-20260723-211516-oalw** 가 내 NEW-TASK(dx0w, 21:15:41) **25초 前** 도착 → dohs 기반 dx0w 미반영.
- **delta 1(B2 decisive)**: dohs "본 티켓 fold 판단" **상위 정정** → 급여 열 부활 = **별건 read-side·비블로킹**(C4 FK-repoint 활성화),
  순서 a1 먼저 → C4 후속. **read-side 를 a1 에 fold 말 것(fold 여부 판단 자체 철회).**
- planner 재조정: "dx0w 코어(§1 a1 + §2 B1 + 게이트)는 유효 유지" → B2 §3 디커플.
- 이전 dev-foot INFO(z62z)가 이미 디커플 상위본 ACK.

### 처리

- **B2 re-source 를 본 배포에서 revert**(SalesDailyTab.tsx = origin/main 원복). a1+B1 만 착지.
- B2 구현본은 **완성·검증 완료 상태로 대기**(scoping = bounded, single file). planner 가 C4 read-side 활성화 티켓으로
  spin-off 시 즉시 이식 가능. FOLLOWUP 으로 planner 에 회신(디커플 수용 + ready patch 보유 통지).
- 향후 B2 구현 방향(참고): `paymentToCol(p)` = service_charge_id FK → '급여' / 그 외 tax_type 매핑;
  payments select 에 service_charge_id 추가(pkg 컬럼 부재→미조회); 좌측 `if (p.service_charge_id) continue`(이중계상 방지);
  우측 매트릭스 paymentToCol 사용. **tax_type='급여' 저장/신설 금지**(§2-5, VAT축↔보험축 conflation 위반) — FK 만이 급여 귀속 축.

---

## 4) hira_category 매핑 접지

- 계약 §services v1.55 canonical enum 등재 완료(planner): consultation/procedure/examination/prescription.
- ★BINDING: hira_category = display/분석 축, **write-path 게이트 금지**. a1 은 predicate 삭제로 hira_category
  **seed 불요**(발화는 is_insurance_covered 단독). 값 backfill = 비블로킹 별건(본 티켓 실행 안 함).
- ⚠ AA222 매핑 확인(oalw delta 2): dx0w 가 AA222→consultation 으로 적었으나, AA222 = "재진-물리치료·주사 등
  시술받은 경우" = 재진진찰료 계열 visit-fee 이나 명칭상 procedure 계열 논쟁 여지. **HIRA 분류 최종확인 = 비블로킹**
  (hira_category 는 write-path 게이트 아님 → a1 발화·B1 봉합에 무영향). dev-foot 잠정 = **consultation**(재진진찰료
  계열 visit-fee), planner/DA 이견 시 정정. 본 티켓 착지에 blocking 아님.

---

## OUT(미실행 확인)

- 과거 6방문 copay FK-링크 백필 = deferred(SALESDAILY C4). ❌ 미실행.
- base 계산 divergence(COPAY-BASE-GRAIN-RECONCILE) = 별개 축. ❌ 미접촉.
- cross-CRM sweep(B4) = forward item. ❌ 미접촉.

---

## 산출물 / 검증

- 코드: `PaymentMiniWindow.tsx`(a1 필터 확장 + G2 rowcheck 가드 + data_incomplete per-svc 흡수 + B1 폴백 W5 zeroing).
  `SalesDailyTab.tsx`(B2) = **revert(디커플)** → origin/main 원복.
- spec: `tests/e2e/T-20260723-foot-INSCONSULT-WRITEPATH-FKLINK-FOLD.spec.ts`(신규 8 case: a1/G1/G2/B1) +
  `T-20260715-...CONSULTFEE...spec.ts`(회귀 3 case 갱신).
- db_change=false(no-DDL, 스키마 요소 folding 없음 — 기존 payments.service_charge_id FK 재사용, 신규 컬럼/enum 0).
- ⚠ 종결 기준: green build/spec 만으로 done 아님 — supervisor QA(코드리뷰+write-rowcheck) + 갤탭 실기기 현장 confirm 후 done.
- FOLLOWUP: B2 디커플 수용 + ready patch 보유 + AA222 HIRA 잠정 consultation 회신(planner).
