---
id: T-20260522-foot-PENCHART-SCROLL-BLOCK
domain: foot
status: deploy-ready
deploy-ready: true
commit_sha: TBD
build_ok: true
db_changed: false
spec_file: tests/e2e/T-20260522-foot-PENCHART-SCROLL-BLOCK.spec.ts
risk: GO
created_at: 2026-05-22
completed_at: 2026-05-22
priority: P1
deadline: 2026-05-23
---

# T-20260522-foot-PENCHART-SCROLL-BLOCK (P1 hotfix)

3페이지 PDF (환불/비급여 동의서) 스크롤 불가 버그 수정.

## 원인

Canvas `touchAction: 'none'` → 모든 touch 이벤트를 캡처.
`onPointerDown`에서 pointerType 분기 없이 touch도 드로잉 처리 → 스크롤 완전 차단.

## 수정 (방안 A: pointerType 분기)

1. Canvas `touchAction: 'none'` → `'pan-y'`: 브라우저가 touch 수직 스크롤 처리
2. `onPointerDown` / `onPointerMove`: `pointerType === 'touch'`면 조기 리턴
3. 이중 방어로 touch → 스크롤, pen/mouse → 드로잉 완전 분리

## AC 검증

- AC-1: 스크롤/드로잉 분리 ✓
- AC-2: 3페이지 전체 탐색 가능 ✓
- AC-3: pen/mouse 드로잉 유지 ✓
- AC-4: 어르신용 질문지(2p) 동일 ✓
- AC-5: 빌드 OK + 16/16 spec 통과 ✓
