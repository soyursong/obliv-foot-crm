---
id: T-20260605-foot-RX-SET-EXPLORER-TREE
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260605-foot-RX-SET-EXPLORER-TREE.spec.ts
e2e_spec_exempt_reason: null
qa_result: pass
deploy_commit: f271eb8
created: 2026-06-05
commit: f271eb8
---

# T-20260605-foot-RX-SET-EXPLORER-TREE — 진료차트 처방세트 탭 폴더 위계 트리(탐색기형)

## 요청
문지은 대표원장. 진료차트(MedicalChartPanel) 우측 패널 '처방세트' 탭을
평면 리스트 → 폴더 위계 트리(탐색기형)로. 세트가 많아지면 탐색 곤란.

## 구현 (MedicalChartPanel.tsx, FE-only)
- 대상: 처방세트 탭 `prescriptionSets.map` 평면 리스트 (L2182~) 교체.
- `prescription_sets.folder`(text nullable) 기준 folder→set 2단 아코디언 트리.
  - 그룹핑 규칙 = 관리화면 PrescriptionSetsTab(L309~325)과 동일:
    폴더명 가나다순(localeCompare 'ko') + '미분류' 맨 끝, 폴더 내부 sort_order 순서 보존.
  - folder null/'' = '미분류' 노드.
- 폴더 노드 펼침/접기: `collapsedRxFolders` Set state(기본 전체 펼침).
  토글 = ChevronDown/Right + Folder/FolderOpen 아이콘 + 카운트 Badge.
- leaf 클릭 = 기존 `loadPrescriptionSet(set)` 그대로 보존 → 적용 로직 변경 없음.
  RX-SET-ACCUMULATE(append) 동작 무변경(핸들러 보존으로 충돌 회피).
- data-testid 신규: `rx-set-folder-node` / `rx-set-folder-toggle` / `rx-set-folder-name` / `rx-set-empty`.

## DB
prescription_sets.folder = 기존 필드. 스키마 변경 없음 (db-change: false).

## 범위 밖 (비차단)
- 다단계 중첩(폴더 안 폴더)은 현재 데이터모델(folder=단일 string) 미지원.
  1차 = folder→set 2단 트리. 다단계 필요 시 parent_folder_id 스키마 확장 = 별건(supervisor 이관).

## E2E (tests/e2e/T-20260605-foot-RX-SET-EXPLORER-TREE.spec.ts)
SERVICE_KEY seed(폴더 A/B + folder=null 3세트) 결정론적 검증.
- S1: 폴더 노드 렌더 → 접기(leaf 숨김)/펼치기(leaf 노출) → leaf 클릭 적용 + 누적 보존
- S2: 미분류 노드 leaf 적용 + 빈상태(전체 비활성) 회귀
- 실행: 3 passed (22.9s, 라이브 seed against rxlomoozakkjesdqjtvd).

## 검증
- npm run build: OK (built in 3.67s)
- tsc -p tsconfig.app.json --noEmit: rc=0
- Playwright: S1/S2 + setup 3 passed
