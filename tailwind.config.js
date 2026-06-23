/** @type {import("tailwindcss").Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
    },
    extend: {
      colors: {
        // ── T-20260614-foot-THEME-MONOCHROME-RECOLOR (A안 → StepF 재오픈 정정) ──
        // 김주연 총괄 A/B → A안(의미색 carve-out 후 sweep) 확정. 장식 teal-*(1029건/99파일, 압도적 장식)
        // 을 단일 램프 리맵으로 sweep. JIT 안전·클래스 sweep 0·가역.
        // ⚠ 의미색 carve-out(절대 미치환, AC4): 칸반 11단계 배지의 teal 단계
        //   (status.ts treatment_waiting·preconditioning)는 src/lib/status.ts 에서 teal 기본 HEX
        //   (bg-[#ccfbf1]/text-[#115e59], bg-[#2dd4bf])로 pin → 이 램프 오버라이드에 비종속(레인보우 보존).
        //   재진(emerald)·선체험(green)·치료사 역할칩(green)·laser(emerald)는 teal 미사용 → 자동 보존.
        // 재오픈 정정(2026-06-15 김주연 총괄): light-end(50~300)는 배경/면/보더 등 일반영역에
        // 압도적으로 쓰여(bg-teal-50 304건·border-teal-200 81건 등) Vanilla·Soft Dune 베이지를
        // 전 화면에 깔았음 → "너무 베이지함". light-end를 중립 그레이(흰색 계열, hue 0)로 복원.
        // dark-end(400~950)는 text-teal-700/600·bg-teal-600 등 텍스트·버튼·강조 포인트에 쓰이므로
        // warm 브라운(Taupe→Umber→Black) 포인트 유지 — "버튼·활성탭 등 강조에만 베이지/브라운".
        teal: {
          50:  "#FAFAFA", // 일반영역 면(near-white 중립)
          100: "#F4F4F5", // 연한 면/뱃지(중립 라이트 그레이)
          200: "#E5E5E5", // 보더/구분선(중립 그레이)
          300: "#D4D4D4", // 보더/강한 구분선(중립 그레이)
          400: "#C5BEA3", // Classic Taupe — 밝은 강조 포인트(절제)
          500: "#9D917A",
          600: "#6E6353", // 주 포인트(활성·강조 텍스트) — AA on white
          700: "#554A3D", // 강조 텍스트/hover
          800: "#443A35", // Umber — 다크 액센트(버튼/활성탭)
          900: "#2E2823",
          950: "#252525", // Black
        },
        // ── T-20260623-foot-CHART2-MONOTONE-3MOCKUP Phase2 (김주연 총괄, 2026-06-23) ──
        // 파스텔 그린(GREEN-PASTEL-RETUNE)이 "쓸데없는 컬러" → 총괄 directive "1·2번 차트 전부 통일감 있게, 담백하게".
        // pick ② 쿨 뉴트럴 그레이로 통일. sage 토큰을 그린 램프 → 쿨 뉴트럴 그레이 램프로 교체(토큰명 유지·값만 그레이화).
        // 동일 토큰 1곳 교체 → 1번차트(고객정보·예약관리 등 sage 적용 전 지점) 일괄 그레이 전환. 2번차트(CustomerChartPage)는
        // teal-* → sage-*로 같은 토큰을 공유해 두 차트가 동일 톤이 됨(= 통일).
        // ② 앵커: sage-100=#E4E6E8(배지/칩 bg·sectionBar) / sage-700=#51585D(accent·본문 텍스트) / sage-900=#2E3133(headerBg).
        // WCAG AA(쿨 뉴트럴 그레이): text=sage-700(#51585D) on white 7.3:1 / on sage-100(#E4E6E8) 5.76:1 (본문 ≥4.5 ✓).
        //   text=sage-600(#5C6166) on white 6.3:1 ✓ / white on sage-600 button 6.3:1·sage-700 7.3:1 ✓.
        // ⚠ 불변 의미색(carve-out): 신분증 빨강·error / status.ts 칸반 11단계 의미색 / Badge variant 의미색(신환·kakao 등)
        //   / before-after emerald·success emerald 는 본 통일 범위 밖(미접촉). 통일 = 장식성 컬러 제거이지 의미색 제거 아님.
        sage: {
          50:  "#F4F5F6", // 연한 틴트 면(카드 bg) = ② labelBg
          100: "#E4E6E8", // 배지/칩 bg·sectionBar = ② 앵커 #E4E6E8
          200: "#D3D6D9", // 보더
          300: "#BCC0C4",
          400: "#9CA1A6", // 좌측 강조 보더/라이트 dot
          500: "#767C81", // dot
          600: "#5C6166", // = ② labelText (AA)
          700: "#51585D", // 본문/활성 텍스트·accent = ② accent (AA)
          800: "#4A5054", // 강조 텍스트 = ② badge text (AA)
          900: "#2E3133", // 다크 면 = ② headerBg
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--primary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      minHeight: {
        touch: "44px",
      },
      minWidth: {
        touch: "44px",
      },
      // T-20260609-foot-DOCCALL-DOCTOR-ACK AC8: 손 들기(✋) 대기 pulse.
      //   opacity 0.4→1→0.4, 주기 1.5s, ease-in-out, 무한. ack 후엔 미적용(파란색 고정).
      keyframes: {
        "pulse-hand": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        // T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT AC-4: 상태 셀 ✋ 손들기 초기(진료필요·미ack) SHAKE.
        //   좌우 흔들림(rotate ±). 1차 클릭(초록=ack) 후엔 미적용(정적). 주기 0.9s ease-in-out 무한.
        shake: {
          "0%, 100%": { transform: "rotate(0deg)" },
          "20%": { transform: "rotate(-14deg)" },
          "40%": { transform: "rotate(12deg)" },
          "60%": { transform: "rotate(-10deg)" },
          "80%": { transform: "rotate(8deg)" },
        },
      },
      animation: {
        "pulse-hand": "pulse-hand 1.5s ease-in-out infinite",
        shake: "shake 0.9s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
