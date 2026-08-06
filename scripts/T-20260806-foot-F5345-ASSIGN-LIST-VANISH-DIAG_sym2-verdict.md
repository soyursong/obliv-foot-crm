# F-5345 배정명단 소실 진단 — 증상2 fold-in / same-vs-distinct 판정

티켓: T-20260806-foot-F5345-ASSIGN-LIST-VANISH-DIAG (기존 진단에 fold, 신규 티켓 아님)
근본원인 P0: T-20260806-foot-ASSIGN-CONFIRM-EF-NON2XX-P0
데이터 근거: probe3-sym2 (read-only, service_role, 2026-08-06)

## 판정: SAME root cause (증상2 ⊂ P0 thrash 다운스트림). 별개 write-path 버그 아님.

두 증상은 **같은 테이블(check_ins) · 같은 컬럼(consultant_id) · 같은 명단 read-술어**를 공유한다.
배정명단(Assignments.tsx '금일 배분 이력') membership 은 오직
`check_ins(deleted_at IS NULL, status NOT IN (done,cancelled), checked_in_at>=today)` 로만 구성.
`customers.assigned_staff_id`(영구 담당자)는 membership 소스가 **아님** — 이미 명단에 든 고객의 표시축 파생용 2차 lookup 일 뿐.

### 증상1 (진이서 배정 후 소실) = write 성공 후 row 배제
- 배정 저장 정상(consultant_id 기록). 소실 = 당일 check_in 이 status=cancelled + deleted_at(soft-hide) 로 전환 → 명단 read-술어가 배제.
- P0 EF non-2xx(확정 차단 → send-consult-notify channel_not_found) → 스태프 thrash(15분내 7회 재배정·4건 무더기 soft-delete) 다운스트림.

### 증상2 (2번 차트 담당자 등록 → 명단 미반영) = 하향전파 short-circuit
- 차트 '담당자 등록' = `updateTodayOpenCheckInConsultant()` (CustomerChartPage.tsx:3689).
  영구 `customers.assigned_staff_id` write + **latestCheckIn(React state) 이 당일·open(status≠done,≠cancelled)일 때만** check_ins.consultant_id 로 하향전파. 그 외 전부 `'none'` 반환 → 명단행 미갱신.
- 명단은 check_ins 를 read → 하향전파가 'none' 이면 미반영.

## 실데이터 확증 (probe3-sym2) — 2a(=P0) 확정, 2b(설계 gap) 부재

소실 클러스터 4건 전원 동일 thrash 지문:
| 고객 | OLD check_in(소실) | NEW open 재접수 | 컬럼 차이 |
|------|------|------|------|
| 신미수 | 05:13 cancelled+deleted, 진이서(6557) | 05:20 consultation, **9172**(다른상담사) | consultant 상이 |
| 지부환 | 05:13 cancelled+deleted, 42d6 | 05:20 preconditioning, 42d6 | 동일 |
| 이돈우 | 05:15 cancelled+deleted, 진이서(6557) | 05:36 preconditioning, 진이서(6557) | 동일 |
| 정진아 | 05:13 cancelled+deleted, 진이서(6557) | 05:21 preconditioning, **ffff**(다른상담사) | consultant 상이 |

- 4명 전원 **당일-open check_in 존재** → 설계상 gap 케이스(2b: 당일 check_in 자체 없음)는 라이브에 **없음**.
- 즉 증상2 = **2a 케이스**: cancel→재접수 churn 중 차트의 `latestCheckIn` state 가 (a)cancelled 된 구 check_in 을 가리켜 하향전파가 'none' 이 되거나, (b)신규 open check_in 이 다른 상담사/오토배정으로 잡혀 차트 담당자등록(진이서)이 명단에 안 실림. **신미수·정진아**가 실제로 신규 open 의 consultant 가 진이서가 아닌 타 상담사 = 증상2 현물.
- 이 전파 short-circuit 은 **P0 thrash(cancel/재접수 churn)** 없이는 발생하지 않음.

## 결론 & hotfix 권고
- **hotfix = P0(ASSIGN-CONFIRM-EF-NON2XX) 단일 fix.** 확정 성공 → thrash 소멸 → cancel/재접수 churn 정지 → 차트 latestCheckIn 이 유효·open 유지 → **증상1 read 포함 + 증상2 하향전파 정상 동시 해소.** 금일 초진 배정 차단(라이브 blocker)도 여기서 풀림.
- 증상2 는 별개 근본원인이 아니라 **P0 churn 이 노출시키는 2차 FE-staleness 취약**(차트 latestCheckIn stale 시 하향전파 silent 'none' + customers.assigned_staff_id 만 silent 갱신). P0 없이는 미발화 → 신규 티켓 불요. 단 P0 fix 후에도 이 stale-state 하향전파 취약을 latent 로 남길지 여부는 planner lifecycle 판단(별도 P2 후보, 본 회신에서 티켓 생성 안 함).
