---
id: T-20260522-foot-PENCHART-PEN-OFFSET
domain: foot
status: deploy-ready
deploy-ready: true
commit_sha: b9cd022
build_ok: true
db_changed: false
spec_file: tests/e2e/T-20260522-foot-PENCHART-PEN-OFFSET.spec.ts
risk: GO
created_at: 2026-05-22
completed_at: 2026-05-22
priority: P1
deadline: 2026-05-23
---

# T-20260522-foot-PENCHART-PEN-OFFSET (P1 hotfix)

펜으로 쓰면 터치 위치와 다른 곳에 써지는 버그 수정.

## 원인

`PenChartTab.tsx`의 `getPos()` 함수에서 `scaleY = CANVAS_H(1020) / rect.height` 하드코딩.
`refund_consent` 양식(CANVAS_H_REFUND_CONSENT=3052px) 진입 시 `scaleY ≈ 0.334`로 오산 →
y=2800 터치 → 실제 드로잉 y≈936 (상단 집중).

## 수정

`canvas.width / dpr` · `canvas.height / dpr`로 논리 픽셀을 동적 계산.
모든 양식(1020px, 3052px, 향후 가변)에서 scaleX/scaleY=1.0 보장.

## AC 검증

- AC-1: scaleY = 1.0 (pen 좌표 일치) ✓
- AC-2: 모든 양식 동일 ✓
- AC-3: 상단·중앙·하단 정확 ✓
- AC-4: 스크롤 후 좌표 정확 ✓
- AC-5: 빌드 OK + 16/16 spec 통과 ✓
