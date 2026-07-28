# RedPay TID 양방향 대사 census (금액 포함) — T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE

- 생성: 2026-07-28T18:13:22.488Z · 도메인: foot · window: 최근 14일
- bizno(union): 511-60-00988 ∪ 457-23-00938 · API items: 496 · DB rows: 332 · registry rows(active): 27
- "우리" 기준 = **DB 실거래 TID**(7/15~28 거래 있던 TID). 방법: 양방향 + ★금액(net) 산출. read-only, registry SSOT 무접촉.

## ★ 총괄 확인용 요약 — 양쪽 개수 + 금액

| 방향 | 분류 | 개수 | net 금액 |
|---|---|---|---|
| 정방향 (a) 우리DB→API | forward-db-only (DB 적재·API window 무거래 = 즉시누락 후보) | 0 | ₩0 |
| 역방향 (b) API→우리DB | ★ foot-silent-drop (foot merchant·미적재 = 진짜 매출누락) | 1 | ₩0 |
| 역방향 (b) API→우리DB | cross-center (타센터 단말·foot 정상 부재) | 24 | ₩74,312,690 |
| 역방향 (b) API→우리DB | unknown (merchant 미상·조사 필요) | 0 | ₩0 |

> **판정 신호**: forward-db-only=0 · foot-silent-drop=1 → 두 값 모두 0 이면 "지금 매출 빠지는 중 아님". foot-silent-drop>0 이면 ₩0 규모 즉시 조사.

### 정방향 (a) forward-db-only 실목록 (DB 적재인데 API 무거래)
- **0건** (DB 적재 TID 전부 API 에도 존재 = 정방향 즉시누락 없음)

### 역방향 (b) API-only 실목록 (merchant 렌즈: 휴면(foot) vs 타센터)
- ★★ foot-silent-drop (진짜 위험): 1047479158(m:1777289012, 2건 ₩0)
- ⓘ cross-center (타센터 정상 부재): 24종 — 1047479124(₩0), 1047479137(₩0), 1047479218(₩0), 1047479317(₩2,440,000), 1047479331(₩0), 1047479340(₩1,520,000), 1047479341(₩10,000), 1047479358(₩0), 1047479365(₩8,673,100), 1047479372(₩0), 1047479395(₩236,000), 1047535752(₩20,000), 1047535754(₩50,000), 1047535760(₩610,000), 1047535764(₩3,507,900), 1047535781(₩12,972,850), 1047535793(₩6,206,680), 1047535794(₩5,011,200), 1047538148(₩2,087,400), 1047538179(₩2,664,560), 1047538193(₩603,900), 1047538194(₩998,700), 1047538206(₩26,523,400), 1047538207(₩177,000)

## 참고 — registry-vs-API verdict 분포(기존 5-status, 연속성 유지)

| verdict | 건수 | 의미 |
|---|---|---|
| active | 20 | 등재 active + API 거래 |
| superseded | 7 | 구 TID remap 후 잔존 거래(정상) |
| absent | 7 | 등재 active·API window 무거래(휴면 후보) |
| DB-only | 6 | 구 TID·무거래(정상 소멸) |
| API-only | 26 | registry 미등재·API 거래中(역방향) |
| DB-txn-only | 0 | registry·API 없고 DB거래만(정방향 (a) 후보) |

## 전수 목록 (TID × 방향·verdict·flow·금액)

| TID | registry | API | DB | verdict | flow | merchant | API(건/net) | DB(건/net) |
|---|---|---|---|---|---|---|---|---|
| 1047479115 | — | seen | recorded | API-only | captured | 1777276003 | 2/₩0 | 2/₩0 |
| 1047479124 | — | seen | — | API-only | reverse-api-only→cross-center | 1777281010 | 2/₩0 | 0/₩0 |
| 1047479137 | — | seen | — | API-only | reverse-api-only→cross-center | 1777281001 | 4/₩0 | 0/₩0 |
| 1047479148 | active | — | — | absent | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479153 | active | seen | recorded | active | captured | 1777289013 | 2/₩0 | 2/₩0 |
| 1047479155 | active | — | — | absent | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479157 | active | — | — | absent | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479158 | active | seen | — | active | reverse-api-only→foot-silent-drop | 1777289012 | 2/₩0 | 0/₩0 |
| 1047479218 | — | seen | — | API-only | reverse-api-only→cross-center | 1777277015 | 2/₩0 | 0/₩0 |
| 1047479254 | superseded | — | — | DB-only | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479255 | superseded | — | — | DB-only | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479261 | active | — | — | absent | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479262 | superseded | — | — | DB-only | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479263 | superseded | — | — | DB-only | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479264 | active | — | — | absent | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479268 | superseded | — | — | DB-only | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479317 | — | seen | — | API-only | reverse-api-only→cross-center | 1777274007 | 6/₩2,440,000 | 0/₩0 |
| 1047479331 | — | seen | — | API-only | reverse-api-only→cross-center | 1777274008 | 2/₩0 | 0/₩0 |
| 1047479340 | — | seen | — | API-only | reverse-api-only→cross-center | 1777275007 | 3/₩1,520,000 | 0/₩0 |
| 1047479341 | — | seen | — | API-only | reverse-api-only→cross-center | 1777275008 | 1/₩10,000 | 0/₩0 |
| 1047479358 | — | seen | — | API-only | reverse-api-only→cross-center | 1777279005 | 2/₩0 | 0/₩0 |
| 1047479365 | — | seen | — | API-only | reverse-api-only→cross-center | 1777279009 | 31/₩8,673,100 | 0/₩0 |
| 1047479372 | — | seen | — | API-only | reverse-api-only→cross-center | 1777279015 | 8/₩0 | 0/₩0 |
| 1047479395 | — | seen | — | API-only | reverse-api-only→cross-center | 1777280009 | 2/₩236,000 | 0/₩0 |
| 1047479469 | active | — | — | absent | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479471 | superseded | seen | recorded | superseded | captured | 1777288003 | 20/₩9,588,000 | 20/₩9,588,000 |
| 1047479472 | superseded | seen | recorded | superseded | captured | 1777288004 | 2/₩63,000 | 2/₩63,000 |
| 1047479473 | active | seen | recorded | active | captured | 1777288005 | 14/₩6,640,000 | 14/₩6,640,000 |
| 1047479474 | superseded | seen | recorded | superseded | captured | 1777288006 | 9/₩860,000 | 9/₩860,000 |
| 1047479475 | superseded | seen | recorded | superseded | captured | 1777288008 | 2/₩0 | 2/₩0 |
| 1047479476 | active | — | — | absent | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479477 | superseded | seen | recorded | superseded | captured | 1777289003 | 1/₩4,400,000 | 1/₩4,400,000 |
| 1047479478 | superseded | seen | recorded | superseded | captured | 1777289004 | 29/₩211,440 | 29/₩211,440 |
| 1047479479 | active | seen | recorded | active | captured | 1777289005 | 6/₩339,000 | 6/₩339,000 |
| 1047479480 | superseded | seen | recorded | superseded | captured | 1777289006 | 22/₩499,000 | 22/₩499,000 |
| 1047479481 | active | seen | recorded | active | captured | 1777289007 | 15/₩2,434,000 | 15/₩2,434,000 |
| 1047479482 | superseded | — | — | DB-only | no-txn |  | 0/₩0 | 0/₩0 |
| 1047479483 | active | seen | recorded | active | captured | 1777289001 | 3/₩28,100 | 3/₩28,100 |
| 1047535752 | — | seen | — | API-only | reverse-api-only→cross-center | 1777269002 | 2/₩20,000 | 0/₩0 |
| 1047535754 | — | seen | — | API-only | reverse-api-only→cross-center | 1777269003 | 5/₩50,000 | 0/₩0 |
| 1047535760 | — | seen | — | API-only | reverse-api-only→cross-center | 1777269007 | 2/₩610,000 | 0/₩0 |
| 1047535764 | — | seen | — | API-only | reverse-api-only→cross-center | 1777277001 | 1/₩3,507,900 | 0/₩0 |
| 1047535781 | — | seen | — | API-only | reverse-api-only→cross-center | 1777277002 | 6/₩12,972,850 | 0/₩0 |
| 1047535793 | — | seen | — | API-only | reverse-api-only→cross-center | 1777277006 | 9/₩6,206,680 | 0/₩0 |
| 1047535794 | — | seen | — | API-only | reverse-api-only→cross-center | 1777277007 | 1/₩5,011,200 | 0/₩0 |
| 1047535797 | active | seen | recorded | active | captured | 1777285007 | 8/₩2,580,000 | 8/₩2,580,000 |
| 1047535835 | active | seen | recorded | active | captured | 1777285006 | 9/₩6,300,000 | 9/₩6,300,000 |
| 1047535837 | active | seen | recorded | active | captured | 1777285005 | 10/₩25,870,000 | 10/₩25,870,000 |
| 1047535842 | active | seen | recorded | active | captured | 1777285003 | 6/₩770,000 | 6/₩770,000 |
| 1047535843 | active | seen | recorded | active | captured | 1777285002 | 57/₩6,457,060 | 57/₩6,457,060 |
| 1047535845 | active | seen | recorded | active | captured | 1777285001 | 14/₩508,000 | 14/₩508,000 |
| 1047538144 | — | seen | recorded | API-only | captured | 1777275006 | 25/₩4,745,570 | 25/₩4,745,570 |
| 1047538148 | — | seen | — | API-only | reverse-api-only→cross-center | 1777274006 | 8/₩2,087,400 | 0/₩0 |
| 1047538179 | — | seen | — | API-only | reverse-api-only→cross-center | 1777279004 | 11/₩2,664,560 | 0/₩0 |
| 1047538193 | — | seen | — | API-only | reverse-api-only→cross-center | 1777279022 | 10/₩603,900 | 0/₩0 |
| 1047538194 | — | seen | — | API-only | reverse-api-only→cross-center | 1777280001 | 6/₩998,700 | 0/₩0 |
| 1047538206 | — | seen | — | API-only | reverse-api-only→cross-center | 1777279007 | 36/₩26,523,400 | 0/₩0 |
| 1047538207 | — | seen | — | API-only | reverse-api-only→cross-center | 1777280007 | 2/₩177,000 | 0/₩0 |
| 1047538231 | active | seen | recorded | active | captured | 1777288004 | 23/₩17,260,000 | 23/₩17,260,000 |
| 1047538235 | active | seen | recorded | active | captured | 1777289003 | 2/₩20,000 | 2/₩20,000 |
| 1047538236 | active | seen | recorded | active | captured | 1777288003 | 18/₩6,180,000 | 18/₩6,180,000 |
| 1047538237 | active | seen | recorded | active | captured | 1777289004 | 5/₩1,460,000 | 5/₩1,460,000 |
| 1047538239 | active | seen | recorded | active | captured | 1777289006 | 12/₩11,410,000 | 12/₩11,410,000 |
| 1047538241 | active | seen | recorded | active | captured | 1777288006 | 11/₩9,070,000 | 11/₩9,070,000 |
| 1047538245 | active | seen | recorded | active | captured | 1777289008 | 3/₩26,600 | 3/₩26,600 |
| 1047538246 | active | seen | recorded | active | captured | 1777288008 | 2/₩10,200 | 2/₩10,200 |

> registry SSOT 무접촉(read-only). 편입/정정 판단은 planner/DA 게이트. 본 표는 census diff evidence.
