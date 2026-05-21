---
id: T-20260522-foot-IMGDROP-REMOVE
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
deadline: 2026-05-28
created: 2026-05-22
completed: 2026-05-22
commit: TBD
build: pass
db-change: false
spec-file: tests/e2e/T-20260522-foot-IMGDROP-REMOVE.spec.ts
---

# T-20260522-foot-IMGDROP-REMOVE: 진료이미지 탭 카테고리 드롭다운 제거

## 배경
PHOTO-CAPTURE(703c542) 배포 후 김주연 총괄 피드백.
[사진촬영] 버튼 클릭 시 시술전/후 선택 다이얼로그가 이미 카테고리 분류 처리.
진료이미지 탭 상단 "기타/시술전/시술후" 드롭다운과 중복 → 제거.

## AC 체크리스트

- [x] **AC-1**: `/chart/{id}/images` 상단 카테고리 드롭다운 (`<select>`) 제거
- [x] **AC-2**: 수동 업로드([업로드] 버튼) 클릭 시 분류 다이얼로그(시술전/시술후/기타) 표시 → 파일피커 오픈 (방법A)
- [x] **AC-3**: 드롭다운이 목록 필터 겸용인지 확인 — 확인 결과 **필터 용도 없음** (uploadType 상태는 파일명 접두사에만 사용). 별도 분리 불필요
- [x] **AC-4**: PHOTO-CAPTURE 회귀 없음 + 기존 이미지 기능 정상. 빌드 통과

## 구현 내역

### 제거
- `TreatmentImagesSection` 내 `<select value={uploadType} ...>` 드롭다운 (lines ~736-744)
- 기존 `<label>` 래핑 파일인풋 구조

### 추가
- `uploadTypeDialogOpen: boolean` 상태
- `fileInputRef: React.RefObject<HTMLInputElement>` — 프로그래매틱 파일피커 트리거
- `<input ref={fileInputRef} type="file" ...>` (hidden, label 아닌 ref 방식)
- `<button onClick={() => setUploadTypeDialogOpen(true)}>업로드</button>`
- 업로드 분류 다이얼로그: 시술 전(파란색) / 시술 후(에메랄드) / 기타(회색) 3버튼 → 선택 즉시 fileInputRef.click()

### 일관성
- 카메라 모달 타입 선택 다이얼로그와 동일한 UX 패턴
- `handleUpload`는 수정 없음 — `uploadType` 상태가 파일명 접두사 결정

## DB 변경
없음

## 빌드
```
✓ built in 3.29s (no errors, no warnings)
```
