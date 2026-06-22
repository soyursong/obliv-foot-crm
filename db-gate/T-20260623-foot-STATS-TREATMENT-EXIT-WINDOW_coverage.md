# T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW — room-exit 전이 과거 coverage 실측 증거

- **목적**: DA CONSULT-REPLY(MSG-20260623-024824-hhog) PART2 **조건2(시계열 단절 정책)** 분기 드라이버 측정.
- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm PROD), read-only, 쓰기 0건.
- **스크립트**: `scripts/T-20260623-foot-TREATMENT-EXIT-WINDOW_coverage.mjs`
- **실측 시각**: 2026-06-23

## 결론 (조건2 답)
> **신규 종료이벤트 coverage 충분 → 과거 recompute(backfill)로 단일 정의 시계열 유지 가능 (DA 권장 경로).**
> room_id 의존이 아니므로 DA가 우려한 "room_id 0% → backfill 불가" 케이스는 **본 정의에 해당 없음.**

## 1. room_id 비의존 — DA 우려 해소
- `status_transitions.room_id` 채움률 = **0.0% (2319행 중 0행)** ← DA 06-21 텔레메트리 감사 재확인.
- **그러나** 신규 측정창 종료점 = `from_status='preconditioning'`(치료실 슬롯을 떠나는 최초 전이) = **status 전이값 기반**. room_id를 일절 참조하지 않음(0612 GATE_HOLD 마이그 L94-95: `MIN(transitioned_at) FILTER (WHERE from_status='preconditioning')`).
- ∴ room_id 0%는 본 backfill에 **영향 없음**. DA가 명시한 "status 전이값(from/to_status)이면 영향 적음" 케이스에 해당.

## 2. 신규 종료이벤트 from_status='preconditioning' 월별 적재 (transitioned_at, KST)
| 월 | 건수 |
|----|----|
| 2026-05 | 131 |
| 2026-06 | 240 |

→ status_transitions 데이터 시작(**2026-05-07**)부터 전 기간 적재. foot은 신규 지점이라 **전체 시계열이 단일 정의로 recompute 가능** (deep history 부재 = 단절 우려 없음).

## 3. 구 종료이벤트 to_status='laser' 월별 적재 (비교)
| 월 | 건수 |
|----|----|
| 2026-05 | 99 |
| 2026-06 | 160 |

## 4. check_in 단위 windowable rate (치료실 진입 보유 체크인 = 227)
| 종료 정의 | 측정 가능 체크인 | 비율 |
|----------|--------------|------|
| 구(laser 종료, to_status='laser') | 129 | **56.8%** |
| 신(치료실퇴실, from_status='preconditioning') | 213 | **93.8%** |

→ 신규 정의가 **+37.0pp** 더 포착. 차이분 = 레이저실 미방문 세션(치료실→done, 치료실→힐러 등) — 김주연 총괄 정정 의도와 정확히 일치(현 laser 종료조건이 통째 누락하던 세션).

## 5. 숫자 이동 규모 (전체기간·전클리닉, summary RPC lineage 동일)
| 정의 | treatment_count | avg_treatment_minutes |
|------|-----------------|----------------------|
| 구(laser 종료) | 11 | **14.7분** |
| 신(치료실퇴실) | 14 | **37.3분** |

- Δ treatment_count = **+3**, 평균치료시간 **14.7분 → 37.3분 (약 2.5배 ↑)**.
- 평균이 크게 오르는 이유: 레이저실 진입은 치료실 체류 초반에 발생 → 구 정의는 체류 일부만 측정. 신 정의는 치료실 전체 체류시간을 포착.
- ★ **숫자 이동이 큼 → 조건5(현장 사전고지) 필수성 강화.** "이 날짜부터 평균치료시간이 약 2.5배로 보이는 건 정의 개선(치료실 전체 체류 포착)" 안내 동반 의무.
- (linked count가 작은 것은 package_session 정밀매칭 lineage 필터 때문 — 표본 작아 절대치보다 **방향·배율**이 의미. 운영 누적 시 표본 증가 예상.)

## 6. status_transitions 데이터 범위
- MIN transitioned_at = 2026-05-07T11:50:20Z, MAX = 2026-06-22T11:08:01Z, 총 2319행.

## 권고 (dev-foot → DA 조건2 답신)
- **recompute(backfill) 경로 권장**: 전 기간 from_status='preconditioning' 적재 완비 + room_id 비의존 → 단일 정의 시계열 유지 가능. effective_date 경계·혼합 추세선 불요(전 기간 단일 정의 재계산).
- 단, 적용 자체는 본 게이트 티켓의 **AC1(김주연 product 결정 A/B)** 선행. 현행 blocked(human_pending) 유지. product GO(B안) 시에만 AC2~ 진행.
- summary RPC는 STABLE 함수(데이터 무변경, 조회 시 재계산) → 별도 backfill 배치 불요. RPC 정의 교체만으로 과거·현재 전 구간이 신 정의로 재계산됨(= recompute 자동).
