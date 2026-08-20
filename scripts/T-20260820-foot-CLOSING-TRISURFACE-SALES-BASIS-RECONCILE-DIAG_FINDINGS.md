# T-20260820-foot-CLOSING-TRISURFACE-SALES-BASIS-RECONCILE-DIAG — 조사 회신 (READ-ONLY)

**타입**: feasibility_inquiry / diagnostic · **산출물**: 코드(제품) 0건 · READ-ONLY census 3종 + 본 findings
**auth 컨텍스트**: Supabase Management API `database/query` = `postgres` 슈퍼유저(RLS 미적용) → silent-0row 회피 명시. prod write/DDL/정정 **0건**.
**표본일**: 2026-08-18, 2026-08-20 · **clinic**: 서울 오리진(74967aea…) · **live 판정 커밋**: 72b32319 (pages.dev version.json == origin/main HEAD)

---

## 0. 한 줄 결론

현장이 본 불일치의 **주 원인은 8a70dde8(REVENUE-BASIS-REBUCKET, 12:01)이 아니라, 그 뒤 오늘 14:20에 배포된 `476ed6e2 CLOSING-METHODTOTAL-REFUND-EXCLUDE`** 다.
이 커밋이 **합계(결제수단별) 카드의 수단별 라인을 NET(환불 차감) → GROSS(정상수납·환불 완전 제외)로 재전환**했는데, 같은 일마감 화면의 **담당자별 매출 소계·실장별 일별 매출은 그대로 NET(환불 차감)** 이라, 환불이 있는 날 수단별 금액이 **환불액 전체만큼** 벌어진다. → 가설 (a)는 "오늘 money-path 배포가 basis를 갈랐다"는 점에서 맞으나, **범인 커밋이 rebucket이 아니라 후속 REFUND-EXCLUDE**로 정정된다. rebucket의 revenue-basis 값(…Rev)은 **더 이상 화면에 표시되지 않음**(476ed6e2가 GROSS로 덮음).

---

## 1. 3-surface(+합계카드) basis 매트릭스 (코드 실측)

| surface | 위치 | 기간축(단건/패키지) | 수단별 basis | 환불 | sim/test | 귀속축 |
|---|---|---|---|---|---|---|
| **결제내역 리스트** (enrichedRows) | 일마감>결제내역 | created_at / **accounting_date** | raw method, NET | 차감(-) | **포함** | assigned_staff(표시) |
| **담당자별 매출 소계** (staffTotals) | 일마감>결제내역 | = 리스트 파생(동일 모집단) | raw method, **NET** | **차감(-)** | **포함** | live assigned_staff_id |
| **합계(결제수단별) 카드** (totals) | 일마감>결제내역 | created_at / **created_at** | **GROSS(정상수납)** | **완전 제외** | **포함** | — |
| **실장별 일별 매출** (fetchStaffDailyBreakdown/SSOT) | 일마감>일자별비교 · 통계>MTM | **accounting_date** / accounting_date | net(수단합) | **차감(-)** | **제외** | attributed_staff snapshot→live |

핵심: **담당자별/실장별 = NET(환불차감)**, **합계카드 = GROSS(환불제외)**. 합계카드 grand total 만 NET(grossTotal). → 수단별 라인끼리 비교하면 환불액만큼 어긋남.

---

## 2. delta 실측치 (갈라지는 지점 특정)

### 2026-08-18
| 비교 | 값 | delta | 원인 |
|---|---|---|---|
| **현금** 합계카드(GROSS) vs 담당자별(NET) | 5,435,400 vs 635,400 | **-4,800,000** | 현금 환불 2건(패키지 교차수단) 완전 제외 vs 차감 |
| **카드** 합계카드(GROSS) vs 담당자별(NET) | 62,227,000 vs 58,949,400 | **-3,277,600** | 카드 환불 완전 제외 vs 차감 |
| grand total 합계카드 vs 담당자별 | 59,584,800 vs 59,584,800 | 0 | (일치) |
| grand total 담당자별 vs 실장별 | 59,584,800 vs 59,580,900 | **-3,900** | **sim/test 고객 단건 3건**(실장별만 제외) |

### 2026-08-20 (현장 신고 당일)
| 비교 | 값 | delta | 원인 |
|---|---|---|---|
| **현금** 합계카드 vs 담당자별 | 30,000 vs 30,000 | 0 | (당일 현금 환불 0) |
| **카드** 합계카드(GROSS) vs 담당자별(NET) | 41,853,600 vs 35,833,600 | **-6,020,000** | 카드 환불 3건(단건1+패키지2) 완전 제외 vs 차감 |
| grand total 3-surface | 35,863,600 = 35,863,600 = 35,863,600 | 0 | (전부 일치) |

→ **당일(08-20) grand total은 3-surface 완전 일치**. 어긋나는 곳은 **합계카드 카드 라인(GROSS)만 6,020,000 높게 표시**. 현장이 "카드 총합이 담당자별과 안 맞는다"를 봤을 개연 최상.

---

## 3. 원인 분해 (복합 — 독립 3건)

- **원인① (PRIMARY·오늘 회귀)**: `476ed6e2 METHODTOTAL-REFUND-EXCLUDE`(14:20 배포, live). 합계카드 수단별=**GROSS(환불제외)**, 담당자별/실장별=**NET(환불차감)** → 환불 있는 날 수단별 라인이 **환불 전액만큼** 발산. 08-18 현금 4.8M / 08-20 카드 6.02M. (합계카드 캡션 "정상수납−환불=합계"로 자기설명은 있으나, **다른 surface와의 수단별 정합은 깨짐**.)
  - ※ 배포시각 확인: 476ed6e2=14:20, 현장 신고=17:33 → **신고 시점 live에 이미 반영**. 8a70dde8(11:34/12:01) 이후 합계카드는 3회 더 변경(760057cb 13:21·0078597e 13:52·476ed6e2 14:20). task 전제(8a70dde8 단독)는 **불완전** — 실 범인은 최종 커밋.
  - ※ rebucket(…Rev, revenue-basis)은 **현재 미표시**(476ed6e2가 GROSS로 대체). 가설(a)의 "rebucket이 담당자별/실장별에 미적용" 자체는 사실이나, rebucket 값이 화면에 없으므로 **관측 delta의 직접 원인 아님**.

- **원인② (PRE-EXISTING·소액)**: sim/test 필터 비대칭. 실장별 일별(SSOT `excludeSimulationPaymentRows`)만 test/sim 고객 결제 제외, 결제내역/담당자별/합계카드는 미제외 → 08-18 **3,900원**(test 고객 단건 3건) grand total 차. 08-20은 test 결제 0 → 차 없음.

- **원인③ (LATENT·표본일 0)**: 패키지 기간축 비대칭. 합계카드 total=**created_at**, 담당자별/실장별=**accounting_date**. 08-18/08-20은 두 축 일치(XOR 0행)라 미발화. 그러나 선수금/익일귀속 패키지가 있는 날(과거 census 7/134건 전례)엔 **합계카드 grand total ≠ 담당자별/실장별**로 발화 가능 → 재발 방지 위해 함께 정합 필요.

**배제된 가설**
- 가설(b) attributed_staff_id snapshot dangling/귀속누락: **배제**. 08-18/08-20 per-staff net이 live-assigned vs snapshot 축에서 **완전 동일**(attr_null 2·8건도 live fallback으로 정확 착지, 미지정 버킷 동일). 귀속 누락·오귀속 없음.
- 가설(c) 별도 버그: 관측 delta 전량이 원인①②③로 설명됨(잔차 0). 미상 버그 없음.

---

## 4. 원인별 수정방향 제안 (fix 티켓 seed — 착수는 본 티켓 범위 밖)

- **FIX-①-A (권장·핵심)**: 일마감 수단별 basis **단일화**. 총괄이 합계카드에 GROSS(정상수납)를 명시 요청(ts 1787189374)한 이력이 있으므로, 택1 필요 —
  - (i) 담당자별 매출 소계·실장별 일별의 **수단별 라인도 GROSS(정상수납)로 통일** + 환불은 별도 박스로(합계카드와 동형), 또는
  - (ii) 합계카드 수단별을 **NET로 되돌려** 담당자별/실장별과 정합(총괄 GROSS 요청과 충돌 → **총괄 재확인 필수**).
  - → money-path 표시 결정 = **김주연 총괄 confirm + DA CONSULT(display-only이나 §85 drawer/§416 귀속 방화벽 영향 확인)** 게이트.
- **FIX-② (독립·소)**: sim/test 필터 **cross-surface 통일**(전 surface 제외 or 전 surface 포함 — 매출 KPI SSOT `foot_stats_revenue`와 정합 방향 권장 = 제외). DA CONSULT 경량.
- **FIX-③ (독립·잠복)**: 패키지 기간축을 합계카드도 accounting_date로 통일(담당자별/실장별과 일치)하거나, created_at 유지가 마감 payload INV5 게이트 바인딩(주석 L481-485) 때문이면 **문서화+표시 주석**으로 발산 방지. → DA CONSULT(마감 payload 축 불변 제약 확인).

---

## 5. 재현 (evidence)
- `scripts/T-20260820-foot-CLOSING-TRISURFACE-SALES-BASIS-RECONCILE-DIAG_census_readonly.mjs` — surface별 소스/축/필터 census (DIV-1~5)
- `..._census2_readonly.mjs` — sim(DIV-3)·rebucket per-method(DIV-6)·per-staff 귀속(DIV-4)
- `..._census3_readonly.mjs` — **live 표시값 재현**(GROSS vs NET)·delta 실측 (§2 표 산출)
- 실행: `SUPABASE_ACCESS_TOKEN=… node scripts/…_census3_readonly.mjs`
