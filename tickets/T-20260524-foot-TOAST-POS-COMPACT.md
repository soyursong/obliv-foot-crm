---
id: T-20260524-foot-TOAST-POS-COMPACT
title: "알림 팝업 위치 중앙 상단 변경 + compact 축소"
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-05-24
deadline: 2026-06-07
deploy_ready_at: 2026-05-24
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.17s"
e2e_spec: ""
e2e_spec_exempt_reason: "FE-only Toaster prop 변경. DB 변경 없음. 리스크 0/5. 빌드 clean."
reporter: 김주연 총괄
risk: "0/5 (FE-only)"
---

# T-20260524-foot-TOAST-POS-COMPACT — 알림 팝업 위치 변경 + compact

## 배경

김주연 총괄 요청: 알림 팝업이 우측 상단에 생성되어 차트 저장/삭제 버튼과 겹침.
위치를 중앙 상단으로 변경 + 크기 축소.

## 구현

**파일**: `src/App.tsx` — `<Toaster>` props 변경 (line 85)

```tsx
// 변경 전
<Toaster richColors position="top-right" />

// 변경 후
<Toaster
  richColors
  position="top-center"
  gap={8}
  toastOptions={{
    classNames: {
      toast: 'py-2 px-3 gap-2 min-w-0 max-w-xs text-sm',
      title: 'text-sm font-medium leading-tight',
      description: 'text-xs leading-snug',
      icon: 'w-4 h-4 shrink-0',
    },
  }}
/>
```

- `position`: `top-right` → `top-center` (차트 버튼 겹침 해소)
- `gap={8}`: 토스트 간 간격 축소 (기본 14px → 8px)
- `toastOptions.classNames`: 패딩·폰트·아이콘 compact 처리

## 수용기준

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | toast position `top-right` → `top-center` | ✅ |
| AC-2 | toast compact화 (패딩·폰트·아이콘 축소) | ✅ toastOptions.classNames |
| AC-3 | error/warning toast 정상 동작 유지 | ✅ richColors 유지, 색상 영향 없음 |
| AC-4 | 차트 우측 상단 저장/삭제 버튼 겹침 해소 | ✅ top-center로 이동 |
| AC-5 | 빌드 clean | ✅ 3.17s, 에러 0 |
