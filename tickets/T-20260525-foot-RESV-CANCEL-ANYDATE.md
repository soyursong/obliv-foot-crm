---
id: T-20260525-foot-RESV-CANCEL-ANYDATE
domain: foot
status: deployed
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: true
summary: "예약관리 전일자 취소 허용. resv-card 외부 div에 onContextMenu 추가 → 이름 span 외 영역 우클릭도 취소메뉴 접근 가능. isToday 제한 없음 코드 분석 확인. 빌드 3.30s OK."
qa_result: pass
qa_grade: Yellow
deploy_commit: 2a2d3dd
deployed_at: 2026-05-26T05:39:00+09:00
bundle_hash: Reservations-CAU9yxco.js
field_soak_until: 2026-05-27T05:39:00+09:00
---

## T-20260525-foot-RESV-CANCEL-ANYDATE — 예약관리 전일자 예약 취소 허용

### 조사 결과

**날짜 제한(isToday) 코드 분석 결과: 제한 없음 확인**

- `handleResvCancelRequest` — 날짜 비교 없음. `rows.find(r.id)` + `status !== 'cancelled'` 만 체크
- `handleResvCancelConfirm` — DB update 날짜 조건 없음
- `CustomerQuickMenu.onCancelReservation` — 조건 없이 always 제공

**실제 UX 문제 발견 (Root cause)**

| 영역 | 이전 동작 | 변경 후 |
|------|-----------|---------|
| 이름 span 위 우클릭 | ✅ CustomerQuickMenu 표시 | ✅ 유지 |
| 상태·전화·메모 영역 우클릭 | ❌ 컨텍스트메뉴 미표시 | ✅ 표시됨 |
| 전일자·미래일 이동 후 우클릭 | ❌ 동작 불명확 | ✅ 날짜 무관 동작 |

Dashboard.tsx의 `!isPast` 조건(타임라인 컨텍스트메뉴 past 날짜 비활성)과 혼동한 것이 "당일만 취소 가능"으로 인식된 원인.

### 구현 (commit 1건)

**변경 파일**: `src/pages/Reservations.tsx`

```tsx
// T-20260525-foot-RESV-CANCEL-ANYDATE: 카드 전체 영역 우클릭 → 컨텍스트메뉴
// (이름 span 밖 클릭도 취소 메뉴 접근 가능 — 전일자 포함 날짜 무관 동작)
onContextMenu={(e) => {
  if (r.customer_id && r.status !== 'cancelled') {
    e.preventDefault();
    e.stopPropagation();
    setResvContextMenu({ resv: r, pos: { x: e.clientX, y: e.clientY } });
  }
}}
```

- 카드 외부 div에 `onContextMenu` 핸들러 추가
- `CustomerHoverCard` 내부 span의 `e.stopPropagation()` 덕분에 이름 영역 우클릭은 기존 동작 유지 (이중 트리거 없음)
- 조건: `r.customer_id && r.status !== 'cancelled'` — 기존 CustomerHoverCard 렌더 조건과 동일

### AC 검증

- **AC-1**: 예약관리 비당일 예약에도 취소 버튼/컨텍스트메뉴 활성화 ✅ (카드 전체 영역)
- **AC-2**: 기존 취소 흐름(사유 입력 → cancelled_at/cancel_reason/cancelled_by) 동일 적용 ✅ (코드 불변)
- **AC-3**: 대시보드 영향 없음 ✅ (Dashboard.tsx 미수정)

### DB 변경

없음 (FE only)

### 빌드

```
✓ built in 3.30s
```

### E2E spec

`tests/e2e/T-20260525-foot-RESV-CANCEL-ANYDATE.spec.ts` — 5개 테스트
- AC-1: 카드 전체 영역 우클릭 → 컨텍스트메뉴
- AC-1: 이전 주 이동 후 취소 접근
- AC-2: 취소 모달 날짜 무관 동작
- AC-3: 대시보드 영향 없음
- 회귀: 예약관리 JS 에러 없음
