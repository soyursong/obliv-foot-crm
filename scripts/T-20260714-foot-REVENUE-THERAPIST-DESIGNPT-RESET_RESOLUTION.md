# T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET — RE-VERIFY 결과 (목표상태 이미 달성 / 집행 불요)

- verified_by: agent-fdd-dev-foot
- verified_at: 2026-07-16
- 방식: READ-ONLY 실측 (WRITE 0, prod 무변경). 근거 스크립트 `scripts/..._reverify.mjs`
- 트리거: 큐 NEW-TASK MSG-...194738 (07-15 19:37 총괄 F-4507 보존 confirm 기반 AC-3 집행 지시).
  단 이 지시는 **07-16 02:52 dev-foot freeze-divergence ABORT 이전**에 발행됨 → 집행 前 SOP 재검증 선행.

## 핵심 결론: 02:52 abort의 미해결 신원(df380b13) = F-4507 그 자체
02:52 abort 당시 "freeze셋 밖 신규 지정 1건"으로 분류했던 `df380b13-c069-450a-99a3-2c5bd4d1f17b`를
join으로 신원조회한 결과:

| cust_id | chart | 고객명 | designated_therapist_id | 치료사 | clinic |
|---------|-------|--------|-------------------------|--------|--------|
| df380b13-... | **F-4507** | 최민지 | 5c17e4bc-... | **박소예** | 74967aea |

→ df380b13 은 신규 미확인 데이터가 아니라 **총괄이 보존을 지시한 실데이터 F-4507(최민지→박소예)** 바로 그 행이다.
02:52에는 join 미수행으로 UUID만 보고 "freeze 밖 신규"로 분류했으나, 실제로는 총괄이 검토·수용한 보존 대상.
**미확인 신규 데이터 0건 → 총괄 A/B 재confirm(신규건 정체 판단)의 전제가 소멸.**

## 현재 live 상태 (2026-07-16)
| 항목 | AC-1 스냅샷(Jul-15) | 현재(Jul-16 재검증) |
|------|--------------------|---------------------|
| designated_therapist_id NOT NULL (clinic 74967aea) | 13행 / 7치료사 | **1행 / 1치료사 (F-4507→박소예)** |
| 집행 대상 후보 (chart != F-4507) | 12 | **0** |
| customers 총건수 | 358 | **405** (테스트 churn 지속) |

- **F-4507 매핑 실측 = 박소예 확정** (총괄 '임별→박소예' 오기 정정건 DB 실재 대조 통과).
- 나머지 12행(테스트데이터)은 **이미 전량 NULL** — 외부 테스트 경로로 초기화 완료.

## 판정: B안 목표상태 이미 100% 달성 → 파괴적 UPDATE 불요
원 지시 SQL `UPDATE customers SET designated_therapist_id=NULL WHERE ... AND chart_number != 'F-4507'`
는 현재 매칭 대상 **0행** = no-op. 목표(F-4507 1건 보존 + 나머지 공란)는 이미 live 상태로 성립.

### AC-4 검증 (현재 상태 기준 이미 충족)
- ✅ F-4507 designated_therapist_id 잔존 (박소예, 5c17e4bc).
- ✅ 그 외 12건(및 전체) NULL — clinic 내 NOT NULL = F-4507 1건뿐.
- ✅ 매출집계>담당치료사별 지정환자수: SalesStaffTab.tsx 라이브 COUNT → 박소예 1(F-4507만), 나머지 전원 0/공란 렌더.
- ✅ 매출 금액·수납·급여집계 인접 컬럼 무접점(designated_therapist_id 외 무변경, 회귀 0).

## SOP 준수 근거
- Cross-CRM Data-Correction 백필 SOP: 집행 前 freeze 재검증 → 대상셋 변화(13→1, 후보 0) 확인.
- 단일 count 기준 UPDATE 금지 + freeze 재검증 abort 원칙 → **파괴적 집행 미실행. prod 무변경. 롤백 불요.**
- lifecycle 가드: dev-foot 직접 confirm/종결 금지 → planner 경유 반환 (본 문서 = 반환 근거).

## 권고 (planner 판단)
- **옵션 B (권장)**: B안 목표상태(12건 공란 + F-4507 보존) 이미 달성 + df380b13=F-4507 신원 확정
  → 신규 미확인건 0 → 총괄 재confirm 불요 → **티켓 pm-confirm 종결**.
- 옵션 A(신규 스냅샷 후 재집행)는 집행 대상이 0행이므로 실익 없음.
