---
id: T-20260615-foot-DOCPATIENTLIST-DONE-CLINICAL-READONLY
title: "[진료환자목록] 진료완료 환자 임상경과 읽기전용 + 내용 있을 때만 표시(빈 편집폼 금지)"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 800be4d
impl_commit: 800be4d
created: 2026-06-15
assignee: dev-foot
reporter: 문지은(대표원장)
source_msg: MSG-20260615-121214-23lg
origin_msg: MSG-20260615-115926-h2ek
needs_field_confirm: true
related_tickets:
  - T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL   # BASE — 임상경과 편집 게이트(cfa110b), AC-3 회귀 0 유지
  - T-20260615-foot-RXLIST-RENAME-DOCFILTER          # 진료완료 SSOT(usePatients 필터)
  - T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN   # 同 파일 컬럼(item2) — 머지 COORDINATE
  - T-20260615-foot-RXLIST-COLALIGN-DONE-READONLY    # 취소+리버트(번들) — 본건은 item3만 재dispatch
---

# T-20260615-foot-DOCPATIENTLIST-DONE-CLINICAL-READONLY

## 출처
문지은 대표원장(#foot) 3항목 中 item3 (MSG-20260615-115926-h2ek).
- item1 → DOCDASH-SHAKE-ACK-NOT-COMPLETE (P0 hotfix, 완료전이 교정)
- item2 → DOCPATIENTLIST-DASHCOL-REALIGN (컬럼)
- **item3 → 본건** (진료완료 환자 임상경과 읽기전용)

## 요지
진료환자목록(DoctorPatientList) 행 토글 펼침 시 임상경과 패널이 열리는데,
**진료완료 환자는 읽기전용(편집/수정화면 금지), 내용 있을 때만 표시.**

## 변경
- 임상경과 편집 활성 조건: '당일접수' → '당일접수 AND 진료 미완료'.
- 진료완료(completed_at IS NOT NULL ∥ status_flag='pink' — completedPatients SSOT 1:1) 시
  편집 입력창·저장버튼 비표시.
- 내용 없으면 빈 편집폼 금지(담당의 select·textarea 미렌더, '작성된 임상경과가 없습니다' 안내만).

## AC
- AC-1: 당일 + 진료완료 환자 펼침 → 임상경과 읽기전용(편집 진입·저장버튼 차단).
- AC-2: 당일 + 진료 미완료 환자 → 편집 가능(회귀 0).
- AC-3: 읽기전용 + 임상경과 내용 없음 → 빈 편집폼 미노출(기록 없음 안내만).
- AC-4(회귀): EXPAND-CLINICAL AC-3(당일 외=읽기전용)·QuickRxBar·DoctorCallDashboard 인라인 불변.

## 시나리오
- S1: 진료완료(completed_at / pink) 환자 펼침 → 읽기전용.
- S2: 진료 미완료(당일) 편집 유지 + 읽기전용 빈값 → 빈 편집폼 금지.
- S3: AC-3 당일 외 읽기전용 + 인접 동선 회귀 0.

## 구현
- `src/components/doctor/DoctorPatientList.tsx`:
  `isVisitDone = !!row.completed_at || row.status_flag === 'pink'`,
  `readOnly={!isToday || isVisitDone}`, 라벨 사유별 분기.
- `src/components/MedicalChartPanel.tsx` (embed clinical):
  `isReadOnly && !formClinical.trim()` → 빈 편집폼 미렌더 + `clinical-mini-empty-readonly` 안내,
  읽기전용 시 진료의 미선택 경고 미노출.
- 테스트: `tests/e2e/T-20260615-foot-DOCPATIENTLIST-DONE-CLINICAL-READONLY.spec.ts` 신규 13 + EXPAND-CLINICAL 회귀 16.

## 검증
- build OK. 신규 E2E 13 PASS + EXPAND-CLINICAL 회귀 16 PASS + 광역 회귀 649 PASS. DB변경 없음.
- 실브라우저 진료완료-readonly/빈폼 UX는 시드데이터(진료완료 환자) 필요 → supervisor QA/field-soak.
