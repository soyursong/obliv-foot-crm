---
id: T-20260525-foot-ROLE-PERM-CUSTOM
domain: foot
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: tests/e2e/T-20260525-foot-ROLE-PERM-CUSTOM.spec.ts
summary: "consultant에 messaging 권한 추가(A안) — 통계·매출집계·계정관리 제외 전권한 포지션"
---

# T-20260525-foot-ROLE-PERM-CUSTOM: 통계·매출집계·계정관리 제외 전권한 포지션

## 요청
통계·매출집계·계정관리 제외, 나머지 전 메뉴 열린 포지션.

## GAP 분석 결과
`consultant` 역할이 95% 일치. 유일한 GAP = **메시지설정(messaging) 접근 누락**.

| 메뉴 | consultant 현황 | 목표 | 조치 |
|------|-----------------|------|------|
| 대시보드 | ✅ | ✅ | 유지 |
| 예약관리 | ✅ | ✅ | 유지 |
| 고객관리 | ✅ | ✅ | 유지 |
| 패키지 | ✅ | ✅ | 유지 |
| 진료도구 | ✅ | ✅ | 유지 |
| 서비스관리 | ✅ | ✅ | 유지 |
| 직원·공간 | ✅ | ✅ | 유지 |
| 병원·원장 정보 | ✅ | ✅ | 유지 |
| 치료 테이블 | ✅ | ✅ | 유지 |
| 일마감 | ✅ | ✅ | 유지 |
| 일일 이력 | ✅ | ✅ | 유지 |
| **메시지 설정** | ❌ | ✅ | **A안: consultant 추가** |
| 통계 | ❌ | ❌ | 제외 유지 |
| 매출집계 | ❌ | ❌ | 제외 유지 |
| 계정관리 | ❌ | ❌ | 제외 유지 |

## 접근방식: A안 채택
- FE 2줄 변경 (DB 변경 없음, RLS 불변)
- `permissions.ts`: `messaging` 배열에 `'consultant'` 추가
- `AdminLayout.tsx`: settings NAV_ITEM roles에 `'consultant'` 추가

## 변경 파일
- `src/lib/permissions.ts` — messaging 권한에 consultant 추가
- `src/components/AdminLayout.tsx` — NAV_ITEMS settings에 consultant 추가
- `playwright.config.ts` — unit 프로젝트에 spec 등록

## AC 체크리스트
- [x] AC-1: GAP 조사 확인 (messaging만 GAP) + 접근방식 확정 (A안)
- [x] AC-2: 권한 매트릭스 수정 (permissions.ts + AdminLayout.tsx)
- [x] AC-3: 제외 3종 검증 (stats/register/accounts — consultant 없음 유지)
- [x] AC-4: RLS 정합성 — A안 DB 변경 없음, RLS 불변

## 테스트
- 빌드: `npm run build` ✅ (3.32s)
- Playwright unit: 6/6 통과
- DB 변경: 없음
