# 풋센터 CRM — 환경변수 매트릭스 (ENV MATRIX, 권위 선언)

> 목적: supervisor 배포 QA phase1.5 "빌드 env 매트릭스" 게이트(dev_ops_policy.md v2.2)의
> **REQUIRED vs OPTIONAL 판정 권위 소스**. 이 표가 `import.meta.env.VITE_*` 사용처의
> 운영 주입 의무를 정의한다.
>
> 게이트 규약(요지): `import.meta.env.*` 사용처 전수 grep → REQUIRED 변수는 운영 bundle에
> 주입 값 ≥1건 매치 필수. **OPTIONAL 변수는 미주입(빈 값 graceful fallback)을 정상으로 간주
> = env_missing 블로커 아님.** (2026-05-08 dopamine VITE_CTI_DISPATCH_URL 누락 사고 재발방지가
> 게이트 취지 — 그 사고는 REQUIRED 변수였다. OPTIONAL 변수는 취지 대상 외.)

## REQUIRED (운영 미주입 = 배포 블로커)

| 변수 | 용도 | 미주입 시 |
|------|------|-----------|
| `VITE_SUPABASE_URL` | Supabase 운영 DB URL | 앱 부팅 불가 — 전 기능 중단 |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon(공개) 키 | 인증·데이터 호출 전면 실패 |
| `FOOT_ORIGIN_SLUG` | 도파민 push·cross-CRM 귀속 origin slug | 리드 귀속 오류 |

→ 2026-06-30 `vercel env ls production` 확인: 위 3개 모두 등록됨(Production).

## OPTIONAL (운영 미주입 = 정상 graceful fallback, 블로커 아님)

| 변수 | 용도 | 미주입 시 동작(설계) | 코드 근거 |
|------|------|----------------------|-----------|
| `VITE_KAKAO_REST_API_KEY` | 외국인 셀프접수 국내체류지(숙소) 주소검색 — 카카오 로컬 API REST 키(무료티어, A안 MSG-20260625-145747-roay) | 빈 값 → `manualMode=true` 초기화 → 숙소검색 위젯이 **수기 주소입력**으로 자동 전환. 예약/고객/체크인 등 타 기능과 무관(Supabase만 사용). | `src/components/ForeignStayAddressInput.tsx` L86–88 (`apiKey ?? ''` → `useState(!apiKey)`), L127–133 (호출 실패 시에도 `setManualMode(true)` fallback) |

### OPTIONAL 변수의 구조적 grep 한계 (중요)
- Vite는 빌드타임에 `import.meta.env.VITE_KAKAO_REST_API_KEY`를 **값으로 인라인**한다.
  미주입(빈 값)이면 `''`로 인라인 → **변수명도 값도 bundle에 나타나지 않음**.
- 따라서 OPTIONAL 빈 변수는 bundle grep으로 "주입 여부"를 절대 검증할 수 없다(항상 0건).
  이는 키 미발급 상태의 **정상**이며 버그가 아니다.
- 카카오 검색을 운영 활성화하려면: 카카오 개발자콘솔에서 REST 키 발급(사람 액션) →
  `vercel env add VITE_KAKAO_REST_API_KEY production` → 재배포. (도메인 제한 설정 필수 — 프론트 노출 키)
  키 발급 전까지는 빈 값 유지 = 수기입력 모드로 정상 운영.

## 변경 이력
- 2026-06-30: 신설. T-20260630-foot-REVISIT-CHECKIN-AUTOASSIGN-SKIP QA phase1.5 env_missing
  false-positive(VITE_KAKAO_REST_API_KEY=OPTIONAL) 해소 근거. supervisor 게이트 OPTIONAL 예외 권위 소스.
