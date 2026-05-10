// ════════════════════════════════════════════════════════
// AgriSahel BF — styles.js
// Toutes les couleurs et styles centralisés ici
// Modifiez ce fichier pour changer le design de l'app
// ════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────
// 🎨 PALETTE DE COULEURS
// Changez ces valeurs pour modifier le thème
// ─────────────────────────────────────────────────
export const COLORS = {
  // Vert principal — couleur dominante de l'app
  primary:  "#4a6358",
  primary2: "#2D6A4F",
  primary3: "#52B778",

  // Ambre/Or — accents et highlights
  amber:  "#D4A017",
  amber2: "#F4CC55",

  // Fond crème — background général
  cream:  "#FDF6EC",
  cream2: "#F0EBE1",

  // Neutres
  white: "#FFFFFF",
  dark:  "#111827",
  gray:  "#6B7280",
  grayLight: "#F3F4F6",

  // États
  red:    "#EF4444",
  orange: "#F97316",
  green:  "#10B981",
  blue:   "#3B82F6",
  purple: "#8B5CF6",
};

// ─────────────────────────────────────────────────
// 📐 TYPOGRAPHIE
// ─────────────────────────────────────────────────
export const FONTS = {
  title: "'Fraunces', serif",       // Titres principaux
  body:  "'Nunito', sans-serif",    // Texte courant
  sizes: {
    xs:   10,
    sm:   12,
    base: 14,
    md:   15,
    lg:   17,
    xl:   20,
    xxl:  24,
    hero: 32,
  }
};

// ─────────────────────────────────────────────────
// 📦 COMPOSANTS — Styles réutilisables
// ─────────────────────────────────────────────────
export const G = {
  // Card — carte blanche avec ombre
  card: {
    background: COLORS.white,
    borderRadius: 20,
    padding: 16,
    boxShadow: "0 2px 12px rgba(27,67,50,0.08)",
    border: `1px solid ${COLORS.cream2}`,
    width: "100%",
    boxSizing: "border-box",
  },

  // Input — champ de saisie
  input: {
    width: "100%",
    padding: "13px 14px",
    borderRadius: 14,
    border: `2px solid ${COLORS.cream2}`,
    fontSize: 15,
    outline: "none",
    background: COLORS.white,
    boxSizing: "border-box",
    color: COLORS.dark,
  },

  // Bouton — style de base
  btn: {
    width: "100%",
    padding: 15,
    borderRadius: 16,
    border: "none",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    transition: "all 0.15s",
    boxSizing: "border-box",
  },

  // Bouton principal — vert
  btnPrimary: {
    background: `linear-gradient(135deg,${COLORS.primary},${COLORS.primary2})`,
    color: COLORS.white,
  },

  // Bouton secondaire — gris
  btnSecondary: {
    background: COLORS.grayLight,
    color: COLORS.dark,
  },

  // Label — étiquette de champ
  label: {
    fontSize: 13,
    fontWeight: 700,
    color: COLORS.gray,
    marginBottom: 6,
    display: "block",
  },

  // Titre de section
  sectionTitle: {
    fontSize: 17,
    fontWeight: 800,
    color: COLORS.primary,
    marginBottom: 12,
  },

  // Page — container de chaque onglet
  page: {
    padding: "12px 12px 100px",
    width: "100%",
    boxSizing: "border-box",
    overflowX: "hidden",
  },
};

// ─────────────────────────────────────────────────
// 🌍 CSS GLOBAL — Injecté dans le <style>
// ─────────────────────────────────────────────────
export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Nunito:wght@400;600;700;800&display=swap');

  /* Reset de base */
  * { box-sizing: border-box; margin: 0; padding: 0; min-width: 0; }
  html, body { overflow-x: hidden; width: 100%; }

  /* Corps principal */
  body {
    font-family: 'Nunito', sans-serif;
    background: #F8FAF8;
    color: #111827;
    -webkit-tap-highlight-color: transparent;
  }

  /* Inputs toujours visibles */
  input, select, textarea {
    color: #111827 !important;
    max-width: 100% !important;
    width: 100% !important;
    box-sizing: border-box !important;
    font-family: 'Nunito', sans-serif;
  }

  /* Images responsives */
  img { max-width: 100%; height: auto; }

  /* Boutons touch-friendly */
  button { touch-action: manipulation; }

  /* ─── ANIMATIONS ─── */
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(40px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.5; }
  }

  /* ─── CLASSES UTILITAIRES ─── */
  .fade-in  { animation: fadeIn  0.3s ease; }
  .slide-up { animation: slideUp 0.4s ease; }
  .pulse    { animation: pulse  1.5s ease infinite; }
  .btn-hover:active { transform: scale(0.97); opacity: 0.9; }

  /* ─── SCROLLBAR PERSONNALISÉE ─── */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb {
    background: #C7D9CF;
    border-radius: 4px;
  }

  /* ─── FOCUS ─── */
  input:focus, select:focus, textarea:focus {
    border-color: #2D6A4F !important;
    box-shadow: 0 0 0 3px rgba(45,106,79,0.15);
  }

  /* ─── MOBILE SPECIFIC ─── */
  @media (max-width: 480px) {
    body { font-size: 14px; }
    button { min-height: 44px; }
    input, select, textarea { font-size: 16px !important; } /* évite zoom iOS */
  }
`;