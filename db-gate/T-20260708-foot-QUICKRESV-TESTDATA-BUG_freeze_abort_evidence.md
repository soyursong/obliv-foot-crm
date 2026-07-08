# T-20260708-foot-QUICKRESV-TESTDATA-BUG — freeze SELECT + ABORT evidence

- prod: rxlomoozakkjesdqjtvd | 2026-07-08 (KST) | mode: SELECT-freeze only (DELETE 미실행)
- 결론: **ABORT** — SCOPE-LOCK abort gate("5557 미매칭 시 abort") 발동. 삭제 0건.

## [1] freeze SELECT — customers WHERE name LIKE '접수테스트%'
- 전체 후보: 1건
  - 접수테스트2 / +821066694447 / tail=4447 / F-4510 / created 2026-07-08T02:29:53Z  ← **보존 대상(PRESERVE)**
- FREEZE(tail 5557, 삭제 대상 customers): **0건** ← 티켓 가정(1건)과 불일치, 5557 미매칭 → ABORT

## [2] 5557 테스트 데이터 실체 — reservations only (orphan)
- reservations WHERE customer_name LIKE '접수테스트%': 2건
  - id=229caeff-24ed-4b04-a076-6c7a19fd3481 | name=접수테스트 | phone=+821066675557 (tail 5557) | status=confirmed | **customer_id=NULL**  ← 5557 테스트 데이터, 그러나 customers 부모 없음(orphan)
  - id=fd13ce8b-e5fe-40f3-8997-f0e1cc6588b2 | name=접수테스트2 | phone=+821066694447 (tail 4447) | status=checked_in | customer_id=41c2852c(=접수테스트2/F-4510)  ← 보존 대상, 무접촉
- FK reservations(customer_id ∈ freeze set): 0건 (freeze set 자체가 빈 집합)

## [3] ABORT 판정
- SCOPE-LOCK 삭제 집합 = "customers 행(name=접수테스트, tail 5557) + FK 연결 reservations". 해당 customers 행 미존재.
- orphan reservation 229caeff는 customer_id=NULL → "FK 연결 reservations"가 아님. 삭제 시 reporter 확정 집합 이탈 = 추정 scope 확장.
- 교훈 T-20260707-body-TESTDATA-PURGE: freeze한 id 집합만 삭제, 추정/count 삭제 금지.
- → archive-first DELETE 미착수. planner FOLLOWUP으로 정정 대상 재확인 요청.

## [4] 보존 무결성 확인
- 접수테스트2 (customers 41c2852c / F-4510 / 4447) 잔존 OK, 무접촉.
- 연결 reservation fd13ce8b(checked_in) 무접촉.

## 제안 (reporter 재확인 필요)
- 만약 의도가 "접수테스트/5557 빠른예약 테스트 데이터 제거"라면, 실 삭제 대상은 **reservations id=229caeff 단 1건(orphan)** 으로 정정 필요.
- archive-first(백업)+단건 DELETE(reservations만, customers 무접촉) 로 안전 실행 가능. reporter(김주연 총괄) 단건 id 재확인 후 착수.
