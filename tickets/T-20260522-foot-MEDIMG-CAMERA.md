---
id: T-20260522-foot-MEDIMG-CAMERA
title: "진료이미지 [사진촬영] 버튼 — 시술 전/후 선택 + 연속촬영 + 자동업로드 + 편집/회전"
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-05-22
deadline: 2026-06-05
go_warn: true
deploy_ready: true
deploy_ready_at: 2026-05-22
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.30s"
commit_sha: 1d6634a
e2e_spec: tests/e2e/T-20260522-foot-MEDIMG-CAMERA.spec.ts
signals_recorded: true
---

## 개요

고객차트(2번차트) 진료이미지 탭에 [사진촬영] 버튼을 추가.
S Pen 태블릿에서 원내에서 직접 시술 전/후 사진 촬영 → Supabase Storage 자동업로드.
편집/회전 기능까지 Canvas API로 구현 (신규 npm 패키지 없음).

## 구현 (이미 배포됨: commit 1d6634a)

### AC-1: [사진촬영] 버튼
- `TreatmentImagesSection` 업로드 바에 teal-600 강조 버튼 추가

### AC-2: 시술 전/후 선택 (fullscreen 모달)
- black 배경, 시술 전(blue) / 시술 후(emerald) 대형 버튼
- `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`

### AC-3: 연속촬영
- 셔터 버튼 (큰 원형, S Pen 대응)
- 촬영된 사진 우상단 썸네일 + 개별 취소 가능
- 완료(N장) 버튼으로 일괄 업로드

### AC-4: 자동업로드 + 프로그레스
- Supabase Storage `photos` 버킷 → `customer/{id}/treatment-images/{type}_{ts}_{rand}.jpg`
- 업로드 중 프로그레스바 (done/total)

### AC-5: 편집/회전
- 이미지 hover → RotateCw 버튼 → 편집 모달
- Canvas API로 90도 단위 좌/우 회전 → 원본 삭제 후 회전본 재업로드

### AC-6: 태블릿(S Pen) 대응
- `video ref callback` 방식으로 DOM 마운트 직후 스트림 연결
- `playsInline muted autoPlay` 속성

## 참고

GO_WARN: 브라우저 카메라 권한 팝업이 최초 1회 발생. 현장 안내 필요.
CheckInDetailSheet(1번차트)는 파일 업로드만 유지 (카메라 미적용 — 별도 P3 판단).
