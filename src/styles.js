 export const COLORS = {
  primary:  "#1B4332",
  primary2: "#2D6A4F",
  primary3: "#52B788",
  amber:    "#D4A017",
  amber2:   "#F4CC55",
  cream:    "#FDF6EC",
  cream2:   "#F0EBE1",
  white:    "#FFFFFF",
  dark:     "#111827",
  gray:     "#6B7280",
  grayLight:"#F3F4F6",
  red:      "#EF4444",
  orange:   "#F97316",
  green:    "#10B981",
  blue:     "#3B82F6",
  purple:   "#8B5CF6",
};

export const G = {
  card: {
    background: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 2px 8px rgba(27,67,50,0.08)",
    border: "1px solid #F0EBE1",
    width: "100%",
    boxSizing: "border-box",
  },
  input: {
    width: "100%",
    padding: "13px 14px",
    borderRadius: 12,
    border: "1.5px solid #D1C4B0",
    fontSize: 15,
    outline: "none",
    background: "#FFFFFF",
    boxSizing: "border-box",
    color: "#111827",
    fontFamily: "inherit",
    display: "block",
  },
  btn: {
    width: "100%",
    padding: 15,
    borderRadius: 14,
    border: "none",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    transition: "all 0.15s",
    boxSizing: "border-box",
    minHeight: 48,
    display: "block",
  },
  btnPrimary: {
    background: "linear-gradient(135deg,#1B4332,#2D6A4F)",
    color: "#FFFFFF",
  },
  btnSecondary: {
    background: "#F3F4F6",
    color: "#111827",
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
    color: "#1B4332",
    marginBottom: 12,
  },
   page: {
  padding: "12px 12px 20px",
  width: "100%",
  maxWidth: "480px",
  boxSizing: "border-box",
  overflowX: "hidden",
  minHeight: "calc(100vh - 80px)",
},
};

export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Nunito:wght@400;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { width: 100%; overflow-x: hidden; }
  body {
    font-family: 'Nunito', sans-serif;
    background: #FDF6EC;
    color: #111827;
    width: 100%;
    overflow-x: hidden;
    -webkit-tap-highlight-color: transparent;
  }
  input, select, textarea {
    color: #111827 !important;
    width: 100% !important;
    box-sizing: border-box !important;
    font-family: 'Nunito', sans-serif !important;
    -webkit-appearance: none;
  }
  input::placeholder, textarea::placeholder { color: #9CA3AF !important; }
  img { max-width: 100%; }
  button { touch-action: manipulation; }
  input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: #2D6A4F !important;
    box-shadow: 0 0 0 3px rgba(45,106,79,0.12) !important;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  @keyframes slideUp { from { opacity:0; transform:translateY(30px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
  .fade-in { animation: fadeIn 0.25s ease; }
  .slide-up { animation: slideUp 0.35s ease; }
  .pulse { animation: pulse 1.5s ease infinite; }
  .btn-hover:active { transform: scale(0.97); }
  /* MOBILE OPTIMISATION ANDROID */
  body, html { margin: 0; padding: 0; overflow-x: hidden; }
  .content-wrapper { padding-bottom: 100px; }
  input, select, textarea { font-size: 16px !important; }
  ::-webkit-scrollbar { display: none; }
`;