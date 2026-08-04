# T-20260805-foot-CHARTRESAVE-COSMETIC-CIS-WIPE-PAYUNLINK-DIAG — 진단 리포트

> **READ-ONLY 진단** (prod DML·DDL 0, FE 코드 변경 0). 차트 재저장(check_in_services delete-all→reinsert)이
> retail 화장품(풋화장품) 판매 라인을 소멸시켜 살아있는 결제행과 서비스라인이 unlink 되는 시스템 패턴의
> 근본원인·영향규모·매출집계 영향 규명.
> 진단일 2026-08-05 · assignee dev-foot · 기준 커밋 `51d62213` (현행 prod main HEAD).
> 발생 관찰: T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE (F-4741 김병완 재대조).

---

## 판정 요약 (TL;DR)

**근본원인 확정 = FE 재구성 로직의 "active-service 매칭 실패 라인 silent drop".**
차트/결제 재저장은 `check_in_services`(cis)를 **DELETE-all → reinsert** 방식으로 처리하는데, reinsert 세트인
`selectedItems`는 PMW 오픈 시 **활성 서비스(`services.active=true`)와 service_id로 매칭된 cis 라인만**으로 재구성된다.
매칭 실패 라인은 **`else` 분기 없이 조용히 버려진다**. 화장품(풋화장품) 라인은 아래 두 벡터로 매칭에 실패하기
쉬워, 재저장 시 재삽입 세트에서 누락 → 영구 소멸한다. 결제행(payments)은 별 grain이라 alive로 잔존 →
**결제-서비스라인 unlink**.

- 소멸 locus (유일): `src/components/PaymentMiniWindow.tsx`
  - `saveCheckInServices()` (L2110~) — 명시적 [시술 저장] 재실행 경로 (지배적 wipe 경로)
  - `handleClose()` (L2646~) — X 닫기 자동저장 경로 (`!saved && selectedItems.length>0` 조건 시)
- **cis delete-all→reinsert 는 이 두 함수가 유일** (`from('check_in_services').delete()` grep = PMW 2곳뿐, 의료차트 패널·기타 서페이스는 cis read-only).
- reinsert 소스 = `selectedItems` (L989) — PMW 오픈 시 L1288~1302에서 재구성.

---

## AC1 — 패턴 재현·원인 확정 (retail 라인이 재삽입 세트에서 누락되는 지점)

### 재구성 로직 (PMW 오픈 시, L1244~1312)

```
Promise.all([
  services  … .eq('active', true) …            // L1246-1251  ← 활성 서비스만 로드
  check_in_services .select('service_id, price, seller_staff_id') .eq('check_in_id', …)  // L1252-1255
  …
]).then(([svcsRes, cisRes, …]) => {
  const svcs = svcsRes.data …                   // 활성 서비스 집합
  const existingCis = cisRes.data …
  for (const ci of existingCis) {
    const svc = svcs.find((s) => s.id === ci.service_id);   // L1289
    if (svc) { items.push({ service: svc, qty }) … }        // L1290-1302
    // ⚠️ else 분기 없음 — 매칭 실패 cis 라인은 selectedItems 에서 silent drop
  }
  setSelectedItems(items);                        // L1307 — 누락된 채로 확정
})
```

재저장(`saveCheckInServices`)은 `selectedItems.flatMap(...)`(L2152)로 reinsert 행을 만든다. 즉 오픈 시점에
`selectedItems`에서 빠진 라인은 DELETE 후 **다시 들어오지 않는다** → 소멸.

### 화장품 라인이 매칭에 실패하는 두 벡터

| 벡터 | 조건 | 근거 |
|------|------|------|
| **A. 비활성 서비스** | cis.service_id 가 `active=false` 서비스를 가리킴 | 로드 쿼리 `.eq('active', true)` (L1249) → svcs에 없음 → `svcs.find` undefined → drop. **화장품 상품은 비활성 상태가 실재**: `20260601180000_services_cosmetic_label_normalize.sql` 헤더에 "무공백 '풋화장품' 5건은 모두 비활성" 명시. |
| **B. NULL service_id** | cis.service_id 가 NULL (수기/free-text retail 라인) | reinsert 는 `service_id: service.id as string \| null`(L2168) 로 NULL 저장 가능. 그러나 재구성은 `svcs.find(s.id === ci.service_id)` 로 service_id 키 매칭 → NULL 은 어떤 서비스와도 매칭 불가 → drop. 게다가 load select 에 `service_name` 미포함 → free-text 이름조차 복원 불가. |

두 벡터 모두 **"의료차트/시술코드 기원 라인(활성 service_id 보유)만 재생성"** 이라는 티켓 서술과 정확히 일치.
치료·시술 코드 라인은 활성 서비스라 살아남고, 비활성/수기 화장품 라인만 선택적으로 소멸한다.

### F-4741 지문과의 정합

- 부모 check_in `fdd5c165` 현 11 cis 전원 `created_at=2026-08-03 01:25:16` 동일 = 08-03 재저장(DELETE-all→reinsert)의 단일-트랜잭션 지문. 화장품 라인은 이 세트에 부재 → 소멸 확증.
- 살아있는 8/1 결제 `b7ab6496`(73,000)의 부모 check_in `dec7e6c4` 화장품 cis 도 08-03 재생성으로 소멸 → 결제 alive·라인 부재 = unlink.

### 왜 결제행은 안 지워지나 (unlink 성립 이유)

`payments` 는 cis 와 별 테이블·별 grain. cis DELETE 는 `check_in_id` 기준이며 payments 를 건드리지 않는다
(`payments.check_in_id` FK 는 `ON DELETE` cascade 아님, `check_ins` 참조만). 따라서 이미 수납된 결제행은
그대로 alive → 라인만 사라지는 반쪽 상태 = unlink.

---

## AC2 — 영향 규모 census (READ-ONLY)

집계 쿼리는 동봉 `docs/chartresave_cosmetic_cis_wipe_census.sql` 로 분리(prod SQL Editor / service_role 실행).
**인증컨텍스트 = service_role(RLS 우회) 필수** — anon/publishable 키로 실행 시 RLS 로 0-row 반환되어
"wipe 없음"으로 오독될 수 있음(Cross-CRM 진단 인증컨텍스트 표준 준수, `--_ctx: service_role` 헤더 명시).

census 는 4개 각도로 규모를 교차 측정한다(단일 쿼리 과신 금지):

1. **§1 재저장 지문 집계** — 한 check_in 의 cis 가 전원 동일 created_at 을 갖고, 그 시각이 부모 결제
   created_at 보다 나중인 check_in 수(= delete-all→reinsert 발생 지문).
2. **§2 결제-라인 unlink census** — alive payment(payment_type='payment', 순액>0) 인데 부모 check_in 에
   화장품 cis 라인이 0건인 결제행의 환자수·건수·금액. (payment_items 화장품 스냅샷을 독립 증인으로 대조.)
3. **§3 화장품 매출 정합** — 월별 화장품 cis 라인 합 vs 화장품 payment_items 스냅샷 합의 divergence
   (payment_items 는 `ON DELETE SET NULL` 이라 cis 삭제에도 잔존 → 소멸분의 독립 witness).
4. **§4 비활성-service cis 노출** — 현재 cis 라인 중 service_id 가 비활성/부재 서비스를 가리키는 행
   (= 다음 재저장 시 소멸 예정인 잠재 대상, forward-risk 규모).

> 실 카운트 수치는 prod 실행 결과로 채워 planner FOLLOWUP 에 첨부한다(본 리포트는 쿼리·해석 프레임 확정).

---

## AC3 — 매출집계 영향 판별

- **결제총액(매출 grain)**: 영향 없음. 매출집계·마감·EDI 는 `payments.amount`(수납 grain)를 본다.
  cis 라인 소멸은 payments.amount 를 바꾸지 않으므로 **매출총액은 정상 계상**(under-count 아님).
- **line-item 분해·귀속**: 영향 있음(잠재). 화장품 판매 치료사 귀속은 `check_in_services.seller_staff_id`
  (T-20260724-foot-COSMETIC-SELLER-ATTRIB)에 산다. 화장품 cis 라인이 소멸하면 **SalesStaffTab / 화장품
  판매명단(라인 grain 집계)** 에서 해당 판매가 누락 → 치료사 실적·화장품 판매내역 divergence.
- **결론**: 매출총액 KPI 는 무영향, **화장품 라인-레벨 실적/판매명단은 과소계상 위험**. 실 divergence 유무는
  §3 census(cis 합 vs payment_items 합)로 확정.

---

## AC4 — 정정 필요성 판정 인풋 (planner FOLLOWUP)

본 티켓 범위 = 진단까지. 아래는 planner 트리아지용 권고(실행은 별 티켓):

1. **재발방지 (fix 티켓 후보, P1~P2)**: PMW 재구성 로직이 활성-매칭 실패 라인도 보존하도록.
   - 방향 A: 재구성 시 매칭 실패 cis 라인을 drop 하지 말고 **원본 스냅샷(service_name/price/seller_staff_id)
     그대로 preserve-reinsert** (package_session_id / examFlags C3 보존과 동일 패턴 — 이미 선례 존재, L2116~2141).
   - 방향 B: load select 에 `service_name` 추가 + `services` 로드에서 `.eq('active', true)` 제거하고
     화장품/비활성 서비스도 매칭 대상에 포함.
   - **주의**: 이는 write 경로 변경 → data-architect CONSULT 게이트 대상 여부 planner 판단(신규 컬럼 무·기존
     컬럼 보존 로직이면 ADDITIVE 가능성). 본 진단 티켓에서 착수 금지.
2. **소급 정정 (backfill 후보)**: 이미 소멸한 화장품 라인의 복원은 **파괴적 아님(INSERT)** 이나 원본 소실분
   재구성이 필요 → payment_items 스냅샷(잔존)을 소스로 하는 backfill.
   - 봉투: Cross-CRM Data-Correction Backfill SOP / SALESLIST-MISSING-RECORDS-BACKFILL(T-20260725, blocked)
     와 상호참조 — 본 진단이 그 티켓의 "왜 누락되는가" 근본원인 인풋 제공.
   - 대상셋 freeze·per-row 판정근거·박민지 comp-gate·원장 무접점 = SOP 준수(별 티켓).
3. **본 티켓에서 정정/백필/삭제 실행 금지** — READ-ONLY 게이트 유지.

---

## 게이트 준수 확인

- prod DML·DDL 0 / FE 코드 변경 0 / 신규 컬럼·테이블·enum 0 → data-architect CONSULT 불요(진단 단계).
- 산출물 = 본 리포트 + `docs/chartresave_cosmetic_cis_wipe_census.sql`(READ-ONLY SELECT only).
- ball → planner(규모·근본원인·매출영향 트리아지 → 재발방지 fix / 소급 backfill 격상 판단).
