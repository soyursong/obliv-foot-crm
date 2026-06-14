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
        // ── T-20260614-foot-THEME-MONOCHROME-RECOLOR (StepD) ──────────────────
        // 브랜드 메인 teal-* (장식 1600+건)을 확정 warm-monochrome 램프로 단일 리맵.
        //   김주연 총괄 확정 5색 앵커: Vanilla #F8F4EE · Soft Dune #E4DDCC ·
        //   Classic Taupe #C5BEA3 · Umber #443A35 · Black #252525.
        // 클래스 sweep 없이 팔레트 오버라이드 한 곳에서 전 화면 적용(JIT 안전, 가역).
        // ⚠ emerald-*/green-* 은 의미색(재진·초진·완료·success·선체험)으로 유지 — 미리맵(AC4).
        teal: {
          50:  "#F8F4EE", // Vanilla — 연한 배경(former teal-50)
          100: "#F0EADE", // 연한 면/뱃지
          200: "#E4DDCC", // Soft Dune — 보더/구분선
          300: "#D6CDB8",
          400: "#C5BEA3", // Classic Taupe — 밝은 포인트
          500: "#9D917A",
          600: "#6E6353", // 주 포인트(활성·강조 텍스트) — AA on light
          700: "#554A3D", // 강조 텍스트/hover
          800: "#443A35", // Umber — 다크 액센트
          900: "#2E2823",
          950: "#252525", // Black
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
