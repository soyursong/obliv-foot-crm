# T-20260726-foot-STAFFRANK-PHANTOM-STAFF-REVENUE-DIAG — Forensic Report

- **성격**: diagnosis / **prod READ-ONLY** (DDL·DML·백필·삭제 0, 코드수정 0)
- **auth-ctx**: `service_role` (RLS bypass) — Silent 0-Row Read 오독 회피 (cross_crm 진단 인증컨텍스트 표준 준수)
- **project ref**: `rxlomoozakkjesdqjtvd`
- **재현 스크립트**: `scripts/T-20260726-foot-SILJANG-RANKING-CONTAM-DIAG_ac1.mjs`, `_ac234.mjs` (재실행 2026-07-26 검증)
- **랭킹 canonical 소스**: `foot_stats_consultant(p_clinic_id, p_from, p_to)` RPC (통계>매출통계 '실장 랭킹')
- **현장 지적자**: 김주연 총괄 (C0ATE5P6JTH)

---

## 최종 판정 (forensic_verdict) = **오염 없음 (설명 가능) — ①타도메인혼입 아님 / ②clinic 무필터 아님 / ③staff 오염 아님**

지목된 김수린·이승은은 **실재하는 풋센터(jongno-foot) 소속 퇴사 상담실장**(active=false)이며,
매출·상담 origin 전량 풋(jongno). cross-CRM/cross-clinic 혼입도, clinic 무필터 쿼리 결함도, staff 오등록도 아니다.
**8명 랭킹의 실체 = ①전기간(all-time) window 조회 + ②랭킹 RPC의 `active=true` 필터 부재**로 퇴사 실장이 노출된 것.
**CRM-ASSIGN-V1 자동배정 랭킹 로직의 field-soak 결함 아님**(별항 §5 근거).

---

## AC1 — staff 로스터 census (prod read-only)

- clinics = **2 clinic 공유 DB**:
  - `jongno-foot` = `74967aea-a60b-4da3-a0e7-9c997a930bc8` (오블리브의원 서울오리진점) — **풋센터 정본**
  - `songdo-foot` = `b4dc0de5-f007-4a57-8888-aabbccddeeff` (오블리브 풋센터 송도) — **payments/check_ins 0건 = 미가동**
- staff 전체 **76명**, 전부 `clinic_id = jongno-foot` 태깅 (테스트장비_*/관리/홍길동 등 seed 다수 포함).

| 지목 실장 | 실재 | clinic_id | role | active | staff.id |
|-----------|------|-----------|------|--------|----------|
| **김수린** | O | jongno-foot | consultant | **false (퇴사)** | `5b3a3a5f-9d14-4099-897b-95c6ae86b763` |
| **이승은** | O | jongno-foot | consultant | **false (퇴사)** | `bf424e1d-4593-4fa6-a54e-d610c32dc13b` |

- ⇒ "풋에 없는 직원"의 실체 = **풋 퇴사 상담실장**. 오등록·타센터 혼입 **아님**.

## AC2 — payments clinic 필터 정합 (코드 + 실행 양면)

### 코드 근거
- 랭킹 소스 `foot_stats_consultant` (마이그 `supabase/migrations/20260725160000_foot_check_ins_soft_hide.sql`)는
  **전 leg 에 `clinic_id = p_clinic_id` 필터 적용**:
  - `ci.clinic_id = p_clinic_id` (L80/96), `p.clinic_id` (L106), `pp.clinic_id` (L119/129), `pay.clinic_id` (L143)
  - 최종 staff join: `WHERE s.clinic_id = p_clinic_id AND s.role = 'consultant'` (L229-230)
- FE(`SalesStaffTab`, `assignmentStrategy.fetchConsultantRevenueMetrics`)도 전 쿼리 `.eq('clinic_id', clinic.id)` 적용.
- ⇒ **clinic-scope 필터 실적용 확인. 무필터 쿼리 결함 아님.**

### ★ 결함 지점 (clinic 필터가 아니라 active 필터)
- L229-230 staff 술어에 **`AND s.active = true` 부재** → 퇴사 상담실장이 랭킹에 노출.
- 이것이 clinic 오염이 아닌 **active-filter hygiene gap**(경미 결함)의 유일 원인.

### 김수린·이승은 귀속 결제행 유입 clinic (지문)
| 실장 | 배정 check_ins | origin clinic | soft-hidden | 상담일 범위 |
|------|---------------|---------------|-------------|-------------|
| 김수린 | 5건 | **jongno-foot 100%** (songdo 0) | 0건 | 2026-05-22 ~ 07-07 |
| 이승은 | 1건 | **jongno-foot 100%** (songdo 0) | 0건 | 2026-06-24 |

- ⇒ 귀속 결제행 유입 clinic **전량 풋(jongno)**. 풋 외 지점(songdo)·타 CRM 유입 **0건 = cross 혼입/무필터 아님**.

## AC3 — 올바른 재산출 (clinic 정상필터 + active 정정)

`foot_stats_consultant(jongno-foot)` 를 window 별로 호출한 결과:

### 오염 전 (직전 조회 재현) — 전기간(all-time) window, 8명
| 순위 | 실장 | active | 귀속매출 | 상담건 |
|------|------|--------|----------|--------|
| 1 | 엄경은 | 재직 | 32,365,750원 | 57 |
| 2 | 송지현 | 재직 | 27,003,770원 | 49 |
| 3 | 강경민 | 재직 | 21,012,400원 | 41 |
| 4 | 김지윤 | 재직 | 17,697,960원 | 45 |
| 5 | 김주연 | 재직 | 10,000원 | 8 |
| 6 | **김수린** | **퇴사** | 10원 | 5 |
| 7 | **이승은** | **퇴사** | 0원 | 1 |
| 8 | 정연주 | 재직 | **-1,716,320원** (환불>결제) | 60 |
| — | **합계(attributed)** | | **96,373,570원** | |

### 오염 후 (정정) — 현직 consultant 만, 6명
| 순위 | 실장 | 귀속매출 | 상담건 |
|------|------|----------|--------|
| 1 | 엄경은 | 32,365,750원 | 57 |
| 2 | 송지현 | 27,003,770원 | 49 |
| 3 | 강경민 | 21,012,400원 | 41 |
| 4 | 김지윤 | 17,697,960원 | 45 |
| 5 | 김주연 | 10,000원 | 8 |
| 6 | 정연주 | -1,716,320원 | 60 |
| — | **합계** | **96,373,560원** | |

### 델타 (오염 전 8명 → 정정 6명)
- 제거 실장: **김수린(퇴사)·이승은(퇴사)** 2명
- 매출 델타: 96,373,570원 → 96,373,560원 = **−10원** (두 퇴사 실장 귀속액 10원+0원 = noise, 매출 왜곡 기여분 사실상 0)
- **참고 — 권장 window(당월 MTD, 2026-07-01~26) 정정본 6명**: 엄경은 32.4M · 송지현 27.0M · 강경민 21.0M · 김지윤 17.7M · 정연주 1.23M · 김주연 1만 = **99,316,280원** (음수행·이승은 자연 탈락, 현장 체감에 가장 부합)

### "총매출 완전 오류"의 실체 (double-count 아님)
- payments(순, single/치료) MTD = **9,632,500원** (238행, `package_id 有 = 0행`)
- package_payments(순, 패키지) MTD = **96,580,110원** (71행)
- 두 테이블 **중복산입 0** (payments.package_id 전부 NULL) → 랭킹 ~99M 은 패키지 매출 지배(정상, 풋=패키지 1급).
- "틀려 보인" 3대 원인: **(a) window 선택**(전기간 vs 당월/일), **(b) 분모정의**(payments-only vs 패키지포함), **(c) attributed(실장귀속 ⊂ 총결제) vs 일마감 총매출 개념 혼동**. + 전기간 window의 정연주 **−1,716,320원 환불행**이 랭킹을 "깨져 보이게" 함.
- ⇒ **scope 오염/double-count 버그 아님. window·분모정의·음수환불행 문제.**

## AC4 — 원인 판정 (forensic_verdict)

| 후보 원인 | 판정 | 근거 |
|-----------|------|------|
| ① 타도메인(cross-CRM) 혼입 | **아님** | 김수린·이승은 origin 전량 jongno-foot. body/derm/songdo 유입 0건 |
| ② clinic 무필터 조회(쿼리 결함) | **아님** | RPC 전 leg + staff join 모두 `clinic_id=p_clinic_id` 필터 실적용(코드 L80~230) |
| ③ staff 오염(타센터 오등록) | **아님** | 두 실장 = 풋 소속 퇴사 consultant, clinic_id 정상 |
| **실제 원인** | **active-filter 부재 + 전기간 window** | `foot_stats_consultant` L229-230 에 `s.active=true` 부재 → 퇴사 실장 노출. 전기간 조회로 8명 재현 |

### CRM-ASSIGN-V1 field-soak 결함 여부 → **아님 (귀속 X)**
- CRM-ASSIGN-V1 자동배정 랭킹(`src/lib/assignmentStrategy.ts`)의 후보 풀 `fetchPresentEnabledConsultants`는
  **`active=true AND role='consultant' AND clinic_id AND auto_assign_enabled AND staff_attendance.present`** 로 필터 →
  **퇴사·타clinic 실장이 애초에 후보에 진입 불가**(clean pool). 이 랭킹은 phantom staff 를 만들지 않는다.
- 현장이 본 "8명 랭킹"은 **통계>매출통계의 `foot_stats_consultant` 화면**이지 CRM-ASSIGN-V1 배정 랭킹이 아니다.
- ⇒ **CRM-ASSIGN-V1 랭킹 산식/쿼리의 field-soak 결함으로 귀속하지 않음.** 결함 표면은 기존 통계 RPC(T-20260725 soft_hide 마이그).

## AC5 — 산출물 & 후속
- 본 report(census + clinic 지문 + 재산출 델타 + verdict) + 하단 현장 재보고용 요약.
- **후속 (별건 수정 티켓)**: `foot_stats_consultant` (및 SalesStaffTab 표시경로)에 `active=true` hygiene 필터 추가 → 퇴사 상담실장 랭킹 노출 차단. **본 티켓 READ-ONLY RED LINE 준수 위해 코드 미수정, planner FOLLOWUP 로 분리.**

---

## 현장 재보고용 요약 (responder 릴레이 — 개발용어 배제)

> **실장 랭킹에 안 계신 분(김수린·이승은)이 뜬 건 — 데이터가 섞인 게 아니라, 예전에 그만두신 풋센터 상담실장님 두 분이 "전체 기간"으로 볼 때 목록에 남아 있어서입니다.**
>
> - 두 분 모두 **풋센터 소속이 맞고**(다른 지점·다른 센터 사람이 절대 아님), 지금은 퇴사 상태예요. 두 분 매출은 각각 10원·0원으로 사실상 없습니다.
> - **다른 지점 매출이 섞이거나 중복으로 더해진 문제는 없습니다.** 매출 숫자 자체는 정상입니다.
> - 총매출이 "틀려 보인" 건, 조회 기간이 **개원~현재 전체**로 잡혀 있었고, 그 안에 **환불이 결제보다 많았던 한 건(마이너스)**이 섞여서 그래요. **이번 달 기준**으로 보면 재직 실장 6분 기준으로 깔끔하게 정리됩니다.
> - **이번 달(7월) 기준 정상 랭킹**: ① 엄경은 3,236만 ② 송지현 2,700만 ③ 강경민 2,101만 ④ 김지윤 1,769만 ⑤ 정연주 123만 ⑥ 김주연 1만
> - 앞으로 **퇴사하신 실장님이 랭킹에 안 뜨도록** 목록 정리를 별도 건으로 잡아 처리하겠습니다.

---

*READ-ONLY 준수: 본 진단은 조회만 수행. DDL/DML/백필/삭제 0. 코드 수정 0. 수정은 별건 티켓으로 분리.*
