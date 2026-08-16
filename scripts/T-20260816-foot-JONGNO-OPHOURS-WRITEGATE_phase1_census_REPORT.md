# T-20260816-foot-JONGNO-OPHOURS-WRITEGATE — Phase 1 census REPORT (READ-ONLY)

target = jongno-foot only (obliv-foot-crm). songdo-foot·dopamine 코드 무접촉.
Phase 1 = READ-ONLY census + 게이트 스코프 권고. **write0·db_change0.** Phase 2(구현·배포)는 CEO 스코프 확정 後.

- prod ref: `rxlomoozakkjesdqjtvd`
- jongno clinic_id: `74967aea-a60b-4da3-a0e7-9c997a930bc8` (slug=jongno-foot, "오블리브의원 서울 오리진점")
- 러너: `T-20260816-...WRITEGATE_phase1_census_readonly.mjs`(v1) + `..._v2_readonly.mjs`(v2, reason/dow 분해). SELECT-only, PHI 컬럼 미조회.
- 표본: 최근 120일 예약(reservation_date >= 2026-04-18), n=2572.

## 운영창 정본 (clinic_operating_hours, effective_from 2026-09-01, 부모 T-20260815 deployed)

| dow | 요일 | open | close | last_booking_slot(INCLUSIVE) |
|-----|------|------|-------|------------------------------|
| 1~5 | 월~금 | 09:00 | 20:00 | **19:00** |
| 6 | 토 | 09:00 | 19:00 | **18:00** |
| 0 | 일 | — (행 없음 = **휴무**) | | |

out-of-window 판정 = closed_day(운영창 행 없는 요일) OR time<open OR time>last_booking_slot.

## 산출 1 — 신규예약 생성 경로 census

### 생성 경로 (전수, 2개뿐)
- **(a) 외부/도파민**: `reservation-ingest-from-dopamine` EF → `upsert_reservation_from_source` RPC(+fallback insert). `created_via`=source_system 매핑(기본 `dopamine`). **서버-대-서버, 생성시점 스태프 개입 0.**
- **(b) 스태프 직접입력**: FE 어드민 UI `supabase.from('reservations').insert({created_via:'manual'})`. site = `Reservations.tsx`(캘린더 저장/복사), `CustomerChartPage.tsx`(차트 미니예약 ×2), `Dashboard.tsx`. **전 경로 `created_via='manual'` 단일값.**
- 그 외 EF(dopamine-callback / dopamine-visitcall-receiver / checkin-visited-fire)는 reservations 를 SELECT/UPDATE만(신규 생성 없음).
- 실데이터 created_via = {`dopamine`, `manual`, `NULL`} 3종만 관측(aicc/naver/meta/kakao/inbound/selfbook/walkin = 최근 120일 0건).

### 버킷별 out-of-window 빈도 (신 운영창 소급 적용 = 게이트 발동 예상량)

| 버킷 | total | out-of-window | ≈건/월 | reason | visit_type(out) |
|------|-------|---------------|--------|--------|-----------------|
| (a) 외부/도파민 (`dopamine`) | 1735 | 53 | **13.3** | after_last_slot 52 / closed_day 1 | new 53 |
| (b) 스태프 (`manual`) | 638 | 27 | **6.8** | after_last_slot 25 / closed_day 2 | returning 19 / new 8 |
| (b') 스태프 레거시(`created_via`=NULL ∧ `source_system`=NULL, 生成前-fill) | 199 | 18 | 4.5 | after_last_slot 11 / closed_day 7 | new 11 / returning 7 |

- (a) 외부/도파민 out-of-window = **전량 신규환자·거의 전량 저녁 초과슬롯(19:xx=30, 20:xx=21)**. 클리닉이 더 이상 운영 안 하는 저녁 슬롯에 TM이 신규를 밀어넣는 패턴. 생성시점 CRM 스태프 판단 없음.
- (b) 스태프 out-of-window = **주로 저녁 after_last_slot(19:xx=21, 20:xx=4)·재진 우세(19 vs 8)** + 일요일(휴무) 2건. → 스태프가 재진 환자를 저녁에 수용하는 실 예외운영 패턴이 실재(≈1.6건/주). 전건 오류로 보기 어려움.
- (b') 레거시 NULL = created_via fill(T-20260628) 이전 손저작 스태프 행. 앞으로는 전건 `manual`로 수렴하는 소멸 tail. forward 스태프 추정치는 (b) `manual` 6.8/월을 기준.

## 산출 2 — 게이트 스코프 권고

| 축 | 권고 | 근거 |
|----|------|------|
| **(a) 외부/도파민** | **하드차단 (reject)** | 생성시점 스태프 판단 부재 = 게이트의 존재 이유 그 자체. TM이 비운영 슬롯을 서버로 밀어넣는 것을 막는 게 목표. 거부는 TM 화면에 뜨도록(guard #5, Phase2 AC) — silently 삼키면 안 됨. |
| **(b) 스태프 직접입력** | **(ii) 관리자/매니저 override (soft-block + override)** | (iii)하드차단=월 ~6.8건 실 예외운영(저녁 재진 수용)을 탈출구 없이 제거→과경직 + CEO guard #1로 배포 금지. (i)soft경고=무집행(누구나 통과→신 운영시간이 사실상 권고). **(ii)**=기본 스태프는 사유표시와 함께 차단·매니저/admin은 의식적 override 가능 → 실 예외 capacity 보존 + out-of-window를 '침묵 default'가 아닌 '인가된 예외'로 전환. |

> 세부 옵션(Phase 2): 스태프 (ii) 하에서 closed_day(일요일)와 after_last_slot을 동일 취급할지, closed_day는 더 엄격히 할지 = CEO 재량 여지. 본 권고는 스태프 전건 (ii) 균일 적용 baseline.

## HARD 가드 준수 (Phase 1)
1. 스태프 하드차단 배포 = 미착수 (gate_scope_ceo_confirmed 前 금지 준수). 본 산출은 census+권고뿐.
2. forward-only: 게이트는 reservation_date >= 2026-09-01 에만 (Phase 2 구현조건). census는 소급 '추정'일 뿐 무write.
3. 표시축 ⊥ 차단축: 기존예약 조회/표시/수정 무접촉. census는 SELECT-only.
4. 도파민 코드 무접촉. (foot측 수신 EF만 참조, 도파민 repo 무접촉.)
5. TM 거부메시지 실측 = Phase 2 AC로 이월. foot repo에 footPushErrorMessage/isFootLifecycleReject 심볼 부재 → 도파민(TM)측 렌더 경로일 개연 → Phase 2에서 크로스-repo 실측 필요.
6. change-class 예상 = 서버 로직 추가(DDL 0). 읽기소스 clinic_operating_hours 旣존 → 신규 컬럼/테이블 불요. 단 enforcement layer로 DB trigger 택 시 CREATE FUNCTION/TRIGGER = DDL → supervisor MIG-GATE+GO-token 선행(Phase 2 설계 결정).

## 회신 경로
Phase 1 산출 → planner 회신 → CEO 큐 제출 → gate_scope_ceo_confirmed=true 후 Phase 2 착수.
