# T-20260726-foot-CRM-ASSIGN-RANKING-FIX-R1 — 수정 근거 (evidence)

- **성격**: fix (read-side 필터 교정) / **DB READ-ONLY** (DDL·DML·백필 0, db_change=false)
- **auth-ctx (진단)**: `service_role` (RLS bypass) — Silent 0-Row Read 오독 회피
- **project ref**: `rxlomoozakkjesdqjtvd` (풋 정본 jongno-foot=`74967aea-a60b-4da3-a0e7-9c997a930bc8`)
- **parent**: T-20260726-foot-CRM-ASSIGN-V1 (deployed/field-soak)
- **선행 진단**: T-20260726-foot-STAFFRANK-PHANTOM-STAFF-REVENUE-DIAG forensic-report (commit 183b6daf, 오염없음 판정)

---

## 결함1 — 퇴사자 랭킹 노출 (재직 필터 미적용)

### RCA (코드 근거)
퇴사 실장이 노출되는 **유일 surface = 통계>매출통계 '실장 랭킹'** = `foot_stats_consultant` RPC.
RPC staff join(`supabase/migrations/20260725160000_foot_check_ins_soft_hide.sql` L228-230)은
`WHERE s.clinic_id = p_clinic_id AND s.role = 'consultant'` 로만 좁히고 **`s.active = true` 술어 부재**.
→ 퇴사 상담실장(active=false)이 당월/전기간 랭킹에 노출.

### 다른 배정 surface 는 이미 재직 필터 적용됨 (수정 불필요, 코드 실측)
| surface | 파일:라인 | active 필터 |
|---------|-----------|-------------|
| 자동배정 후보(실행3) | `assignmentStrategy.ts:338` `fetchPresentEnabledConsultants` | ✅ `.eq('active', true)` |
| 배정설정 랭킹 프리뷰 | `AssignmentSettingsTab.tsx:97` | ✅ `.eq('active', true)` |
| 수동배정 후보 리스트 | `Assignments.tsx:1904` `loadOrder` | ✅ `.eq('active', true)` |
| 배정 메인 staff/누적 | `Assignments.tsx:225` | ✅ `.eq('active', true)` |
| 대시보드 상담사 | `Dashboard.tsx:4527` | ✅ `.eq('active', true)` |
| 치료현황 상담사 | `TreatmentStatusPanel.tsx:156` | ✅ `.eq('active', true)` |
| **통계 실장 랭킹** | `stats.ts fetchConsultantPerf` (RPC) | ❌ → **본 수정 대상** |

### 수정 (db_change=false 유지)
RPC 를 CREATE OR REPLACE(=DDL) 하지 않고 **read-side 에서 재직 필터 교정**:
`fetchConsultantPerf` 가 RPC 결과를 반환하기 전, 해당 clinic 의 `staff.active === false`(명시 퇴사) id 집합을 조회해 제외.
- 재직 판정 소스 = `staff.active`(기존 컬럼, 신규 컬럼 0).
- `active=true / null(미상)` 은 보존 → **재직 실장(매출 0 포함) 정상 유지(AC2)**, 과필터 방지.
- 조회 실패 시 fail-open(기존 결과 유지) → 회귀0.
- 매출 계산·`assigned_consultant_id` 무접촉(read-only, RED LINE 준수 / AC4).

---

## 결함2 — 매출 총액 '완전 틀리다' 원인규명 (증거 기반, 추정 배제)

### prod 실측 (foot_stats_consultant, jongno-foot, window별) — 2026-07-26 재현

| window | 명수 | 지목 퇴사자 노출 | attributed 합계 | 정연주 |
|--------|------|------------------|-----------------|--------|
| 오늘(07-26) | 0 | — | 0원 | — |
| **당월MTD(07-01~26)** | 7 | 김수린 10원(퇴사) | 99,316,290원 | **+1,226,400원** |
| 개원~현재(전기간) | 8 | 김수린 10원·이승은 0원(퇴사) | 96,373,570원 | **−1,716,320원(환불>결제)** |

### ① cross-CRM / cross-clinic 혼입 여부 → **혼입 없음 (실측)**
- 김수린 배정 check_ins 5건 **전량 jongno-foot** (songdo 0 / 타clinic 0 / soft-hidden 0).
- 이승은 배정 check_ins 1건 **전량 jongno-foot**.
- RPC 전 leg(check_ins/packages/package_payments/payments/staff)에 `clinic_id=p_clinic_id` 필터 실적용(SQL L80~230).
- ⇒ 다른 CRM(body/derm)·다른 지점(songdo) 매출 유입 0건. **cross_crm_data_contract 지점격리 위반 아님.**

### ② 계산 로직 → **double-count 없음 / 취소·환불 정책 정상**
- payments(single/치료)와 package_payments(패키지) **중복산입 0** (payments.package_id 전량 NULL — forensic AC3 확정).
- RPC 매출 = net(취소·환불 반영)·accounting_date 축. 정연주 전기간 −1,716,320원 = 환불>결제 실데이터(정상 net).

### ③ '완전 틀리다'의 실체 = scope 버그 아님, **(a)+(b)+(c) 복합**
- **(a) 퇴사자 noise 행** (김수린 10원·이승은 0원) → 결함1 active 필터로 제거.
- **(b) window 선택**: 전기간 조회 시 정연주 **−1,716,320원 음수환불행**이 합계·순위를 '깨져 보이게' 함. 당월MTD 는 +1,226,400원(정상).
- **(c) 개념 혼동**: 실장귀속(attributed ⊂ 총결제) vs 일마감 총매출 by-design 차이.

### 수정 효과 (before → after active 필터)
| window | before(노출 명수/합계) | after(재직만/합계) |
|--------|------------------------|---------------------|
| 당월MTD | 7명 / 99,316,290원 | **6명 / 99,316,280원** (김수린 −10원) |
| 전기간 | 8명 / 96,373,570원 | **6명 / 96,373,560원** (김수린·이승은 −10원) |

- ⇒ 랭킹 매출 계산 자체는 정상(scope 격리·no double-count). 결함1 active 필터가 퇴사 noise 를 제거해
  현장이 기대하는 **'이번 달 재직 6명'** 랭킹(99,316,280원 = forensic 권장 정정본)과 정확히 일치.
- 매출-calc·window default 는 **버그 증거 없음** → 무변경(추정 수정 배제, RED LINE 준수).

---

## AC 대사
- **AC1** ✅ 퇴사자(active=false) 랭킹 제외 — 김수린·이승은 미표시. (자동/수동배정·설정 surface 는 이미 재직 필터 → 통계 랭킹만 교정)
- **AC2** ✅ 매출 0 재직 실장(김주연 1만·정연주) 정상 포함 — active=false 만 제외.
- **AC3** ✅ 풋 payments 만(다른 CRM 미혼입)·net 정책 정상 집계 실측 확인. 원인·before/after evidence 기록.
- **AC4** ✅ `assigned_consultant_id` 무접촉·랭킹 read-only.
- **AC5** ✅ 무-DDL(db_change=false) — read-side 필터 교정, 신규 컬럼 0.

*READ-ONLY 진단 + read-side 코드 교정. DDL/DML/백필 0.*
