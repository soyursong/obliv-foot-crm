# RedPay TID 양방향 대사 census (T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE)

- 생성: 2026-07-28T17:42:41.169Z · 도메인: foot · window: 최근 7일
- bizno(union): 511-60-00988 ∪ 457-23-00938 · API items: 318 · registry rows(active): 27
- 방법: 양방향 — (정방향) registry→API / (역방향) API→registry(=침묵 미탐 후보). read-only, registry SSOT 무접촉.

## 요약 (verdict 분포)

| verdict | 건수 | 의미 |
|---|---|---|
| active | 16 | 등재 active + API 거래 (정상) |
| superseded | 1 | 구 TID remap 후 잔존 거래 (membership 흡수·정상) |
| absent | 11 | 등재 active인데 API window 무거래 (휴면/미거래 후보) |
| DB-only | 12 | 구 TID·무거래 (정상 소멸) |
| **API-only** | **18** | **★registry 미등재인데 거래中 (역방향) — merchant-center 렌즈로 정밀 분리** |

### 역방향(API→registry) 정밀 분류 — merchant-center 렌즈
> bizno union(511∪457)은 센터 공유 → API-only TID 를 merchant_id 로 재분류. **foot merchant 인데 TID 미등재 = 진짜 침묵 미탐(매출 누락 위험)**, 타센터 merchant = 정상 부재.

- ★★ **foot silent-miss (진짜 위험, foot merchant·TID 미등재)**: **0건** (foot 매출 침묵 미탐 없음)
- ⓘ cross-center/other (타센터 단말, foot registry 정상 부재): 18종 — 1047479115, 1047479124, 1047479137, 1047479365, 1047535752, 1047535754, 1047535760, 1047535764, 1047535781, 1047535793, 1047535794, 1047538144, 1047538148, 1047538179, 1047538193, 1047538194, 1047538206, 1047538207
- absent(등재 active·API window 무거래, 휴면 후보): 1047479148, 1047479155, 1047479157, 1047479261, 1047479264, 1047479469, 1047479473, 1047479476, 1047479479, 1047479481, 1047479483

## 전수 목록 (TID × 방향별 상태)

| TID | registry | API | 방향 | verdict | merchant(API-only) |
|---|---|---|---|---|---|
| 1047479115 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777276003 |
| 1047479124 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777281010 |
| 1047479137 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777281001 |
| 1047479148 | active | — | forward(registry→API) | absent |  |
| 1047479153 | active | seen | forward(registry→API) | active |  |
| 1047479155 | active | — | forward(registry→API) | absent |  |
| 1047479157 | active | — | forward(registry→API) | absent |  |
| 1047479158 | active | seen | forward(registry→API) | active |  |
| 1047479254 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479255 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479261 | active | — | forward(registry→API) | absent |  |
| 1047479262 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479263 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479264 | active | — | forward(registry→API) | absent |  |
| 1047479268 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479365 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777279009 |
| 1047479469 | active | — | forward(registry→API) | absent |  |
| 1047479471 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479472 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479473 | active | — | forward(registry→API) | absent |  |
| 1047479474 | superseded | seen | forward(registry→API) | superseded |  |
| 1047479475 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479476 | active | — | forward(registry→API) | absent |  |
| 1047479477 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479478 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479479 | active | — | forward(registry→API) | absent |  |
| 1047479480 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479481 | active | — | forward(registry→API) | absent |  |
| 1047479482 | superseded | — | forward(registry→API) | DB-only |  |
| 1047479483 | active | — | forward(registry→API) | absent |  |
| 1047535752 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777269002 |
| 1047535754 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777269003 |
| 1047535760 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777269007 |
| 1047535764 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777277001 |
| 1047535781 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777277002 |
| 1047535793 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777277006 |
| 1047535794 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777277007 |
| 1047535797 | active | seen | forward(registry→API) | active |  |
| 1047535835 | active | seen | forward(registry→API) | active |  |
| 1047535837 | active | seen | forward(registry→API) | active |  |
| 1047535842 | active | seen | forward(registry→API) | active |  |
| 1047535843 | active | seen | forward(registry→API) | active |  |
| 1047535845 | active | seen | forward(registry→API) | active |  |
| 1047538144 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777275006 |
| 1047538148 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777274006 |
| 1047538179 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777279004 |
| 1047538193 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777279022 |
| 1047538194 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777280001 |
| 1047538206 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777279007 |
| 1047538207 | — | seen | reverse(API→registry) | API-only→cross-center/other | 1777280007 |
| 1047538231 | active | seen | forward(registry→API) | active |  |
| 1047538235 | active | seen | forward(registry→API) | active |  |
| 1047538236 | active | seen | forward(registry→API) | active |  |
| 1047538237 | active | seen | forward(registry→API) | active |  |
| 1047538239 | active | seen | forward(registry→API) | active |  |
| 1047538241 | active | seen | forward(registry→API) | active |  |
| 1047538245 | active | seen | forward(registry→API) | active |  |
| 1047538246 | active | seen | forward(registry→API) | active |  |

> registry SSOT 무접촉(read-only). 편입/정정 판단은 planner/DA 게이트. 본 표는 census diff evidence.
