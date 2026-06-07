---
id: T-20260607-foot-RXSET-LOAD-LABEL-RENAME
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260607-foot-RXSET-LOAD-LABEL-RENAME.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-07
deadline: 2026-06-14
reporter: 문지은 대표원장 (C0ATE5P6JTH / U0ALGAAAJAV)
---

# T-20260607-foot-RXSET-LOAD-LABEL-RENAME — '처방세트 불러오기' → '묶음처방 불러오기'

현장(문지은 대표원장): "처방세트 불러오기가 아니라 묶음처방 불러오기가 좋을듯해".
RX-SET-REDESIGN(deployed)의 '묶음처방' 개념·용어와 정합화. **순수 FE 라벨 변경(DB/로직 무변경).**

## 범위 결정 (스코프 제한 준수)

LOAD(불러오기) 인터랙션의 **사용자 노출 라벨만** 변경.
관리 엔티티 라벨은 **의도적으로 미변경** — 더 넓은 별도 리네임 결정이라 본 티켓 밖:
- admin '처방세트' 탭 / PrescriptionSetsTab CRUD 라벨
- MedicalChartPanel 우측 '처방세트' 탭(browse·apply 패널)
- ClinicManagement의 drug_folders 리네임 충돌 라벨('처방세트')

⚠ 현장 대안 "검색창 다중선택"은 본 티켓 밖 → RXQUICK-SET-FOLDER-NAV(approved)에서 처리.

## 변경 내역 (사용자 노출 문자열만, 2개 파일)

### src/components/admin/SuperPhrasesTab.tsx
- 처방내역 슬롯 로드 Select placeholder: `"처방세트 불러오기"` → `"묶음처방 불러오기"`
- 빈 처방내역 안내문: `위 "처방세트 불러오기"로 추가` → `위 "묶음처방 불러오기"로 추가`

### src/components/doctor/DoctorTreatmentPanel.tsx
- RxSetPicker 다이얼로그 타이틀: `처방세트 불러오기` → `묶음처방 불러오기`
- 피커 빈 상태: `처방세트가 없습니다.` → `묶음처방이 없습니다.` (동일 다이얼로그 내부 정합)
- 처방 빈 상태 안내: `처방세트를 불러오세요.` → `묶음처방을 불러오세요.`
- 로드 트리거 버튼 라벨: `처방세트` → `묶음처방`

> 코드 주석(`//`, `{/* */}`) 내 'prescription_sets=처방세트' 표기는 내부 도메인어로 그대로 유지(비노출).

## AC

- AC-1: SuperPhrasesTab 처방내역 슬롯 로드 placeholder/안내문이 '묶음처방 불러오기'로 표기 ✅
- AC-2: DoctorTreatmentPanel RxSetPicker 타이틀 '묶음처방 불러오기' ✅
- AC-3: DoctorTreatmentPanel 로드 버튼/빈상태 안내 '묶음처방' 정합 ✅
- AC-4: 사용자 노출(JSX 텍스트) 영역에 옛 '처방세트 불러오기' 라벨 잔존 0건 ✅

## 검증

- `npm run build` ✅ (built in 3.51s)
- E2E: `tests/e2e/T-20260607-foot-RXSET-LOAD-LABEL-RENAME.spec.ts` 5 passed (source-level, 비파괴)
- DB 변경: 없음
