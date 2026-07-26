# T-20260726-foot-SILJANG-RANKING-CONTAM-DIAG — 진단 근거 (READ-ONLY)

- 성격: diagnosis, prod READ-ONLY (DML/코드수정 0)
- auth-ctx: service_role (RLS bypass) — Silent 0-row read 회피
- project ref: rxlomoozakkjesdqjtvd
- 데이터소스(랭킹 canonical): `foot_stats_consultant(p_clinic_id, p_from, p_to)` RPC
- 실행 스크립트: `scripts/T-20260726-foot-SILJANG-RANKING-CONTAM-DIAG_ac1.mjs`, `_ac234.mjs`

## 판정 = **오염없음 (설명가능)** — cross-CRM/cross-clinic 오염 아님

핵심 반증: 지목된 김수린/이승은은 **풋(jongno-foot) 소속 consultant** 이며 **퇴사(active=false)** 상태.
타 CRM(body/derm)·타 clinic(songdo) origin 아님.

---

## AC-1 staff census
- clinics 테이블 = **2 clinic 공유 DB**: `jongno-foot`(74967aea…), `songdo-foot`(b4dc0de5…, payments/check_ins 0건 = 미가동)
- staff 전체 76명, 전부 clinic=jongno-foot 태깅. (테스트장비_*/관리/홍길동 등 seed 다수)
- **김수린**: 실재 O · clinic=jongno-foot · role=consultant · **active=false** · id=5b3a3a5f
- **이승은**: 실재 O · clinic=jongno-foot · role=consultant · **active=false** · id=bf424e1d
- → "풋에 없는 직원" = 실제로는 **풋 퇴사 상담실장**. 오등록·타센터 혼입 아님.

## AC-2 clinic 필터 실적용 (코드 + 실행 양면)
- **코드**: `foot_stats_consultant` RPC 전 leg 에 `clinic_id = p_clinic_id` 필터 적용
  (ci / packages / package_payments / payments), 최종 `WHERE s.clinic_id = p_clinic_id AND s.role='consultant'`.
  (마이그: `supabase/migrations/20260725160000_foot_check_ins_soft_hide.sql`)
- **실행**: RPC(jongno-foot)만 호출 → 타 clinic row 유입 경로 없음. songdo 활동 0건.
- FE(`SalesStaffTab`, `ConsultantSection`) 도 전 쿼리 `.eq('clinic_id', clinic.id)` 적용.
- ⇒ **clinic-scope 위반(오염) 없음.**
- 단, RPC 에 **`s.active = true` 필터 부재** → 퇴사 상담실장이 랭킹에 노출됨 (아래 RC).

## AC-3 김수린/이승은 매출/상담 origin
| 실장 | consultant check_ins | origin clinic | 상담일 범위 | 전기간 귀속매출 |
|------|---------------------|---------------|-------------|----------------|
| 김수린 | 5건 | **jongno-foot 100%** (songdo 0) | 2026-05-22~07-07 | 10원 / 5상담 |
| 이승은 | 1건 | **jongno-foot 100%** (songdo 0) | 2026-06-24 | 0원 / 1상담 |
- 두 실장의 귀속매출은 10원·0원 = 사실상 noise(테스트/반올림). 매출 왜곡 기여분 아님.
- origin 전량 풋(jongno). **혼입 origin 없음.**

## Root Cause = 재현
"직전 8명 랭킹"은 **전기간(all-time) window** 조회로 재현됨:
- `foot_stats_consultant(jongno, 2026-01-01~12-31)` = **정확히 8명** (엄경은·송지현·강경민·김지윤·김주연·**김수린**·**이승은**·정연주)
- `…(jongno, 2026-07-01~26)` MTD = 7명 (김수린만 잔존, 이승은 06-24 window 밖 탈락)
- `…(jongno, 2026-07-26)` 오늘 = 0명
- ⇒ 8명 재현 = ① 넓은(전기간) window + ② RPC active 필터 부재 → 퇴사 실장 노출.

## "총매출 틀림" — double-count 아님, 분모정의/window 문제
- payments(순, single/치료) MTD = **9,632,500원** (238행, package_id 有 = **0행**)
- package_payments(순, 패키지) MTD = **96,580,110원** (71행)
- 두 테이블 **중복산입 0** (payments.package_id 전부 NULL) → 랭킹 ~99M 은 패키지 매출 지배(정상, 풋=패키지 1급).
- 전기간 window 에는 정연주 **-1,716,320원**(환불>결제) 음수행 포함 → 랭킹이 "깨져 보이는" 원인.
- ⇒ "총매출 틀림"의 실체 = (a) window 선택(전기간 vs 당월/일), (b) 총매출 분모정의(payments-only vs 패키지포함),
  (c) 귀속(attributed ⊂ 총결제) vs 총매출 개념 혼동. **scope 오염/double-count 버그 아님.**

## 후속 분기 판정
- **필터누락(코드결함)?** clinic 필터 누락 = **아님**. 단 `active=true` 필터 부재 = 경미한 hygiene gap → 별건 P1 권고(퇴사 상담실장 랭킹 노출 차단). 본 티켓 코드수정 금지.
- **staff 혼입(타센터 오등록)?** 아님 (김수린/이승은 = 풋 퇴사자).
- **오염없음(설명가능)?** **YES = 최종 판정.**
