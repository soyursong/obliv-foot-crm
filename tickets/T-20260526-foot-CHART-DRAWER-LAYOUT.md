---
id: T-20260526-foot-CHART-DRAWER-LAYOUT
title: 진료차트 Drawer 레이아웃 개편
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
spec_file: tests/e2e/T-20260526-foot-CHART-DRAWER-LAYOUT.spec.ts
commit: 3c35ec5
created_at: 2026-05-26
completed_at: 2026-05-26
---

## 구현 요약

진료차트 Drawer를 2-column 레이아웃으로 개편.

### AC 달성 현황

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | 처방내역·상용구 팝업 → 우측 패널(처방세트/상용구 탭) 전환 | ✅ |
| AC-2 | 우측 패널 선택→폼 삽입 + "편집" 버튼→관리화면 이동 | ✅ |
| AC-3 | 치료사차트 읽기전용 (disabled + bg-gray-50 + cursor-not-allowed) | ✅ |
| AC-4 | 전체 placeholder placeholder:text-gray-300 연한 회색 | ✅ |
| AC-5 | 기존 기능 무영향 (타임라인·저장·Drawer·// autocomplete 유지) | ✅ |
| AC-6 | `npm run build` 에러 0 | ✅ |

### 주요 변경

1. **레이아웃**: 타임라인(w-44) | 진료폼(flex-1) | 우측 패널(w-72)
2. **우측 패널**: 처방세트/상용구 탭 항상 노출 (팝업/다이얼로그 제거)
3. **처방세트 탭**: 클릭 즉시 처방내역 적용 + "처방세트 관리 화면으로" 버튼
4. **상용구 탭**: 체크박스 다중선택 + "N개 임상경과에 삽입" 버튼 + "상용구 관리 화면으로" 버튼
5. **치료사차트**: `readOnly disabled` + `bg-gray-50 text-gray-500 cursor-not-allowed`
6. **placeholder**: 진단명/임상경과/치료사차트/진료메모 모두 `placeholder:text-gray-300`
7. **useNavigate**: `/admin/doctor-tools`로 이동 (Drawer 자동 닫힘)
8. **Drawer 너비**: `min(97vw, 1440px)` (3-column 수용)

### 제거된 코드

- `rxDialogOpen` state + 처방세트 모달 다이얼로그 JSX
- `phrasePanelOpen` state + 인라인 토글 패널 JSX
- 임상경과 레이블 옆 "상용구" 버튼
- 처방내역 레이블 옆 "처방세트 불러오기" 버튼
