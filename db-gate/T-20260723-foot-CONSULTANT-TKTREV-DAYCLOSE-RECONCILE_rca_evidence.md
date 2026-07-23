# T-20260723-foot-CONSULTANT-TKTREV-DAYCLOSE-RECONCILE — RCA evidence (READ-ONLY)

- 작성: dev-foot / 2026-07-23
- 성격: read-only RCA. prod 데이터 변경 0 (SELECT-only probe). db_change=false.
- probe: `scripts/T-20260723-foot-CONSULTANT-TKTREV-DAYCLOSE-RECONCILE_probe.mjs`
- reporter: 김주연 총괄 (C0ATE5P6JTH). 첨부 F0BKCHFTJ65(스크린샷) responder 다운로드 실패 → 현장 날짜/규모 병렬 수집 중.

## 착수 첫 스텝 판별 결과 (planner 지시 (A)/(B))

### (A) '상담실장 티켓팅 실적'은 07-17에 고친 그 섹션과 **동일 소스** ✅
- UI: `src/components/stats/ConsultantSection.tsx` — 섹션 헤더 **"3. 상담실장 티켓팅 실적"**.
- 매출 컬럼 "총 매출액" = `consultantRevenue(r)` (`src/lib/consultantSalesExport.ts`) = **RPC `foot_stats_consultant`.total_amount** 직접 소비.
- 호출: `src/lib/stats.ts` `fetchConsultantPerf()` → `supabase.rpc('foot_stats_consultant', {p_clinic_id, p_from, p_to})`.
- 이 RPC = **T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE 에서 재설계한 바로 그 View B** (mig `20260717160000_foot_stats_consultant_pkg_attr_reconstruct.sql`, commit 869337da).
- ⇒ **동일 소스 branch**. 단, 정밀 분류: **코드 회귀/버그 아님**(RPC는 07-17 스펙대로 정확 동작). 07-17 재설계가 **트리거**(원인)다 — total_amount 를 <1%→~91% 로 의미있게 만들면서, 원래 존재하던 View B↔일마감 구조적 차이가 이제 "가깝지만 안 맞는" 잔차로 현장에 **가시화**됨.

### (B) '일마감 결제내역' 권위 소스 = **payments 수납 grain** (service_charges 명세 grain 아님) ✅
- `src/pages/Closing.tsx`: `payments` + `package_payments` + `closing_manual_payments`, **`created_at`(KST 하루경계) 필터**, net(refund 음수), 담당=`customers.assigned_staff_id`.
- 명세(service_charges) 미참조. ⇒ 일마감 결제내역 = **실수납 결제행 grain(payments 계열)**. 매출 split SSOT / 인센티브 데이터계약 SSOT 의 payments(수납) 축과 정합.

## 두 뷰 대조표 (AC1 + AC2)

| 축 | View B '상담실장 티켓팅 실적' (`foot_stats_consultant`) | View A '일마감 결제내역' (`Closing.tsx`) |
|----|--------------------------------------------------------|------------------------------------------|
| 소스 | RPC. payments(단건, ticketed check_in 귀속) + package_payments(귀속패키지) | 직접쿼리. payments + package_payments + closing_manual_payments |
| **WHEN(인식일)** | **accounting_date** ∈ [from,to] | **created_at** (KST 하루경계) |
| **WHO(귀속)** | **check_ins.consultant_id** (전기간 최근접 ticketed 상담사). role='consultant' 만 | **customers.assigned_staff_id** (배정담당, 전 직군) |
| **SCOPE(범위)** | **상담사에 귀속된 매출만**. 미귀속(상담이력 無)·비상담직군 = 제외(NULL, BINDING-3) | **전체 결제행** (귀속·상담 무관) |
| net/환불 | net (refund 음수) | net (동일) |
| 시뮬 제외 | O | X |

→ **View B ⊂ View A** (부분집합). 정의상 View B ≤ View A. 수치 일치는 **원리상 불가**.

## AC2 — prod 재현 (당월 2026-07-01~07-23, SELECT-only)

- View B Σ total_amount = **73,889,210** (rows 7)
- View A 일마감(created_at, ALL) = **80,855,370** (payments 7,125,260 / package 73,730,110 / manual 0)
- **Δ = 6,966,160**

축 분해:
| 델타 성분 | 금액 | 원인 |
|-----------|------|------|
| SCOPE (상담사 귀속분만 vs ALL) | **6,966,160** | 미귀속 매출 = 상담이력 無 고객·비상담직군·상담 미연결 결제 (BINDING-3 by-design NULL) |
| WHEN (created_at vs accounting_date) | **0** | 당월 결제행 accounting_date == created_at → 이번 기간 무영향(원리상 존재 가능) |

⇒ 이번 기간 델타의 **100%가 SCOPE 축**(의도된 미귀속 잔차). WHEN·WHO 오귀속 성분 0.

## AC3 — 판별 (07-17 회귀 vs 신규)
- **동일 소스(foot_stats_consultant)**. **07-17 재설계의 회귀/버그 아님** — RPC는 07-17 스펙(BINDING-1/2/3)대로 정확 동작, 잔차는 correct-by-default 미귀속(허위귀속 금지).
- 본질: 07-17 이전엔 total_amount ≈ 0(패키지매출 90% 누락)이라 아무도 일마감과 비교 안 함 → 07-17 정정 후 ~91% 로 커지자 현장이 일마감과 대조 → "왜 안 맞나" 신고. = **07-17의 가시화 side-effect, 신규 결함 아님**.
- 07-17 RCA가 이미 동일 결론("View A vs View B = 의도된 차이")을 냈고 **UX 라벨 보강**을 권고했으나 **미배포**(ConsultantSection 헤더에 scope 설명 없음). 라벨 부재가 현장 재신고를 유발.

## AC4 — RCA 결론 + 후속 스코프 제안 (수정은 게이트 후)
정합 옵션 2택 (현 티켓은 RCA까지, 아래는 **제안**):
1. **[권고·저비용] 라벨/설명 보강** (표시계층, DB·집계 무변경, confirm/DA 불요):
   - '상담실장 티켓팅 실적' 헤더/부제에 "상담사에게 귀속된 매출만 · 회계인식일(accounting_date) 기준. 일마감 총매출(전체 결제·수납일 기준)과 다를 수 있음" 명시.
   - 미귀속 매출(Δ)을 "미지정/미귀속" 행으로 노출하면 Σ가 일마감과 대사(reconcile) 가능해져 현장 신뢰 회복.
2. **[고비용·product 결정] 집계 기준 통일**: View B 를 일마감과 맞추려면 상담사-귀속 스코프를 포기해야 함(= 지표 목적 상실). 김주연 총괄 confirm + 매출 split/인센티브 SSOT 재대조 + DA CONSULT 필수. 비권장.

## AC5 — read-only 확인
- probe = SELECT-only (RPC + payments/package_payments/closing_manual read). prod write 0. 앱코드·DB 무변경.

## 미결(현장 병렬 수집 대기)
- 현장 기준 날짜/기간·차이 규모(F0BKCHFTJ65 스크린샷) 확보 시 정확 수치 대조 1건 추가 예정. 단, 구조 판별(위 A/B/RCA)은 날짜 무관하게 성립.
