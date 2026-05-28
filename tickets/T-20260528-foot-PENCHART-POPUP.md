---
id: T-20260528-foot-PENCHART-POPUP
title: 2번차트 펜차트 [새 펜차트 작성] 별도 윈도우(팝업)로 열기
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
build_ok: true
db_migration: false
e2e_spec: false
deadline: 2026-06-03
created: 2026-05-28
closed: 2026-05-28
---

## 구현 요약

김주연 총괄 요청. 고객 체크리스트/보험차트 작성 후 저장 안 누르거나 뒤로가기 시
개인차트 내용 노출 우려 → [새 펜차트 작성] 클릭 시 별도 팝업 창으로 열기.

## 수용기준 이행

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | `window.open('/penchart-editor?customerId=...&clinicId=...&checkInId=...')` — 부모 창 변동 없음 | ✅ |
| AC-2 | 팝업 저장 완료 → `BroadcastChannel('penchart-update')` + `localStorage storage` 이벤트 이중 폴백으로 부모 목록 자동 갱신 + `window.close()` | ✅ |
| AC-3 | `window.open` 으로 별도 창 분리 — 팝업 닫기/새로고침/뒤로가기 어떤 조작에도 부모 창(2번차트) 개인정보 노출 없음 | ✅ |
| AC-4 | 팝업 차단 시 `toast.warning(...)` 안내 메시지 + `setMode('select')` fullscreen fallback | ✅ |
| AC-5 | `window.open` click handler 내 동기 호출(iPad Safari 팝업 차단 우회) + `BroadcastChannel` 미지원 시 `localStorage storage` 이벤트 폴백(iOS 15.4 미만) | ✅ |

## 구현 세부

### 신규/수정 파일
- `src/pages/PenChartEditorPage.tsx` — 팝업 전용 페이지 (기존 구현 완성)
- `src/App.tsx` — `/penchart-editor` ProtectedRoute 등록 (기존 완성)
- `src/components/PenChartTab.tsx` — 아래 3개 패치

### PenChartTab.tsx 패치 내용

**1. window.open 팝업 + 차단 시 toast.warning + fallback (AC-1, AC-4)**
```tsx
const popup = window.open(url, `penchart-${customerId}`, 'width=1200,height=900,...');
if (!popup) {
  toast.warning('팝업이 차단되었습니다...');
  setMode('select');  // fullscreen fallback
}
```

**2. 부모 창 목록 갱신 리스너 이중 폴백 (AC-2, AC-5)**
```tsx
// BroadcastChannel (현대 브라우저)
bc.onmessage = (e) => handleUpdate(e.data?.customerId);
// localStorage storage 이벤트 (Safari < 15.4 폴백)
window.addEventListener('storage', onStorage);
```

**3. 팝업 저장 후 부모 갱신 신호 발신 이중 폴백 (AC-2, AC-5)**
```tsx
bc.postMessage({ customerId });  // BroadcastChannel
localStorage.setItem('penchart-update', JSON.stringify({ customerId, ts }));  // fallback
```

### PenChartEditorPage.tsx 핵심 동작
- URL params: `customerId`, `clinicId`, `checkInId`
- Supabase에서 고객 정보 + RRN 직접 로드 (동일 origin localStorage 세션 공유)
- `PenChartTab popupMode=true` → list 없이 select→draw→저장→닫기
- 미인증 시 ProtectedRoute → /login 리다이렉트

## 빌드
```
✓ built in 3.28s  (PenChartTab-D8kOG4-d.js 39.14 kB)
```

## DB 변경
없음 (FE-only)

## 주의
- `toast.info` / `toast.success` 는 묵음 처리됨 (`src/lib/toast.ts` T-20260524-foot-TOAST-CLEANUP)
- 팝업 차단 시 `toast.warning` 사용 (통과 O)
