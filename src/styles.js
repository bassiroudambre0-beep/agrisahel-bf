 // ════════════════════════════════════════════════════════
// AgriSahel BF — styles.js
// Optimisé Android mobile-first
// ════════════════════════════════════════════════════════

export const COLORS = {
  primary:  "#2D5A3D",
  primary2: "#3D7A55",
  primary3: "#6AAF7A",
  amber:    "#C8900A",
  amber2:   "#F0B429",
  cream:    "#FAF6F0",
  cream2:   "#EDE5D8",
  white:    "#FFFFFF",
  dark:     "#1A1A1A",
  gray:     "#6B7280",
  grayLight:"#F3F4F6",
  red:      "#DC2626",
  orange:   "#EA580C",
  green:    "#16A34A",
  blue:     "#2563EB",
  purple:   "#7C3AED",
};

export const G = {
  card: {
    background: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 1px 8px rgba(45,90,61,0.10)",
    border: "1px solid #EDE5D8",
    width: "100%",
    boxSizing: "border-box",
  },
  input: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 12,
    border: "1.5px solid #D1C4B0",
    fontSize: 16,
    outline: "none",
    background: "#FFFFFF",
    boxSizing: "border-box",
    color: "#1A1A1A",
    fontFamily: "inherit",
    WebkitAppearance: "none",
  },
  btn: {
    width: "100%",
    padding: "15px 12px",
    borderRadius: 14,
    border: "none",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    transition: "all 0.15s",
    boxSizing: "border-box",
    WebkitTapHighlightColor: "transparent",
    minHeight: 50,
  },
  btnPrimary: {
    background: "linear-gradient(135deg,#2D5A3D,#3D7A55)",
    color: "#FFFFFF",
  },
  btnSecondary: {
    background: "#F3F4F6",
    color: "#1A1A1A",
  },
  label: {
    fontSize: 13,
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 6,
    display: "block",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: "#2D5A3D",
    marginBottom: 12,
  },
  page: {
    padding: "14px 14px 100px",
    width: "100%",
    boxSizing: "border-box",
    overflowX: "hidden",
  },
};

export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Nunito:wght@400;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; min-width: 0; }
  html, body { overflow-x: hidden; width: 100%; height: 100%; }

  body {
    font-family: 'Nunito', sans-serif;
    background: #F5F0E8;
    color: #1A1A1A;
    -webkit-tap-highlight-color: transparent;
    -webkit-font-smoothing: antialiased;
  }

  /* Inputs Android natifs */
  input, select, textarea {
    color: #1A1A1A !important;
    width: 100% !important;
    box-sizing: border-box !important;
    font-family: 'Nunito', sans-serif !important;
    font-size: 16px !important;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 12px;
  }

  input::placeholder, textarea::placeholder {
    color: #9CA3AF !important;
    opacity: 1;
  }

  img { max-width: 100%; height: auto; display: block; }
  button { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }

  /* Focus visible */
  input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: #3D7A55 !important;
    box-shadow: 0 0 0 3px rgba(61,122,85,0.15) !important;
  }

  /* Animations */
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(30px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.5; }
  }

  .fade-in  { animation: fadeIn  0.25s ease; }
  .slide-up { animation: slideUp 0.35s ease; }
  .pulse    { animation: pulse  1.5s ease infinite; }
  .btn-hover:active { transform: scale(0.97); }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 3px; height: 3px; }
  ::-webkit-scrollbar-thumb { background: #C7D9CF; border-radius: 4px; }

  /* Overflow horizontal */
  .overflow-x {
    display: flex;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding-bottom: 4px;
  }
  .overflow-x::-webkit-scrollbar { display: none; }

  /* Safe area iOS */
  .bottom-nav {
    padding-bottom: env(safe-area-inset-bottom, 12px);
  }
`;