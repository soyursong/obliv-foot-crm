---
id: T-20260520-foot-PAYMENT-MINI-UX
title: "결제미니창 UX 개선 4건 (상병코드 소형화·Zone2 확장·금일 시술내역 연동·수납대기 직결)"
status: deployed
priority: P0
domain: foot
created_at: 2026-05-20
deploy_ready_at: 2026-05-20
commit_sha: 55d7753
deploy_commit: 00d349574edbc0c0536c31cce581170be83797f3
deployed_at: 2026-05-20T21:19:54+09:00
qa_result: pass
qa_grade: Green
bundle_hash: index-B6S5uvGO.js
db_migration: false
build_passed: true
e2e_spec: tests/e2e/T-20260520-foot-PAYMENT-MINI-UX.spec.ts
field_soak_until: 2026-05-21T21:19:54+09:00
deadline: 2026-05-22
---

## 현장 보고

김주연 총괄 직접 긴급 지시(2026-05-20): "결제 부분이 최우선!" hotfix 지정. deadline 2026-05-22.

## 수용기준 (4건) / 구현 내용

### AC-1: 상병코드/처방약 카테고리 박스 소형화 (PaymentMiniWindow.tsx)

**변경 위치**: L1255 부근 — 상병코드/처방약 탭 리스트

| Before | After |
|--------|-------|
| `w-full text-left px-3 py-2.5 min-h-[44px]` 대형 리스트 | `grid-cols-2 lg:grid-cols-3` 소형 그리드 |
| 한 번에 4~6개만 보임 | 한 눈에 전체 카테고리 노출 |

- 풋케어 탭과 동일한 그리드 패턴 재사용
- `min-h-[56px] sm:min-h-[48px]` — 모바일 터치 영역 유지
- 코드명 `text-[10px] line-clamp-2` + 서비스코드 `text-[9px] text-blue-500`

### AC-2: 차트코드+진료비 산정 구역 확장 (PaymentMiniWindow.tsx)

**변경 위치**: Zone2 컨테이너 + 코드번호 span

| 항목 | Before | After |
|------|--------|-------|
| Zone2 폭 | `sm:w-52 md:w-56 lg:w-60` | `sm:w-60 md:w-64 lg:w-72` |
| 차트코드 열 | `w-14` | `w-9` (더 작아도 OK) |

- 코드명·금액 표시 영역 확보 → 잘림 해소
- 총 폭 1080px DialogContent 내 수용 (Zone1 sm:w-20 + Zone2 sm:w-60 + Zone3 sm:w-52)

### AC-3: 금일 시술내역-2번차트 연동 수정 (PaymentMiniWindow.tsx)

**변경 위치 1**: `loadZone3Data` — todayCIIds 쿼리

```typescript
// 현재 checkIn.id 강제 포함 (timezone 불일치로 날짜 필터에서 누락 방지)
const todayCIIds = [...new Set([ci.id, ...(ciRes.data ?? []).map((c) => c.id)])];
```

**변경 위치 2**: `handleSaveFull` / `handleSaveDeduct` — 저장 후 Zone3 즉시 갱신

```typescript
// AC-3: 저장 후 금일 시술내역(Zone3) 즉시 갱신 — 2번차트 연동
loadZone3Data(checkIn);
```

- 문제: 창 열릴 때 한 번만 로드 → 저장 후에도 stale
- 문제: 날짜 필터(`T00:00:00` timezone 미지정) → 현재 체크인 누락 가능
- 해결: 저장 성공 시 즉시 reload + 현재 CI ID 명시적 포함

### AC-4: 수납대기 → PaymentMiniWindow 직결 (Dashboard.tsx)

**변경 위치**: `handleContextStatusChange` L3160 + `handleContextLaserStatusChange` L3287

```typescript
// Before: setPaymentTarget({ ...row, status: newStatus });
// After:  setMiniPayTarget({ ...row, status: newStatus });
```

- 수납대기로 슬롯 이동 시 기존 `PaymentDialog` 대신 `PaymentMiniWindow` 오픈
- 2개 진입점 모두 수정 (드래그 + 컨텍스트 메뉴 status 변경)
- `handleOpenPaymentFromMenu`는 이미 `setMiniPayTarget` 사용 중 — 일관성 완성

## 영향 범위

- `PaymentMiniWindow.tsx`: AC-1 (상병코드/처방약 그리드), AC-2 (Zone2 폭+코드열), AC-3 (연동 수정)
- `Dashboard.tsx`: AC-4 (status 전환 2곳 → miniPayTarget)
- DB 변경 없음 / 신규 패키지 없음

## 빌드

```
✓ built (npm run build 확인)
```

## 주의사항

- T-20260520-foot-PAYMENT-RESPONSIVE 동시 수정 주의 → 동일 파일 PaymentMiniWindow.tsx. 반응형 클래스 충돌 없음 확인.
- Zone2 폭 확장(sm:w-52→w-60)으로 총 3열 합계가 1080px을 초과하지 않음 (sm: 20+60+52=132 = ~528px, 여유 있음)
