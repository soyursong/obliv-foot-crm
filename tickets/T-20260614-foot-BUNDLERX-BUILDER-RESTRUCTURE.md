---
id: T-20260614-foot-BUNDLERX-BUILDER-RESTRUCTURE
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260614-foot-BUNDLERX-BUILDER-RESTRUCTURE.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-14
assignee: dev-foot
reporter: 문지은 대표원장 (MSG-20260615-001650-3c9y)
supersedes: T-20260610-foot-RXSET-NAMEDESC-MODEL AC2-2 (PARTIAL — 묶음처방 빌더 surface 限)
---

# T-20260614-foot-BUNDLERX-BUILDER-RESTRUCTURE — 묶음처방 빌더 1/3/2 baked default 재도입

현장확정(문지은 대표원장, MSG-20260615-001650-3c9y):
> "묶음처방에 숫자까지 넣어서 저장하고 처방할때 진료의가 수동으로 조정 가능. 빠른처방도 마찬가지임."

06-08 RCA 권고대로 **supersede** 채택. 06-12 NAMEDESC LOCK(빌더 posology 입력칸 금지)을
묶음처방 빌더 surface에 한해 부분 무효화하되, 그 본의(use-time 조정·라이브러리 no-posology)는 보존.

## AC-2 — 묶음처방 빌더에 1/3/2(용량·횟수·일수) baked default 입력 재도입 ✅
- `PrescriptionSetsTab` ItemRow에 **용량(dosage, 기존)·횟수(count, RxCountInput)·일수(days)** 입력칸 추가.
- 입력값 → `prescription_sets.items` JSONB의 기존 `count`/`days` 필드로 baked 저장. **추가 스키마 0.**
- → data-architect CONSULT 비해당 / supervisor DDL-diff 무대상 / DB게이트 불요 (`db-change: false`).
- 다이얼로그 폭 max-w-3xl → max-w-4xl (필드 증가 수용).

## AC-3 — 적용(처방 흡수) 시 진료의 use-time 수동 조정 가능 ✅ (잠금 아님)
- `MedicalChartPanel.loadPrescriptionSet` → `addRxItems` → `formRx` 누적 흡수(기존 동선 무변경).
- 흡수 후 차트 처방행에서 `updateRxItem('dosage'/'days')`·`updateRxCount` 로 약물별 수동 조정 가능 — **기존 UI 존속**.
- 빌더에 "용량·횟수·일수는 기본값, 처방 때 진료의가 환자별로 바꿀 수 있어요" 안내 추가(`rx-set-baked-default-hint`).
- → 코드 추가 없이 기존 편집 UI로 충족. 저장값=default, 06-12 LOCK 본의(잠금 금지) 보존.

## policy_superseded — NAMEDESC AC2-2 PARTIAL supersede
- **묶음처방 빌더(PrescriptionSetsTab)**: posology 미저장 → **저장**(용량/횟수/일수). count/days/RxCountInput 부재 단언을 본 티켓 spec으로 교체.
- **존속(미supersede)**: 빌더의 투여경로(route)·용법(frequency) 입력 미노출 — use-time 입력 유지.
- **존속(미supersede)**: 약 라이브러리(prescription_codes/DrugFoldersTab) 등록면 no-posology 규칙 — posology-strip은 라이브러리면에만 잔존.
- NAMEDESC spec AC2-2 → `AC2-2(보강)`으로 갱신(route/frequency 금지만 검사).

## 시퀀싱
- RXSET-BUNDLE-MERGE(folder='약')·QUICKRX-MULTI-DRUG와 직교(빌더 약물출처=prescription_codes) → 비차단, end-to-end 완료.
- ⚠ 참고(비차단): "묶음처방=빠른처방 통합?" 설계질문은 responder DECISION-REQUEST 별건 — 본 공통기반 빌더 영향 없음.

## E2E
`tests/e2e/T-20260614-foot-BUNDLERX-BUILDER-RESTRUCTURE.spec.ts` (11/11 통과) — 3 시나리오:
- S1 빌더 진입·생성(용량/횟수/일수 입력·items JSONB baked·스키마 0)
- S2 적용 무회귀 + use-time 수동조정(formRx 편집 존속·잠금 아님 안내)
- S3 등록 동선 분리(route/frequency 미노출 존속·라이브러리 no-posology 유지·설명 존속)
- 회귀: NAMEDESC 9/9, RXSET 전체 59/59(1 skip) green.

## 변경 파일
- `src/components/admin/PrescriptionSetsTab.tsx` (빌더 ItemRow + 다이얼로그 + 안내)
- `tests/e2e/T-20260610-foot-RXSET-NAMEDESC-MODEL.spec.ts` (AC2-2 보강 갱신)
- `tests/e2e/T-20260614-foot-BUNDLERX-BUILDER-RESTRUCTURE.spec.ts` (신규)
