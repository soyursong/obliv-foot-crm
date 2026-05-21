---
id: T-20260521-foot-HEALER-RESV-RECHECK
domain: foot
status: deploy-ready
deploy-ready: true
priority: P2
created: 2026-05-21
completed: 2026-05-21
db_change: false
spec_file: tests/e2e/T-20260521-foot-HEALER-RESV-RECHECK.spec.ts
parent: T-20260516-foot-HEALER-RESV-BTN
---

# T-20260521-foot-HEALER-RESV-RECHECK — 힐러예약 재진 슬롯 깜빡 + 셀프접수 자동 HL 미동작 수정

## 개요

현장에서 T-20260516-foot-HEALER-RESV-BTN(b059856) 배포 후 두 가지 기능 미동작 보고 → 원인 분석 + 수정.

## 근본 원인 분석

### AC-1(재진 슬롯 깜빡) — CSS 가시성 버그
- **원인**: 원래 애니메이션이 `amber-400(#fbbf24) ↔ amber-500(#f59e0b)` 교번 → 두 색이 유사해 `bg-green-50/border-green-300` 카드 위에서 거의 식별 불가
- **수정(7c1e9c3)**: `amber-400(#fbbf24) ↔ green-300(#86efac)+glow` 교번으로 명확한 대비 확보

### AC-2(셀프접수 자동 HL) — handleHealerFlag 당일 제외 버그
- **원인**: `handleHealerFlag()` 내 `reservation_date > today` (엄격 미래) → 당일 예약은 nextResv에서 제외
- 결과: 당일 예약에 `healer_flag=true` 미설정, `pending_healer_flag=true`로 fallback
- `fetchCheckIns` 자동 HL 로직은 `reservations.healer_flag=true`만 확인 → HL 미동작
- **수정(7c1e9c3)**: `>= today`로 변경해 당일 예약 포함

### AC-5(버튼 display 불일치) — RECHECK에서 추가 발견
- `handleHealerFlag`(line 1835)는 `>= today`로 수정됐으나 버튼 display nextResv 계산(line 4081)은 여전히 `> today`
- 결과: 스태프가 [힐러예약 후 차감] 클릭 → `healer_flag=true` 정상 설정 → 버튼이 비활성 표시로 남아 혼란
- **수정(RECHECK)**: 버튼 display도 `>= today`로 통일

## 변경 사항

| 파일 | 변경 내용 | 커밋 |
|------|-----------|------|
| `src/index.css` | healer-border-blink: amber↔amber → amber↔green+glow | 7c1e9c3 |
| `src/pages/CustomerChartPage.tsx` | handleHealerFlag `> today` → `>= today` | 7c1e9c3 |
| `src/pages/CustomerChartPage.tsx` | 버튼 display nextResv `> today` → `>= today` | RECHECK |
| `tests/e2e/T-20260521-foot-HEALER-RESV-RECHECK.spec.ts` | RECHECK 검증 spec 5개 테스트 | RECHECK |

## AC 체크리스트

- [x] **AC-1**: 재진 슬롯 깜빡 CSS animation — amber-400↔green-300 명확 교번 (가시성 확보)
- [x] **AC-2**: 셀프접수 자동 HL — handleHealerFlag `>= today` + fetchCheckIns healer_flag 쿼리 정상
- [x] **AC-3**: 체크인 전→후 전환 동선 E2E — 대시보드+칸반+셀프접수 에러 없음
- [x] **AC-4**: HEALER-RESV-BTN 핵심 기능 회귀 없음 확인
- [x] **AC-5(추가)**: 버튼 display nextResv도 `>= today` 통일 (display 불일치 수정)

## 빌드

```
✓ built in 3.14s — DB 변경 없음
```

## 메모

- 이미 `pending_healer_flag=true`인 구 데이터(버그 기간 설정분)는 신규 예약 생성 시 `healer_flag` 자동 적용(AC-8 로직)으로 처리됨 — 별도 데이터 마이그레이션 불필요
