# 회귀 보호 spec 카탈로그

본 폴더의 spec은 **사용자/QA 발견 회귀**의 자동 회귀 방지 자산.

## 정책

- **머지 조건**: 사용자 발견 회귀 fix PR은 본 폴더에 spec 추가 없으면 reject
- **24h 룰**: 회귀 발견 후 24h 내 spec 작성
- **명명 규칙**: `R-{YYYYMMDD}-{shortname}.spec.ts`
- **CI**: `.github/workflows/e2e.yml`이 본 폴더 자동 실행 (qa-005 후속)

## 등록 spec → 회귀 ID 매핑

| spec | 회귀 ID | 분류 |
|---|---|---|
| (현재 `tests/e2e/foot-qa-r1-*.spec.ts`에 분산) | R-2026-04-26-001~005 | NOT_NULL/RLS/PERMISSION/UI_RENDER |

> **이관 작업 (qa-004 후속)**: 기존 foot-qa-r1-*.spec.ts를 본 폴더로 이전 + R-ID 명명으로 rename

## 카탈로그 마스터
`memory/2_Areas/204_오블리브_종로점오픈/regression_catalog.md` 참조 (사람이 읽는 기록).

## 추가 가이드

신규 회귀 발견 시:
1. `regression_catalog.md`에 entry append
2. 본 폴더에 `R-{date}-{shortname}.spec.ts` 작성
3. 시드 + cleanup 자동 (after hooks)
4. fix commit 메시지에 `[R-{date}-{shortname}]` 태그
