# T-20260727 선결질문 회신 — stored `customers.visit_type` recency-우회 read-path 조사 (READ-ONLY)

**질문(planner)**: 2A(recency 코드수정) 후 stored `customers.visit_type` 를 **직접 읽는(recency 우회) 경로가 존재하는가?**

## 결론 요약
- **recency-우회 read-path 는 존재한다(stored 완전 vestigial 아님).** 단 **전부 fallback/부차 위치**이며, **현장이 신고한 과다집계 화면(직원별 누적 = Assignments)의 카운트 소스는 아니다.**
- ∴ **2A(코드) 단독으로 신고된 과다집계(AC4)는 완전 교정된다.** 2B(stored 백필)는 **위생성(hygiene)** — **2A 검증 후 defer 가능**. (완전 불요는 아님 — 아래 잔여경로 때문에 별도 소진 권고.)
- **freeze 대상범위 교정**: 2B를 하면 그레인은 **customers 테이블(고객단위)** = jongno returning **312건**(07-27 기준, 재평가 대상). **7월창 221(check_in record_id 그레인)과 다른 축**. → **rows-affected 검증기준 221 은 2B(stored)에 적용 불가**. §4 참조.

---

## 1. 과다집계 화면(Assignments 직원별 누적) — stored 직접 read **없음** ✅
`src/pages/Assignments.tsx`
- `load()` 에서 `customers.visit_type` 를 select(L361-363, L411-413) 하지만, **직후 `resolveVisitTypesByRecency` 결과로 map 의 visit_type 을 전량 override**(L370-374 / L417-421).
- 카운트 파생(`monthAxisOf`→`deriveConsultAxis`, L569-570)은 override된 값만 사용. **stored 값은 카운트에 도달하지 않음.**
- recency 조회 실패 시 폴백도 `'returning'` 상수(stored 아님, visitRecency.ts L167).
- ∴ 신고 과다집계 = **100% recency(2A) 문제**. stored UPDATE 해도 이 화면은 안 바뀜(Phase1 경고 재확인).

## 2. recency-우회 read-path (stored 직접 사용) — 존재하나 부차 ⚠
| 위치 | 사용 | recency 우회? | stored 오염 영향 |
|---|---|---|---|
| `Closing.tsx` L853-856, L894-896 | 일마감 초진/재진 열: `ci?.visit_type ?? … ?? cust?.visit_type` | 예(recency 미사용) | **최후 폴백만** — 1순위=`check_ins.visit_type`(접수 스냅샷). RECLASS/EDGE 건은 ci 스냅샷='new' 라 폴백 도달 거의 없음 → 실영향 미미 |
| `Customers.tsx` L238, L1543 | 고객목록 담당자 자동연동(재진→지정staff 표시 / 첫방문(NULL)→공란) | 예 | stored 'returning' 이면 첫방문에도 담당자 자동표시 = **표시 왜곡(cosmetic)** |
| `CustomerChartPage.tsx` L5705 | 2번차트 초진/재진 배지 `recencyVisitType ?? customer.visit_type` | **아니오(recency 1순위)** | stored 는 recency async 해소 전 **찰나 폴백**만. 사실상 recency 구동 |

- `Packages.tsx`(select `*`) : visit_type 로 초진/재진 표시/분기 **없음** = vestigial.
- `Dashboard.tsx` 초진 딱지 : `checkIn.visit_type`(check_ins 스냅샷) 사용 — **customers.visit_type 아님**.

## 3. 판정
- stored `customers.visit_type` 는 **완전 vestigial 아님**(Closing 최후폴백 · Customers 담당자열 = 진짜 recency-우회 read).
- 그러나 **어느 것도 과다집계 소스가 아니고 전부 부차/폴백** → **2A 우선, 2B 는 위생 백필로 defer 가능**.
- 권고: 2A 배포·검증(AC4/AC5) → 그 후 별도 위생 티켓으로 stored 백필(Closing 폴백·Customers열 잔여 왜곡 제거). 급하지 않음.

## 4. ★ freeze 그레인 교정 (planner 검증기준 재고 요청)
- **221 = check_in record_id 그레인**(과다집계된 배정 레코드) → **2A 코드가 교정**(DB write 아님, rows-affected 개념 N/A).
- **2B(stored 백필)은 customers 그레인** → 대상 = jongno `visit_type='returning'` **312건**(07-27 기준, Phase1 시점 309 → 반나절 만에 +3, "완료 시 영구 returning 승격" 레거시로 **실시간 증가 중**), 이를 **교정 recency 로 재평가**해 first-timer 만 'new' 로.
- RECLASS 221 의 **distinct customer = 217명**(박성주 등 3명이 다건). → 221 ≠ 217 ≠ 312. **세 숫자가 다른 그레인**.
- ∴ 티켓 frontmatter/HOLD 의 "Phase2 rows-affected 검증기준 = 221 고정" 은 **check_ins 그레인 write 를 전제할 때만 유효**. stored(customers) 백필을 택하면 검증기준을 **customers 그레인(312 재평가 후 실제 flip 건수)** 으로 재설정해야 함. 백필 SOP 상 대상셋 freeze 를 customers 그레인으로 재-freeze 필요.

## 5. 크로스-CRM 이식성(참고)
- 결함 본질 = `resolveVisitTypesByRecency` 의 상한경계가 **'오늘 자정'** 이라 **과거날짜 자기 첫 완료방문**을 배제 못 함(당일만 배제). 2A = 상한을 **"판정대상 방문의 자기 check_in 시각"** 으로.
- `visitRecency.ts` 는 도메인 독립 순수모듈(classifyVisitByRecency + 배치) → 경계 파라미터화로 타 포크(derm/body/scalp/women/crm) 이식 용이. body VISITTYPE-CONTAM 선례와 동형. (cross-CRM 표준화 CONSULT 는 planner 별도 발행 대기.)
