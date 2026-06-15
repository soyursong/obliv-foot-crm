# T-20260615-foot-RESVMGMT-REFIX-8 AC7 — registrar_name null 자가검증 (read-only)

- prod: rxlomoozakkjesdqjtvd · 실행일: 2026-06-15
- 스크립트: `scripts/T-20260615-foot-REFIX8-AC7_registrar_null_check.mjs`
- 지시: planner FIX-REQUEST MSG-20260615-134257-58f6 (배포 2026-06-11 이전/이후 null 비율 (a)/(b) 분기)

## [1] 배포 이전/이후 생성분 registrar_name null 비율
| period | total | name_filled | null_pct |
|--------|------:|------------:|---------:|
| AFTER (>=2026-06-11)  | 261  | 1 | 99.6% |
| BEFORE (<2026-06-11)  | 1092 | 0 | 100.0% |

## [3] write 버그 시그니처 (registrar_id 有 & registrar_name 無 = 스냅샷 누락)
| has_registrar_id | id_but_no_name | has_registrar_name |
|-----------------:|---------------:|-------------------:|
| 1 | **0** | 1 |

## [4] 배포 이후 & registrar_id 부여분의 name 채움
| after_with_id | after_with_id_and_name |
|--------------:|-----------------------:|
| 1 | 1 |

## 결론 — (a)도 (b)도 아닌 '구조적 미수집'
- **write 경로 회귀 아님(NOT b)**: `id_but_no_name=0`, 부여된 1건은 id+name 모두 정상 적재([4] 일치) → route-save 스냅샷 write 무결.
- **코드증거**: `createReservationCanonical`(생성 단일소스, Reservations.tsx:211-231 insert 페이로드)에 registrar_id/registrar_name **필드 자체가 없음** → 신규예약은 생성 시점에 registrar 미수집 = 기본 NULL.
- `registrar_name`은 **기존 예약 대상 수동 route-save**(ReservationDetailPopup.tsx:790-791, 예약등록자 선택→영속)에서만 채워짐. 현장은 이 수동 할당을 거의 안 씀 → 전 기간 99.6~100% null(배포 무관).
- **FE 정상**(렌더 `@{registrar_name}` 조건부, null이면 미표시가 의도). 데이터 미적재는 백필 공백이 아니라 '생성시 수집 경로 부재'가 원인.
- **판단 필요(planner)**: 현장이 '등록자 자동표시'를 기대하면 = 생성시점에 로그인 등록자 capture 하는 **신규 기능**(createReservationCanonical에 registrar 주입)이 필요. 회귀 fix 아님. → AC7 close + 별도 feature 티켓 분기 여부 planner 결정.
