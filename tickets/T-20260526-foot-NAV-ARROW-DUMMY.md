---
id: T-20260526-foot-NAV-ARROW-DUMMY
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
db-migration: false
build-status: pass
e2e-spec: false
linked-tickets: [T-20260519-foot-MEDCHART-REVAMP, T-20260526-foot-PHRASE-SLASH]
---

# T-20260526-foot-NAV-ARROW-DUMMY — 네비게이션 화살표 누락 + 임시 더미데이터

## AC 결과

### AC-1 조사 완료
"오른쪽 화살표"의 실체 확인:
- **위치**: `MedicalChartPanel.tsx` 차트 폼 상단 타이틀 영역
- **현황**: `N/M회차` 배지는 존재하나 prev/next 화살표 버튼 **코드에 부재** → AC-3 적용

### AC-3 네비게이션 화살표 신규 추가 ✅
- `ChevronLeft` (이전 기록) + `ChevronRight` (다음 기록) 버튼 — N/M회차 배지 양옆
- 경계에서 `disabled` 처리 (첫 기록에서 왼쪽 비활성, 마지막에서 오른쪽 비활성)
- `data-testid`: `chart-nav-prev` / `chart-nav-next`
- `aria-label`: 이전 기록 / 다음 기록

### AC-4 노란테두리 더미 차트 5건 ✅
| # | visit_date | diagnosis |
|---|-----------|-----------|
| 1 | 2026-05-20 | 내성발톱 — 더미 샘플 ① |
| 2 | 2026-05-13 | 족저근막염 — 더미 샘플 ② |
| 3 | 2026-05-06 | 무좀 (백선) — 더미 샘플 ③ |
| 4 | 2026-04-29 | 굳은살 제거 — 더미 샘플 ④ |
| 5 | 2026-04-22 | 티눈 — 더미 샘플 ⑤ |

- **표시 조건**: `charts.length === 0` (실데이터 없을 때만)
- **스타일**: `outline: 2px solid #facc15` (노란테두리)
- **타임라인 안내 배너**: "실데이터 없음 — 더미 샘플 표시 중"
- **저장 불가 가드**: handleSave 시작에 `__dummy__` prefix 체크 → toast 오류

### AC-5 기존 기능 무영향 ✅
- `displayCharts` 파생 변수 사용 — `charts` state 불변
- 실데이터 있으면 더미 미표시, 내비게이션 arrows는 실데이터로 동작

### AC-6 빌드 성공 ✅
```
✓ built in 3.32s
```

## 부수 수정
`DoctorTreatmentPanel.tsx` — T-20260526-foot-PHRASE-SLASH AC-5 미완성 연결:
- `handleNoteChange`/`handleDocChange` → Textarea `onChange` 연결
- `doctorNoteRef`/`docContentRef` → `ref` 연결
- slash 자동완성 팝오버 JSX 추가 (note/doc 각각)
- TS6133 unused variable 오류 해소 → 빌드 통과

## 커밋
`7eed4b5` — feat(nav+dummy): MedicalChartPanel 방문 레코드 네비게이션 화살표 + 더미 차트 5건
