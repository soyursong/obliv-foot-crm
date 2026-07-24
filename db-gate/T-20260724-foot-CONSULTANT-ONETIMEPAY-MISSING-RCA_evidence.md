# T-20260724-foot-CONSULTANT-TKTREV-ONETIMEPAY-MISSING-RCA — READ-ONLY RCA evidence

- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm) · clinic=jongno-foot `74967aea-a60b-4da3-a0e7-9c997a930bc8`
- 성격: READ-ONLY (SELECT only, DDL/write 0건). probe: scripts/T-20260724-foot-CONSULTANT-ONETIMEPAY-MISSING-RCA_probe{1..5}.mjs
- 대상 RPC: `foot_stats_consultant` (현행 = 20260717170000 arpu_denom, base 20260717160000 pkg_attr_reconstruct). packages.consultant_id 캡처는 Phase 1(컬럼+트리거)만 배포, RPC는 여전히 heuristic pkg_attr 사용.

## 판정 요약 (분기 A = 버그, by-design 아님)

| 축 | 판정 |
|----|------|
| 1회성 정의 | `packages.total_sessions <= 1` (무좀체험권·오니코레이저·AF레이저·custom 단회 등) OR `payments` 단건(비패키지) |
| 단회 **패키지** 결제 | **100% 정상 집계** — 7월 25행/20패키지/₩2.63M 전부 pkg_attr consultant_id 매핑됨. 누락 0건 |
| 단건 **직접결제**(payments 비패키지) | **net ₩6,916,060 / 155행 누락 = 단건 net매출의 97.7% 누락** (화면 잡힘 net ₩159,200 / 33행뿐) |
| 100% 여부 | 단회 패키지는 0% 누락 / 단건 직접결제는 실질 전부(97.7% net) 누락 → 현장 "1회성 전부 안 들어온다"=단건 직접결제를 지칭, claim 사실상 참 |
| 분기 | **A (RPC 귀속 버그)** — 단건 누락분의 85%+가 상담이력 있는 고객(귀속 가능한데 안 됨). by-design 아님 |

## RC (근본원인) — 귀속 KEY 비대칭

`foot_stats_consultant` RPC 안에서 두 매출소스의 WHO 귀속 키가 다르다:

- **pkg_rev** (패키지매출): `packages JOIN ticketed_all ON customer_id` — **고객 기반**. 견고 → 단회/다회 패키지 전부 귀속됨.
- **single_rev** (단건매출): `payments JOIN ticketed_all ON check_in_id` — **check_in 기반**. 취약 → 결제행의 check_in_id 가 '상담(consultation) check_in'과 정확히 일치해야만 귀속.

단건 직접결제 write-path("영수증 수납(단건)"/"영수증 업로드(회수1·단건)")는 `payments.check_in_id = NULL` 로 적재됨(147 card 中 134 no-checkin). → single_rev JOIN 실패 → 전부 미귀속. RPC에 pkg_rev 같은 **고객 기반 fallback 이 없음**.

## Evidence (쿼리 결과)

### 1) 7월 package_payments × 1회성 × pkg_attr 매핑 (probe3.july_pkg_attr)
```
is_onetime=false, mapped=true : 37행/24pkg/₩118,260,010   (다회 패키지 — 정상)
is_onetime=true , mapped=true : 25행/20pkg/₩2,630,000     (단회 패키지 — 전부 정상 매핑)
is_onetime=false, mapped=false: 1행/₩100                  (테스트행)
→ is_onetime=true & mapped=false 행 = 0건. 단회 패키지 누락 없음.
```

### 2) 7월 단건결제(payments 비패키지) 매핑 (probe5.single_net_split, net·refund반영)
```
mapped=false (누락): net ₩6,916,060 / 155행   ← 97.7%
mapped=true  (화면): net ₩159,200   /  33행
```

### 3) 누락 단건결제 고객의 상담이력 (probe4.G_missing_has_consult, gross)
```
cust_has_consult=true : 145행 / ₩9,655,440  ← 상담이력 O = 귀속 가능했음(분기 A 근거)
cust_has_consult=false:  10행 / ₩1,702,360  ← 상담이력 X = 진짜 by-design 미귀속
```

### 4) 누락 단건결제 정체 (probe4.F/I) — 영수증 수납/업로드 단건, 카드 147행 中 134 no-checkin. memo="영수증 수납(단건)","영수증 업로드(회수1·단건)".

### 5) 부모 RCA 6.9M 대사 (probe5) — **정확 일치 = smoking gun**
```
RPC 7월 화면 total_amount 합 : ₩73,889,210
실제 net 매출(pkg+single)    : ₩80,805,370  (pkg ₩73,730,110 + single ₩7,075,260)
gap                          : ₩6,916,160
단건 미귀속 net              : ₩6,916,060   (+pkg 테스트행 ₩100)
→ 부모 RCA '미귀속Δ 6.9M' = 100% 단건결제 check_in_id JOIN 탈락분.
```

## 부모 RCA / LABEL-RECONCILE 정합 판정 → **모순 (재개정 필요)**

- 부모 T-20260723-DAYCLOSE-RECONCILE: 미귀속Δ 6.9M = by-design(상담이력無/비상담직군) 결론.
- 반증: 6.9M = 전액 단건결제 미귀속이며, 그 중 ₩9.66M gross(145행, 85%+)는 **상담이력 있는 고객**. "상담이력無"가 아니라 single_rev 의 check_in_id JOIN 취약성 + 단건 write-path 의 check_in_id 미적재 때문.
- ⇒ LABEL-RECONCILE 의 "미귀속=상담이력無" 라벨은 이 버그를 정상으로 오안내. **LABEL field-soak HOLD 유지 → 라벨 재개정 필요**. 부모 RCA 결론도 단건결제 carve-out 로 수정 필요.

## 후속(수정 스코프 — 본 티켓 밖, DA CONSULT 게이트 필수)

single_rev 귀속을 pkg_rev 와 동형(고객 기반 최근접 consultation WHO)으로 통일 → ₩6.9M/145행 회수.
WHO 귀속 변경 = 매출 split SSOT / 인센티브 분모 base 영향 → DA CONSULT 선행 필수(§S2.4). 별도 티켓 제안.
