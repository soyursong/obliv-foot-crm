# 심층 RC — "금일 배분 이력 총괄 뷰에서만 empty" (증상①)

read-only 조사. 코드/DB 무변경. HOLD·prod 무접촉 유지. db_change=false. deploy-ready 마킹 없음.

배경: 총괄(U0ATDB587PV) 17:02 = "13:00부터 연동 안됨 + 새로고침해도 안 됨". 16:50 stale-cache RC(새로고침 권고)가 필드서 실패 중. 프레시번들 DB 실측은 정상(행 존재).

## 데이터 경로 (금일 배분 이력 = todayDistribution)
- `src/pages/Assignments.tsx` `load()` (L547~741) 이 두 소스를 fetch:
  - `assignment_actions` (L634) `.eq('clinic_id', clinic.id).gte('created_at', monthStart)`
  - `check_ins` monthCheckIns (L644) `.eq('clinic_id', clinic.id).gte('checked_in_at', monthStart)`
- `todayDistribution` useMemo (L1451) 이 위 둘을 오늘 경계로 client-side 필터해 표 구성.

## 4각도 판정

### 1) 계정/지점 scope — **無 (FE 쿼리에는 없음, 잔여 RLS 가설만)**
- `getClinic()`(src/lib/clinic.ts L4·L21)은 **하드코딩 slug='jongno-foot' 싱글톤**. 로그인 계정·branch·staff scope에 무관하게 모든 계정이 동일 clinic.id 로 해석됨.
- 배분이력 쿼리에 branch/staff/consultant scope 필터 **없음**. → 총괄 뷰에서만 0-row 로 떨어질 FE-level scope 경로 없음.
- 단, `if (!clinic) return`(L548): 총괄 계정이 RLS로 `clinics` single() read 거부 시 → getClinic throw → useClinic catch가 `prev ?? null` 유지 → clinic=null → load 조기반환 → 표 empty. (2차 가설, 아래 3)과 합류)

### 2) timezone/날짜 경계 — **無 (정상 처리)**
- 경계 전부 명시 KST: `todaySeoulISODate()`(en-CA/Asia/Seoul) + `T00:00:00+09:00`, epoch(ms) 비교(L1453). 13:00 배정분은 오늘 창 안. → 원인 아님.

### 3) 세션/권한/토큰 silent 0-row — **有 (최유력 RC · 코드 gap)**
- load()의 read들은 대부분 `const { data } = await supabase...` 로 **error 무시**. supabase-js `.select()`는 HTTP 401/RLS-deny에 throw하지 않고 `{data:null,error}` 반환 → `setActions(data ?? [])` = **조용히 빈 배열**. 배너·throw·console.warn 전부 없음.
- refresh-401 인프라(T-20260818 resilientFetch)의 분류:
  - `expired_token`(access_token exp≤now+30s) / `anon_or_no_session` → **refresh-401 아님 → 재시도 X, 배너 X, 401 그대로 통과 → silent empty.**
  - `refresh_401`(유효 JWT인데 gateway 401) → GET만 maxRetries=3 backoff 후 소진 시 401 반환 → silent empty (retry 중에만 배너).
- ★ "13:00 지속 + 새로고침 무효 + 배너 없음"과 정합: 총괄 계정 refresh 토큰이 13:00경 죽으면(장기 idle·세션 revoke·비번변경·clock skew) 매 read가 만료 bearer로 401 → 조용히 empty. **F5는 저장된 동일 토큰 재사용 → 같은 401**. 완전 재로그인(새 토큰)만 해소. DB 행 정상(서버엔 있음)·클라 인증컨텍스트만 0-row 인 현상과 완전 부합.

### 4) 쿼리 필터 잔여 — **無 (배분 이력에는 미적용)**
- 부모 fix 11ae92bb(재진 fail-open)는 **배정 큐(todayRows/pullCandidates)** 대상. `todayDistribution`은 재진/consult_notify_status/assigned_staff 필터 **미적용** — date + cancelled + deleted_at 만. → 재진필터 잔여가 배분이력을 비우지 않음.

## 결론
- 실 disconnect 경로 = **角3 (세션/토큰 만료 → data-plane read silent 401 → 배너없이 empty)**. 角1·2·4는 배분이력에 대해 원인 아님.
- 코드 gap 2건 (후속 fix leg 별도 티켓 · total revert 금지 · 국소 fix):
  1. load() read가 error 무시 → 401/RLS-deny를 "진짜 0건"과 구분 못함. → error 감지 시 기존 행 blank 금지 + 인증오류 배너/재로그인 유도.
  2. expired/anon 401은 refresh401 인프라의 non-target → 사용자에게 무증상. → 데이터 read 만료 401 시 auth refresh/re-login 유도 훅 연결.

## 현장 검증 (새로고침 말고 · responder relay용)
1. **완전 로그아웃 후 재로그인** (새로고침 X — 로그아웃 버튼으로 나갔다가 아이디/비번 다시 입력). 명단 뜨면 = 오후에 로그인(세션)이 풀린 게 원인 확정.
2. **다른 기기/다른 계정으로 같은 화면 열기.** 거기선 명단 보이면 = 총괄님 계정·기기만의 로그인 문제 확정. 거기서도 empty면 = 공통/데이터 문제로 재조사.
