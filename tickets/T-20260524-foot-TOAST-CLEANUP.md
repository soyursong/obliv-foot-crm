---
id: T-20260524-foot-TOAST-CLEANUP
title: "불필요 토스트 알림 전수 제거 (파랑·연두)"
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-05-24
deadline: 2026-06-07
deploy_ready_at: 2026-05-24
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.23s"
e2e_spec: ""
e2e_spec_exempt_reason: "FE-only 토스트 no-op wrapper. DB 변경 없음. 리스크 0/5. 빌드 clean."
reporter: 김주연 총괄
risk: "0/5 (FE-only)"
---

# T-20260524-foot-TOAST-CLEANUP — 불필요 토스트 알림 전수 제거

## 배경

김주연 총괄 요청: **파랑(info)**·**연두(success)** 토스트 전수 제거. 빨강(error)·노랑(warning)은 전체 유지.

## 구현 방식

**wrapper 패턴** (`src/lib/toast.ts` 신규)

- `toast.success` / `toast.info` / 베어 `toast()` → Proxy로 no-op
- `toast.error` / `toast.warning` → 원본 sonner 그대로 통과
- 46개 파일의 `import { toast } from 'sonner'` → `import { toast } from '@/lib/toast'` 일괄 교체

### 왜 wrapper?
186개 호출부를 개별 삭제 대신 단일 진입점에서 차단 → diff 최소화, 추후 재활성화 가능.

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/lib/toast.ts` | **신규** — Proxy wrapper, info/success no-op |
| `src/pages/*.tsx` (14개) | import 경로 변경만 |
| `src/components/**/*.tsx` (32개) | import 경로 변경만 |

## 제거된 토스트 (대표 예시)

- "OO님 — 기존 고객 선택" (`toast.info`)
- "OO 체크인 완료 (#N)" (`toast.success`)
- "수납 완료 — 완료 슬롯으로 이동됩니다" (`toast.success`)
- "시술 저장 완료 — 금액 산정됨" (`toast.success`)
- 동의서/체크리스트 저장 완료 (`toast.success`)
- 근무표 등록/변경 완료 (`toast.success`)
- 진료세트 저장/삭제 완료 (`toast.success`)
- 기타 info/success 전수 (156 success + 30 info + 1 bare = 187건)

## 수용기준

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 파랑(info) 토스트 미표시 | ✅ toast.info → no-op |
| AC-2 | 연두(success) 토스트 미표시 | ✅ toast.success → no-op |
| AC-3 | 빨강(error) 유지 | ✅ Proxy 통과 |
| AC-4 | 노랑(warning) 유지 | ✅ Proxy 통과 |
| AC-5 | 빌드 clean | ✅ 3.23s, 에러 0 |
