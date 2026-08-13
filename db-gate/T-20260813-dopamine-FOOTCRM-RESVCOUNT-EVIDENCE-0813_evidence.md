# T-20260813-dopamine-FOOTCRM-RESVCOUNT-EVIDENCE-0813 — 풋CRM authoritative 대조표 (READ-ONLY)

**dev-foot 회신 · 2026-08-13 · prod write 0 · DDL 0 · 배포 0 · SELECT만**
clinic = 서울오리진점(jongno-foot, 74967aea-a60b-4da3-a0e7-9c997a930bc8)
기간 = 2026-08-01 ~ 08-12 (양끝 inclusive)
산식 SSOT = `src/lib/stats.ts` fetchTmAggregate + tmAttributionKey / 화면 = 통계 > **TM집계 탭**(TmAggregateSection)

---

## ① 풋CRM 통계 화면 '정의' 공개 — 통계 > TM집계 탭

진운선 파트장이 대조하는 상담사별 예약수·내원수 화면 = **TM집계 탭**. 산식(코드 직인용):

### (a) count-predicate — 예약수 = INCLUDE(취소 포함)
- **예약수(scheduled)** = `reservations` where `reservation_date ∈ [from,to]`, **status 필터 없음 → 취소·노쇼 INCLUDE**.
  - 근거: `stats.ts` L488~493 (`// B: 예약수 (reservation_date, 취소 포함)` — 상태 필터 없음)
  - 화면 캡션(TmAggregateSection L303): "해당 기간에 잡혀있는 전체 예약 (취소 포함)"
  - → **도파민 표시축(INCLUDE) canon과 동일**. 이 축에서 RC(a) 불성립.
- **내원건수(visited)** = `check_ins` where `created_date ∈ [from,to]` AND `deleted_at IS NULL` AND `status != 'cancelled'`, `reservation_id` 기준 dedup(done 우선), 워크인 유지.
  - 근거: `stats.ts` L494~501, dedupVisited L438~450. (취소만 제외 = 롱레 no_show 등가물, 이탈 포함)

### (b) date-basis
- 예약수 = **예약일(reservation_date)** 기준 (등록일 아님). 타임존: date 컬럼(KST 저장).
- 내원 = **내원일(check_ins.created_date, KST 트리거 date)** 기준.
- (참고) 예약등록건수 = created_at 기준(KST +09:00 경계, L482~487).
- 경계 = **from/to 양끝 inclusive** (`gte(from).lte(to)`).

### (c) WHO 귀속 필드 — dopamine-origin = **registrar_name**
- 귀속 = `tmAttributionKey` (stats.ts L642~662):
  - `created_by` 有(원내 직원 등록) → `staff:{uid}` (직원명) — canonical.
  - **`created_by`=NULL + `source_system='dopamine'` + `registrar_name` 有 → `dop:{registrar_name}`** ← 도파민 TM 유입 예약이 여기 착지. **CEO-gated carve-out**(VARIANT, deployed 2026-07-24)로 dopamine 파티션 한정 registrar_name 을 display 버킷 분할키로 사용.
  - dopamine + registrar_name NULL → `__dopamine__`('도파민 등록') 단일 fallback.
- 내원 귀속 = 매칭 예약(reservation_id, registered∪scheduled)의 attribution; 미매칭 → 워크인.
- **∴ 도파민 상담사별 풋 숫자 = `registrar_name` 그룹.** (도파민 WHO축=cue_cards.counselor_id 과 identity-space 상이 — 이름으로 정렬됨.)

---

## ② authoritative 숫자 — TM집계 산식 그대로

raw: reservations(reservation_date window)=732 · registered(created_at)=1082 · check_ins raw=493 · visited(dedup)=493

TM 상담사(등록자) 버킷 (기본화면 = onlyMine/onlyTmRole OFF, 전 버킷):

| bucket | 예약등록 | 예약수 | 내원건수 | 내원율 |
|---|---:|---:|---:|---:|
| 이수빈 | 221 | **166** | **100** | 60.2% |
| 김효신 | 235 | **157** | **104** | 66.2% |
| 진운선 | 198 | **140** | **83** | 59.3% |
| 강솔희 | 170 | **100** | **62** | 62.0% |
| [도파민TM] 강솔희 (별 버킷) | 0 | 4 | 0 | 0.0% |
| 박민석(원내) | 72 | 53 | 43 | 81.1% |
| 김민경(원내) | 59 | 43 | 37 | 86.0% |
| 김지혜(원내) | 39 | 33 | 29 | 87.9% |
| 장예지(원내) | 37 | 16 | 13 | 81.3% |
| 김지윤(원내) | 13 | 14 | 3 | 21.4% |
| 워크인 | 0 | 0 | 16 | — |
| … (기타 원내 소수·도파민 등록 1) | | | | |
| **합계** | 1082 | 732 | 493 | |

---

## ③ Δ(도파민 − 풋) 부호 — **전원 동일부호 아님 · 사실상 0**

| 상담사 | 도파민예약 | 풋예약수 | Δ예약 | 도파민내원 | 풋내원 | Δ내원 |
|---|---:|---:|---:|---:|---:|---:|
| 이수빈 | 166 | 166 | **0** | 100 | 100 | **0** |
| 김효신 | 157 | 157 | **0** | 104 | 104 | **0** |
| 진운선 | 140 | 140 | **0** | 83 | 83 | **0** |
| 강솔희 | 103 | 100 | **+3** | 61 | 62 | **−1** |

**핵심 발견:**
1. **4명 중 3명(이수빈·김효신·진운선) 예약·내원 Δ = 0 (완전 일치).** 도파민 표시 숫자 = 풋 authoritative verbatim. → **'광역 divergence·전원 over' 전제가 예약수/내원수 축에서 미지지.** RC(a)(EXCLUDE mismatch) 불성립(둘 다 INCLUDE).
2. **강솔희만 Δ예약 +3 / Δ내원 −1** (부호 혼재, 미소). 원인 후보 = **registrar_name 정규화 split**: 풋에 `강솔희`(100/62)와 `[도파민TM] 강솔희`(4/0) **두 버킷 공존**. 도파민 counselor_id 는 이를 단일 귀속(103)하나 풋은 registrar_name 텍스트 접두("[도파민TM]") 차이로 별 버킷 분리 → WHO 축 identity-space 불일치가 강솔희에 국소 발현. (통합 시 풋 104/62 vs 도파민 103/61 = Δ+1/+1.)

**함의(planner RC 확정용):** 예약수/내원수 자체는 verbatim 정합. 잔여 divergence 는 (i) 강솔희 registrar_name 접두 변형에 의한 WHO-버킷 split(데이터 위생) 국소 건, (ii) 도파민 foot_reserved 재파생이 이 proxy 값과 다른 제3의 표시를 낸다면 그것은 dopamine-side 재파생 로직 문제(풋 authoritative 는 위 표가 정본).

---

## 가드 준수
- READ-ONLY. prod write 0 · 코드변경 0(제품코드 무수정) · 배포 0.
- 산출 스크립트(진단 아티팩트, SELECT-only): `scripts/T-20260813-dopamine-FOOTCRM-RESVCOUNT-EVIDENCE_census.mjs`
- 풋 registrar_name 은 표시 전용 — created_by/인센티브 산식 무접촉(§416 방화벽 유지).
