 import { useState, useEffect, useRef, useCallback } from "react";
import { COLORS, G, GLOBAL_CSS } from "./styles";
import {
  inscrireUtilisateur, connecterUtilisateur, verifierTelephone,
  getJournal as getJournalDB, ajouterEntreeJournal, supprimerEntreeJournal,
  getAnnonces, publierAnnonce, supprimerAnnonce,
  getPosts, publierPost,
  getGroupements, creerGroupement, rejoindreGroupement,
  estEnLigne, sauvegarderOffline, initialiserSyncAuto,
} from "./supabaseService";

// ════════════════════════════════════════════════════════
// CONSTANTS & CONFIG
// ════════════════════════════════════════════════════════
const APP_VERSION = "1.0";
const VILLES_BF = ["Ouagadougou","Bobo-Dioulasso","Koudougou","Banfora","Ouahigouya","Kaya","Dori","Fada N'Gourma","Dédougou","Tenkodogo","Ziniaré","Léo","Gaoua","Kongoussi"];
const BRUTE_FORCE_MAX = 5;

// ── Sécurité upload images ──
const IMG_MAX_SIZE_MB = 5;
const IMG_MAX_SIZE_BYTES = IMG_MAX_SIZE_MB * 1024 * 1024;
const IMG_MAX_COUNT = 5;
const IMG_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMG_ALLOWED_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

// Vérification magic bytes (vrais octets du fichier)
const checkMagicBytes = (file) => new Promise(resolve => {
  const reader = new FileReader();
  reader.onload = e => {
    const arr = new Uint8Array(e.target.result);
    const isJPEG = arr[0]===0xFF && arr[1]===0xD8 && arr[2]===0xFF;
    const isPNG  = arr[0]===0x89 && arr[1]===0x50 && arr[2]===0x4E && arr[3]===0x47;
    const isWEBP = arr[0]===0x52 && arr[1]===0x49 && arr[2]===0x46 && arr[3]===0x46;
    resolve(isJPEG || isPNG || isWEBP);
  };
  reader.readAsArrayBuffer(file.slice(0, 4));
});

// Sanitiser nom de fichier (anti-XSS)
const sanitizeFilename = (name) => name.replace(/[^a-zA-Z0-9._\-]/g, "_").slice(0, 60);
const BRUTE_FORCE_LOCKOUT_MS = 15 * 60 * 1000; // 15 min
const WEATHER_CACHE_MS = 30 * 60 * 1000; // 30 min
const WEATHER_TIMEOUT_MS = 9000; // 9s

// ════════════════════════════════════════════════════════
// SAFE STORAGE — try/catch sur tout localStorage
// ════════════════════════════════════════════════════════
const storage = {
  get: (key, fallback = null) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove: (key) => { try { localStorage.removeItem(key); } catch {} },
};

// Clés privées (préfixées par userId)
const priv = (userId, key) => `u_${userId}_${key}`;
// Clés partagées
const KEYS = {
  USERS: "agrisahel_users",
  LISTINGS: "agrisahel_listings",
  POSTS: "agrisahel_posts",
  GROUPS: "agrisahel_groups",
  ATTEMPTS: (tel) => `agrisahel_attempts_${tel}`,
};

// ════════════════════════════════════════════════════════
// AUTH UTILITIES
// ════════════════════════════════════════════════════════
const normalizePhone = (raw) => {
  let s = String(raw).replace(/\s+/g, "").replace(/-/g, "");
  if (s.startsWith("+226")) s = s.slice(4);
  else if (s.startsWith("00226")) s = s.slice(5);
  else if (s.startsWith("226") && s.length === 11) s = s.slice(3);
  return s;
};

const validatePhone = (raw) => {
  const s = normalizePhone(raw);
  return /^\d{8}$/.test(s);
};

const getNetwork = (raw) => {
  const s = normalizePhone(raw);
  const p = parseInt(s[1] || "0");
  if (p >= 0 && p <= 3) return { name: "Moov (Telmob)", color: "#0066CC", emoji: "🔵" };
  if (p >= 4 && p <= 7) return { name: "Orange BF", color: "#FF6600", emoji: "🟠" };
  return { name: "Telecel", color: "#CC0000", emoji: "🔴" };
};

const hashPassword = async (pwd) => {
  const data = new TextEncoder().encode("agrisahel_bf_v4_" + pwd);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
};

const generateOTP = () => {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String((arr[0] % 900000) + 100000);
};

const sanitize = (str, max = 500) => {
  if (typeof str !== "string") return "";
  return str.slice(0, max)
    .replace(/[<>]/g, "")
    .replace(/(\bignore\b|\bforget\b|\bsystem\b|\bprompt\b)/gi, "***")
    .trim();
};

const getBruteForce = (tel) => storage.get(KEYS.ATTEMPTS(tel), { count: 0, lockedUntil: 0 });
const recordFailed = (tel) => {
  const d = getBruteForce(tel);
  const count = (d.count || 0) + 1;
  const lockedUntil = count >= BRUTE_FORCE_MAX ? Date.now() + BRUTE_FORCE_LOCKOUT_MS : (d.lockedUntil || 0);
  storage.set(KEYS.ATTEMPTS(tel), { count, lockedUntil });
  return count;
};
const resetBruteForce = (tel) => storage.remove(KEYS.ATTEMPTS(tel));
const isLocked = (tel) => {
  const d = getBruteForce(tel);
  if (!d.lockedUntil || Date.now() >= d.lockedUntil) { if (d.lockedUntil) resetBruteForce(tel); return false; }
  return Math.ceil((d.lockedUntil - Date.now()) / 60000);
};

// WhatsApp link — méthode createElement pour Android
const openWhatsApp = (tel, msg = "") => {
  const clean = tel.replace(/\D/g, "");
  const num = clean.startsWith("226") ? clean : `226${clean}`;
  const a = document.createElement("a");
  a.href = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  a.target = "_blank"; a.rel = "noopener noreferrer";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

// 🎨 Styles importés depuis ./styles.js



// ════════════════════════════════════════════════════════
// TOAST SYSTEM
// ════════════════════════════════════════════════════════
let _toastFn = null;
const toast = {
  success: (msg) => _toastFn?.({ msg, type: "success" }),
  error: (msg) => _toastFn?.({ msg, type: "error" }),
  info: (msg) => _toastFn?.({ msg, type: "info" }),
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _toastFn = ({ msg, type }) => {
      const id = crypto.randomUUID();
      setToasts(p => [...p, { id, msg, type }]);
      setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
    };
    return () => { _toastFn = null; };
  }, []);
  const colors = { success: COLORS.green, error: COLORS.red, info: COLORS.blue };
  const icons = { success: "✅", error: "❌", info: "ℹ️" };
  return (
    <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, width: "90%", maxWidth: "90%" }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: colors[t.type], color: "#fff", padding: "12px 16px", borderRadius: 14, fontWeight: 700, fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", display: "flex", gap: 8, alignItems: "center" }}>
          <span>{icons[t.type]}</span><span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
};

// ════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ════════════════════════════════════════════════════════
// ErrorBoundary correctement implémenté
// Note: utilisé via TabErrorBoundary (functional) ci-dessous

// ════════════════════════════════════════════════════════
// 📸 COMPOSANT IMAGE UPLOADER RÉUTILISABLE
// Sécurisé : magic bytes + taille + type + anti-XSS
// ════════════════════════════════════════════════════════
const ImageUploader = ({ images, setImages, max = 3, label = "Ajouter des photos (optionnel)" }) => {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const ref = useRef();
  const lastUpload = useRef(0);

  const handle = async (e) => {
    setError("");
    const files = Array.from(e.target.files);
    e.target.value = "";
    // Rate limit — 2 secondes entre uploads
    if (Date.now() - lastUpload.current < 2000) { setError("⏳ Attendez avant d'ajouter d'autres photos."); return; }
    lastUpload.current = Date.now();
    const slots = max - images.length;
    if (slots <= 0) { setError(`Maximum ${max} photos atteint.`); return; }
    setLoading(true);
    for (const file of files.slice(0, slots)) {
      if (!IMG_ALLOWED_TYPES.includes(file.type)) { setError(`❌ Format refusé. JPG, PNG, WEBP uniquement.`); continue; }
      const ext = "." + file.name.split(".").pop().toLowerCase();
      if (!IMG_ALLOWED_EXTS.includes(ext)) { setError(`❌ Extension refusée.`); continue; }
      if (file.size > IMG_MAX_SIZE_BYTES) { setError(`❌ Max ${IMG_MAX_SIZE_MB}MB par image. Celle-ci fait ${(file.size/1024/1024).toFixed(1)}MB.`); continue; }
      const valid = await checkMagicBytes(file);
      if (!valid) { setError("❌ Fichier invalide ou corrompu."); continue; }
      const safeName = sanitizeFilename(file.name);
      const reader = new FileReader();
      reader.onload = ev => setImages(p => [...p, { id: crypto.randomUUID(), url: ev.target.result, name: safeName }]);
      reader.readAsDataURL(file);
    }
    setLoading(false);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={G.label}>{label} ({images.length}/{max})</label>
      {error && <div style={{ background:"#FEE2E2", borderRadius:10, padding:"8px 12px", marginBottom:8, fontSize:12, color:COLORS.red, fontWeight:700 }}>{error}</div>}
      {images.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:10 }}>
          {images.map(img => (
            <div key={img.id} style={{ position:"relative", borderRadius:12, overflow:"hidden", aspectRatio:"1", border:`2px solid ${COLORS.cream2}` }}>
              <img src={img.url} alt={img.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
              <button onClick={() => setImages(p => p.filter(x => x.id !== img.id))}
                style={{ position:"absolute", top:4, right:4, width:22, height:22, borderRadius:"50%", background:"rgba(0,0,0,0.65)", color:"white", border:"none", cursor:"pointer", fontSize:12 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      {images.length < max && (
        <>
          <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp" multiple onChange={handle} style={{ display:"none" }} />
          <button type="button" onClick={() => ref.current?.click()}
            style={{ width:"100%", border:`2px dashed ${COLORS.primary2}`, borderRadius:14, padding:"14px 12px", background:COLORS.primary+"08", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:6, boxSizing:"border-box" }}>
            {loading
              ? <span className="pulse" style={{ fontSize:13, color:COLORS.primary2 }}>⏳ Vérification en cours...</span>
              : <>
                  <span style={{ fontSize:28 }}>📸</span>
                  <span style={{ fontSize:13, fontWeight:700, color:COLORS.primary2 }}>Ajouter des photos</span>
                  <span style={{ fontSize:11, color:COLORS.gray }}>JPG · PNG · WEBP · Max {IMG_MAX_SIZE_MB}MB · {max} photos max</span>
                </>
            }
          </button>
        </>
      )}
    </div>
  );
};

const TabErrorBoundary = ({ children, tabName }) => {
  const [error, setError] = useState(null);
  if (error) return (
    <div style={{ ...G.page, textAlign: "center", paddingTop: 60 }}>
      <div style={{ fontSize: 48 }}>⚠️</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.primary, margin: "16px 0 8px" }}>Erreur dans {tabName}</div>
      <div style={{ fontSize: 13, color: COLORS.gray, marginBottom: 20 }}>{error.message}</div>
      <button onClick={() => setError(null)} style={{ ...G.btn, ...G.btnPrimary, width: "auto", padding: "12px 24px" }}>🔄 Réessayer</button>
    </div>
  );
  try { return children; }
  catch (e) { setError(e); return null; }
};

// ════════════════════════════════════════════════════════
// UI COMPONENTS
// ════════════════════════════════════════════════════════
const Card = ({ children, style = {} }) => <div style={{ ...G.card, width: "100%", boxSizing: "border-box", ...style }}>{children}</div>;

const Badge = ({ children, color = COLORS.primary }) => (
  <span style={{ background: color + "20", color, fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20 }}>{children}</span>
);

const Spinner = ({ size = 24 }) => (
  <div style={{ width: size, height: size, border: `3px solid ${COLORS.cream2}`, borderTopColor: COLORS.primary2, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
);

const EmptyState = ({ emoji, title, subtitle }) => (
  <div style={{ textAlign: "center", padding: "40px 20px" }}>
    <div style={{ fontSize: 48, marginBottom: 12 }}>{emoji}</div>
    <div style={{ fontSize: 17, fontWeight: 800, color: COLORS.primary, marginBottom: 6 }}>{title}</div>
    <div style={{ fontSize: 14, color: COLORS.gray }}>{subtitle}</div>
  </div>
);

const Input = ({ label, ...props }) => (
  <div style={{ marginBottom: 16 }}>
    {label && <label style={G.label}>{label}</label>}
    <input style={G.input} {...props} />
  </div>
);

const Select = ({ label, options, ...props }) => (
  <div style={{ marginBottom: 16 }}>
    {label && <label style={G.label}>{label}</label>}
    <select style={{ ...G.input, appearance: "none" }} {...props}>
      {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
    </select>
  </div>
);

const Textarea = ({ label, ...props }) => (
  <div style={{ marginBottom: 16 }}>
    {label && <label style={G.label}>{label}</label>}
    <textarea style={{ ...G.input, minHeight: 90, resize: "vertical", fontFamily: "inherit" }} {...props} />
  </div>
);

// ════════════════════════════════════════════════════════
// GLOBAL CSS
// ════════════════════════════════════════════════════════
const GlobalStyle = () => <style>{GLOBAL_CSS}</style>;

// ════════════════════════════════════════════════════════
// AUTH PAGE
// ════════════════════════════════════════════════════════
const AuthPage = ({ onAuth }) => {
  const [mode, setMode] = useState("login");
  const [step, setStep] = useState("form"); // form | otp
  const [form, setForm] = useState({ nom: "", telephone: "", ville: "Ouagadougou", mdp: "", mdp2: "" });
  const [otp, setOtp] = useState({ generated: "", input: "", expiry: 0, attempts: 0 });
  const [honeypot, setHoneypot] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showMdp, setShowMdp] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState(null);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const tel = normalizePhone(form.telephone);
  const network = form.telephone.length >= 8 ? getNetwork(form.telephone) : null;

  const submit = async () => {
    if (honeypot) return;
    setErr(""); setLoading(true);
    try {
      if (!validatePhone(form.telephone)) { setErr("❌ Numéro invalide — 8 chiffres BF."); return; }
      if (!form.mdp || form.mdp.length < 6) { setErr("❌ Mot de passe minimum 6 caractères."); return; }

      const users = storage.get(KEYS.USERS, []);
      const lock = isLocked(tel);
      if (lock) { setErr(`🔒 Compte bloqué ${lock} min suite à trop de tentatives.`); return; }

      if (mode === "register") {
        if (!form.nom.trim() || form.nom.trim().length < 3) { setErr("❌ Nom complet obligatoire (min 3 caractères)."); return; }
        if (form.mdp !== form.mdp2) { setErr("❌ Les mots de passe ne correspondent pas."); return; }
        if (users.find(u => u.telephone === tel)) { setErr("❌ Ce numéro est déjà inscrit."); return; }
        const code = generateOTP();
        // Envoyer vrai SMS via Supabase Edge Function
        setLoading(true);
        try {
          const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
          const smsResp = await fetch("https://uaaswgpgtaijvkyyocok.supabase.co/functions/v1/send-otp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPA_KEY}`,
              "apikey": SUPA_KEY,
            },
            body: JSON.stringify({ telephone: tel, code })
          });
          const smsData = await smsResp.json();
          console.log("SMS envoyé:", smsData);
          if (smsData.success) {
            toast.success("✅ SMS envoyé sur " + tel + " !");
          } else {
            // Fallback mode démo si SMS échoue
            toast.info("⚠️ SMS indisponible — code affiché en mode démo");
          }
        } catch (e) {
          console.warn("SMS error:", e);
          toast.info("⚠️ SMS indisponible — code affiché en mode démo");
        }
        setOtp({ generated: code, input: "", expiry: Date.now() + 5 * 60 * 1000, attempts: 0 });
        setStep("otp");
      } else {
        const user = users.find(u => u.telephone === tel);
        if (!user) { setErr("❌ Numéro non inscrit. Créez un compte."); return; }
        const hash = await hashPassword(form.mdp);
        if (user.mdpHash !== hash) {
          const attempts = recordFailed(tel);
          const rest = BRUTE_FORCE_MAX - attempts;
          if (rest <= 0) { setErr("🔒 Compte bloqué 15 minutes."); return; }
          setErr(`❌ Mot de passe incorrect. ${rest} tentative(s) restante(s).`);
          return;
        }
        resetBruteForce(tel);
        onAuth(user);
      }
    } finally { setLoading(false); }
  };

  const verifyOTP = async () => {
    setErr(""); setLoading(true);
    try {
      if (Date.now() > otp.expiry) { setStep("form"); setErr("⏰ Code expiré. Recommencez."); return; }
      const clean = otp.input.replace(/\D/g, "");
      if (clean !== otp.generated) {
        const att = otp.attempts + 1;
        if (att >= 3) { setStep("form"); setErr("🚫 Trop de tentatives. Recommencez l'inscription."); return; }
        setOtp(p => ({ ...p, attempts: att, input: "" }));
        setErr(`❌ Code incorrect. ${3 - att} essai(s) restant(s).`);
        return;
      }
      const hash = await hashPassword(form.mdp);
      const newUser = {
        id: crypto.randomUUID(), nom: form.nom.trim(), telephone: tel,
        ville: form.ville, mdpHash: hash, verifie: true,
        photoUrl: profilePhoto || null,
        dateInscription: new Date().toLocaleDateString("fr-FR"),
        reputation: { score: 0, nbAvis: 0 },
      };
      // Sauvegarder dans Supabase si en ligne
      if (estEnLigne()) {
        try {
          const { data, error } = await inscrireUtilisateur({
            telephone: tel, nom: form.nom.trim(), ville: form.ville,
            activites: [], mdpHash: hash, photoUrl: profilePhoto || null,
          });
          if (error) { setErr(`❌ ${error}`); return; }
          if (data) newUser.id = data.id;
        } catch (e) { console.warn("Inscription Supabase:", e); }
      }
      // Toujours sauvegarder en cache local
      const users = storage.get(KEYS.USERS, []);
      storage.set(KEYS.USERS, [...users, newUser]);
      onAuth(newUser);
    } finally { setLoading(false); }
  };

  if (step === "otp") return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(160deg,${COLORS.primary} 0%,${COLORS.primary2} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: COLORS.cream, borderRadius: 28, padding: 24, width: "100%", maxWidth: "480px" }} className="slide-up">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 48 }}>📱</div>
          <h2 style={{ fontFamily: "Fraunces,serif", fontSize: 24, color: COLORS.primary, margin: "0 auto" }}>Code de vérification</h2>
          <p style={{ fontSize: 14, color: COLORS.gray }}>Code envoyé (mode démo — affiché ici)</p>
          <div style={{ background: COLORS.primary+"15", borderRadius: 12, padding: "12px 16px", marginTop: 12, fontSize: 14, fontWeight: 700, color: COLORS.primary, textAlign:"center" }}>
            📱 Code envoyé par SMS sur votre numéro<br/>
            <span style={{ fontSize:12, color:COLORS.gray, fontWeight:400 }}>Vérifiez vos messages</span>
          </div>
          {/* Mode démo — afficher le code si SMS échoue */}
          {otp.generated && (
            <details style={{ marginTop:8, textAlign:"center" }}>
              <summary style={{ fontSize:11, color:COLORS.gray, cursor:"pointer" }}>Mode démo — voir le code</summary>
              <div style={{ background: COLORS.grayLight, borderRadius: 10, padding: "8px 12px", marginTop:6, fontSize: 24, fontWeight: 900, letterSpacing: 8, color: COLORS.primary }}>{otp.generated}</div>
            </details>
          )}
          <p style={{ fontSize: 12, color: COLORS.gray, marginTop: 8, textAlign:"center" }}>Expire dans 5 minutes</p>
        </div>
        {err && <div style={{ background: "#FEE2E2", borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: COLORS.red, fontWeight: 700 }}>{err}</div>}
        <Input label="Entrez le code à 6 chiffres" value={otp.input} onChange={e => setOtp(p => ({ ...p, input: e.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="000000" type="text" inputMode="numeric" autoComplete="one-time-code" style={{ ...G.input, textAlign: "center", fontSize: 28, letterSpacing: 8, fontWeight: 900 }} />
        <button onClick={verifyOTP} disabled={loading || otp.input.length < 6} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary, opacity: loading || otp.input.length < 6 ? 0.6 : 1 }}>{loading ? "Vérification..." : "✅ Confirmer"}</button>
        <button onClick={() => setStep("form")} style={{ ...G.btn, ...G.btnSecondary, marginTop: 10 }}>← Retour</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(160deg,${COLORS.primary} 0%,${COLORS.primary2} 60%,${COLORS.amber} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: "480" }} className="slide-up">
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 56 }}>🌾</div>
          <h1 style={{ fontFamily: "Fraunces,serif", fontSize: 32, color: COLORS.white, margin: "0 auto" }}>AgriSahel BF</h1>
          <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 14 }}>Agriculture intelligente pour le Burkina Faso</p>
        </div>
        <div style={{ background: COLORS.cream, borderRadius: 28, padding: "28px 24px" }}>
          <div style={{ display: "flex", background: COLORS.grayLight, borderRadius: 14, padding: 4, marginBottom: 24 }}>
            {[["login","Se connecter"],["register","S'inscrire"]].map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setErr(""); }} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", fontWeight: 800, fontSize: 14, cursor: "pointer", background: mode === m ? COLORS.white : "transparent", color: mode === m ? COLORS.primary : COLORS.gray, boxShadow: mode === m ? "0 2px 8px rgba(0,0,0,0.1)" : "none", transition: "all 0.2s" }}>{l}</button>
            ))}
          </div>
          {err && <div style={{ background: "#FEE2E2", borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: COLORS.red, fontWeight: 700 }}>{err}</div>}
          {mode === "register" && <Input label="Nom complet" value={form.nom} onChange={e => set("nom", e.target.value)} placeholder="Ex: Kaboré Issouf" maxLength={80} />}
          <div style={{ marginBottom: 16 }}>
            <label style={G.label}>Numéro de téléphone {network && <span style={{ color: network.color }}>{network.emoji} {network.name}</span>}</label>
            <input style={G.input} value={form.telephone} onChange={e => set("telephone", e.target.value)} placeholder="70 12 34 56" type="tel" maxLength={15} />
          </div>
          {mode === "register" && (
            <Select label="Ville" value={form.ville} onChange={e => set("ville", e.target.value)} options={VILLES_BF} />
          )}
          <div style={{ marginBottom: 16, position: "relative" }}>
            <label style={G.label}>Mot de passe</label>
            <input style={G.input} value={form.mdp} onChange={e => set("mdp", e.target.value)} type={showMdp ? "text" : "password"} placeholder="Minimum 6 caractères" />
            <button onClick={() => setShowMdp(p => !p)} style={{ position: "relative", right: 14, top: 36, background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>{showMdp ? "🙈" : "👁️"}</button>
          </div>
          {mode === "register" && <Input label="Confirmer le mot de passe" value={form.mdp2} onChange={e => set("mdp2", e.target.value)} type="password" placeholder="Répétez le mot de passe" />}
          {mode === "register" && (
            <div style={{ marginBottom: 16 }}>
              <label style={G.label}>📸 Photo de profil (optionnel)</label>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:60, height:60, borderRadius:"50%", overflow:"hidden", border:`3px solid ${COLORS.cream2}`, background:COLORS.grayLight, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  {profilePhoto ? <img src={profilePhoto} alt="profil" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <span style={{ fontSize:24 }}>👤</span>}
                </div>
                <label style={{ flex:1, padding:"10px 14px", borderRadius:12, border:`2px dashed ${COLORS.cream2}`, background:COLORS.grayLight, cursor:"pointer", fontSize:13, fontWeight:700, color:COLORS.primary2, textAlign:"center" }}>
                  {profilePhoto ? "Changer la photo" : "Choisir une photo"}
                  <input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={async e => {
                    const file = e.target.files[0]; if (!file) return;
                    if (file.size > IMG_MAX_SIZE_BYTES) { toast.error(`Photo trop lourde. Max ${IMG_MAX_SIZE_MB}MB`); return; }
                    if (!IMG_ALLOWED_TYPES.includes(file.type)) { toast.error("Format non supporté. JPG, PNG, WEBP."); return; }
                    const valid = await checkMagicBytes(file);
                    if (!valid) { toast.error("Fichier invalide."); return; }
                    const reader = new FileReader();
                    reader.onload = ev => setProfilePhoto(ev.target.result);
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }} style={{ display:"none" }} />
                </label>
                {profilePhoto && <button onClick={() => setProfilePhoto(null)} style={{ background:"#FEE2E2", border:"none", borderRadius:10, padding:"8px 10px", cursor:"pointer", fontSize:14, color:COLORS.red }}>✕</button>}
              </div>
            </div>
          )}
          {/* Honeypot anti-bot */}
          <input value={honeypot} onChange={e => setHoneypot(e.target.value)} tabIndex={-1} style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} aria-hidden="true" />
          <button onClick={submit} disabled={loading} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary, marginTop: 8, opacity: loading ? 0.7 : 1 }}>
            {loading ? "⏳ Chargement..." : mode === "register" ? "📱 Créer mon compte" : "🔐 Se connecter"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TOP BAR
// ════════════════════════════════════════════════════════
const TopBar = ({ title, user, onLogout }) => {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 50, background: COLORS.white, borderBottom: `1px solid ${COLORS.cream2}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "Fraunces,serif", fontWeight: 700, fontSize: 17, color: COLORS.primary }}>{title}</div>
        <div style={{ fontSize: 11, color: online ? COLORS.green : COLORS.orange, fontWeight: 700 }}>{online ? "🟢 En ligne" : "📵 Hors ligne"}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:32, height:32, borderRadius:"50%", overflow:"hidden", background:COLORS.primary+"20", border:`2px solid ${COLORS.primary}30`, display:"flex", alignItems:"center", justifyContent:"center" }}>
            {user?.photoUrl ? <img src={user.photoUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <span style={{ fontSize:14, fontWeight:900, color:COLORS.primary }}>{user?.nom?.[0]?.toUpperCase()}</span>}
          </div>
          <div style={{ fontSize: 12, color: COLORS.gray, fontWeight: 600 }}>{user?.nom?.split(" ")[0]}</div>
        </div>
        <button onClick={onLogout} style={{ background: COLORS.grayLight, border: "none", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 16 }}>🚪</button>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════
// BOTTOM NAV — 11 onglets
// ════════════════════════════════════════════════════════
const TABS = [
  { id: "dashboard", label: "Accueil", icon: "🏠" },
  { id: "journal", label: "Journal", icon: "📔" },
  { id: "marche", label: "Marché", icon: "🛒" },
  { id: "communaute", label: "Communauté", icon: "👥" },
  { id: "groupes", label: "Groupes", icon: "🤝" },
  { id: "ia", label: "IA", icon: "🤖" },
  { id: "veterinaire", label: "Véto", icon: "🐄" },
  { id: "calculateur", label: "Calcul", icon: "💡" },
  { id: "microfinance", label: "Finance", icon: "🏦" },
  { id: "aide", label: "Aide", icon: "❓" },
  { id: "parametres", label: "Réglages", icon: "⚙️" },
];

const BottomNav = ({ active, onChange }) => {
  return (
    <nav style={{
      position: "fixed",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: "100%",
      maxWidth: "480px",
      background: COLORS.white,
      borderTop: `2px solid ${COLORS.cream2}`,
      zIndex: 1000,
      paddingBottom: "max(16px, env(safe-area-inset-bottom))", // Important pour Android + iOS
      boxShadow: "0 -3px 15px rgba(0,0,0,0.12)",
      paddingTop: "8px"
    }}>
      <div style={{ 
        display: "flex", 
        justifyContent: "space-around", 
        alignItems: "center",
        padding: "4px 0"
      }}>
        {TABS.slice(0, 5).map(t => (   // Tes 5 onglets principaux
          <button 
            key={t.id} 
            onClick={() => onChange(t.id)}
            style={{
              background: "none",
              border: "none",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "3px",
              color: active === t.id ? COLORS.primary : COLORS.gray,
              fontSize: "11px",
              fontWeight: active === t.id ? "800" : "600",
              padding: "6px 4px",
              borderRadius: "10px"
            }}
          >
            <span style={{ fontSize: active === t.id ? "26px" : "22px" }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};

// ═════════════════════════════════════════════════════
// TAB 1 — DASHBOARD
// ════════════════════════════════════════════════════════
function getSeason() {
  const m = new Date().getMonth() + 1;
  if (m >= 5 && m <= 9) return { name: "Hivernage", emoji: "🌧️", color: COLORS.blue, tips: ["Semis de sorgho et mil possible", "Surveillez les ravageurs après les premières pluies", "Préparez vos engrais et pesticides"] };
  if (m >= 10 && m <= 11) return { name: "Post-récolte", emoji: "🌾", color: COLORS.amber, tips: ["Période de récolte principale", "Stockez correctement pour éviter les pertes", "Bonne période pour vendre"] };
  if (m >= 12 || m <= 2) return { name: "Saison froide", emoji: "❄️", color: COLORS.blue, tips: ["Maraîchage favorable", "Préparez les champs pour la prochaine saison", "Arrosage réduit nécessaire"] };
  return { name: "Saison sèche", emoji: "☀️", color: COLORS.orange, tips: ["Période difficile — économisez l'eau", "Concentrez-vous sur la vente des stocks", "Planifiez la prochaine saison"] };
}

const WeatherWidget = ({ ville }) => {
  const [w, setW] = useState(null);
  const [loading, setLoading] = useState(true);
  const KEY = import.meta.env.VITE_OPENWEATHER_KEY;
  const validKey = KEY && KEY.length > 20 && KEY !== "undefined";

  useEffect(() => {
    const cacheKey = `agrisahel_weather_${ville}`;
    const cached = storage.get(cacheKey);
    if (cached && Date.now() - cached.ts < WEATHER_CACHE_MS) { setW(cached); setLoading(false); return; }
    if (!validKey || !navigator.onLine) {
      const mock = { temp: 34, desc: "Ensoleillé", icon: "☀️", humidity: 18, wind: 12, ts: Date.now() };
      setW(mock); setLoading(false); return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
    fetch(`https://api.openweathermap.org/data/2.5/weather?q=${ville},BF&appid=${KEY}&units=metric&lang=fr`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => {
        const icons = { "01d":"☀️","01n":"🌙","02d":"⛅","03d":"☁️","04d":"☁️","09d":"🌧️","10d":"🌦️","11d":"🌩️","50d":"🌫️" };
        const w2 = { temp: Math.round(d.main.temp), desc: d.weather[0].description, icon: icons[d.weather[0].icon] || "☀️", humidity: d.main.humidity, wind: Math.round(d.wind.speed * 3.6), ts: Date.now() };
        storage.set(cacheKey, w2); setW(w2);
      })
      .catch(() => setW({ temp: 34, desc: "Données indisponibles", icon: "☀️", humidity: 18, wind: 12, ts: Date.now() }))
      .finally(() => { clearTimeout(timeout); setLoading(false); });
    return () => controller.abort();
  }, [ville]);

  if (loading) return <div style={{ ...G.card, padding: 20, textAlign: "center" }}><Spinner /></div>;
  return (
    <Card style={{ background: `linear-gradient(135deg,${COLORS.primary},${COLORS.primary2})`, color: COLORS.white }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 48, fontWeight: 900, fontFamily: "Fraunces,serif", lineHeight: 1 }}>{w?.temp}°C</div>
          <div style={{ fontSize: 14, opacity: 0.85, textTransform: "capitalize", marginTop: 4 }}>{w?.desc}</div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>📍 {ville}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 56 }}>{w?.icon}</div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>💧{w?.humidity}% 💨{w?.wind}km/h</div>
        </div>
      </div>
      {false && <div style={{ display: "none" }}></div>}
    </Card>
  );
};

const DashboardPage = ({ user, journal, onTabChange }) => {
  const season = getSeason();
  const totalGains = journal.filter(e => e.impact === "gain").reduce((s, e) => s + (e.montant || 0), 0);
  const totalDep = journal.filter(e => e.impact === "depense").reduce((s, e) => s + (e.montant || 0), 0);
  const profit = totalGains - totalDep;
  return (
    <div style={G.page} className="fade-in">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, color: COLORS.gray }}>Bonjour 👋</div>
        <div style={{ fontFamily: "Fraunces,serif", fontSize: 24, fontWeight: 900, color: COLORS.primary }}>{user.nom}</div>
        <div style={{ fontSize: 13, color: COLORS.gray }}>📍 {user.ville}</div>
      </div>
      <WeatherWidget ville={user.ville} />
      <Card style={{ margin: "16px 0", background: season.color + "15", border: `2px solid ${season.color}30` }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 32 }}>{season.emoji}</span>
          <div><div style={{ fontWeight: 800, fontSize: 16, color: season.color }}>{season.name}</div><div style={{ fontSize: 12, color: COLORS.gray }}>Saison en cours</div></div>
        </div>
        {season.tips.map((t, i) => <div key={i} style={{ fontSize: 13, color: COLORS.dark, padding: "4px 0", borderTop: i > 0 ? `1px solid ${season.color}20` : "none" }}>• {t}</div>)}
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Gains", val: `${(totalGains/1000).toFixed(0)}k`, color: COLORS.green, icon: "📥" },
          { label: "Dépenses", val: `${(totalDep/1000).toFixed(0)}k`, color: COLORS.red, icon: "📤" },
          { label: "Profit", val: `${(profit/1000).toFixed(0)}k`, color: profit >= 0 ? COLORS.green : COLORS.red, icon: "💰" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center", padding: 12 }}>
            <div style={{ fontSize: 22 }}>{s.icon}</div>
            <div style={{ fontWeight: 900, fontSize: 16, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 10, color: COLORS.gray, fontWeight: 700 }}>{s.label} FCFA</div>
          </Card>
        ))}
      </div>
      <div style={{ ...G.sectionTitle }}>Accès rapide</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { id: "ia", label: "Diagnostic IA", icon: "🤖", color: COLORS.purple },
          { id: "marche", label: "Marché", icon: "🛒", color: COLORS.primary2 },
          { id: "journal", label: "Journal", icon: "📔", color: COLORS.amber },
          { id: "calculateur", label: "Calculateur", icon: "💡", color: COLORS.orange },
          { id: "veterinaire", label: "Vétérinaires", icon: "🐄", color: COLORS.green },
          { id: "microfinance", label: "Micro-Finance", icon: "🏦", color: COLORS.blue },
        ].map(item => (
          <button key={item.id} onClick={() => onTabChange(item.id)} className="btn-hover" style={{ ...G.card, border: `2px solid ${item.color}25`, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer", background: item.color + "08" }}>
            <span style={{ fontSize: 28 }}>{item.icon}</span>
            <span style={{ fontWeight: 800, fontSize: 14, color: item.color }}>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 2 — JOURNAL
// ════════════════════════════════════════════════════════
const ENTRY_TYPES = [
  { id: "activite", label: "Activité", icon: "🌾" },
  { id: "vente", label: "Vente/Récolte", icon: "🛍️" },
  { id: "elevage", label: "Élevage", icon: "🐄" },
  { id: "probleme", label: "Problème", icon: "🐛" },
  { id: "achat", label: "Achat", icon: "🛒" },
  { id: "note", label: "Note libre", icon: "📝" },
];

const JournalPage = ({ user, journal, setJournal }) => {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [filterImpact, setFilterImpact] = useState("all");
  const [form, setForm] = useState({ type: "activite", description: "", impact: "neutre", montant: "", date: new Date().toISOString().split("T")[0] });

  const save = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const totalGains = journal.filter(e => e.impact === "gain").reduce((s, e) => s + (Number(e.montant) || 0), 0);
  const totalDep = journal.filter(e => e.impact === "depense").reduce((s, e) => s + (Number(e.montant) || 0), 0);
  const profit = totalGains - totalDep;

  const formatMontant = (val) => {
    if (val >= 1000000) return `${(val/1000000).toFixed(1)}M`;
    if (val >= 1000) return `${(val/1000).toFixed(0)}k`;
    return `${val}`;
  };

  const ajouter = async () => {
    if (!form.description.trim()) { toast.error("Description obligatoire"); return; }
    const montant = form.impact !== "neutre" ? parseFloat(form.montant) || 0 : 0;
    const entry = { id: crypto.randomUUID(), ...form, montant, createdAt: Date.now() };
    // Optimistic update
    const newJ = [entry, ...journal];
    setJournal(newJ);
    storage.set(priv(user.id, "journal"), newJ);
    setShowForm(false);
    setForm({ type: "activite", description: "", impact: "neutre", montant: "", date: new Date().toISOString().split("T")[0] });
    toast.success("Entrée ajoutée !");
    // Sync Supabase
    if (estEnLigne() && user.id) {
      try {
        const { data, error } = await ajouterEntreeJournal({
          utilisateurId: user.id,
          type: form.impact === "gain" ? "revenu" : form.impact === "depense" ? "depense" : "activite",
          categorie: form.type,
          montant,
          description: form.description,
          date: form.date,
        });
        if (data) {
          const updated = newJ.map(e => e.id === entry.id ? { ...e, id: data.id } : e);
          setJournal(updated);
          storage.set(priv(user.id, "journal"), updated);
        }
        if (error) console.warn("Journal Supabase:", error);
      } catch (e) { sauvegarderOffline("INSERT", "journal", { type: form.type, montant, description: form.description, date: form.date }); }
    } else {
      sauvegarderOffline("INSERT", "journal", { type: form.type, montant, description: form.description, date: form.date });
    }
  };

  const supprimer = async (id) => {
    const newJ = journal.filter(e => e.id !== id);
    setJournal(newJ);
    storage.set(priv(user.id, "journal"), newJ);
    toast.info("Entrée supprimée");
    if (estEnLigne() && user.id) {
      try { await supprimerEntreeJournal(id, user.id); }
      catch (e) { console.warn("Suppr journal Supabase:", e); }
    }
  };

  const exporter = () => {
    const data = JSON.stringify({ journal, exportDate: new Date().toISOString(), user: user.nom }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `journal_agrisahel_${Date.now()}.json`;
    a.click();
    toast.success("Export téléchargé !");
  };

  const partager = async () => {
    const text = `Journal AgriSahel BF — ${user.nom}\nGains: ${totalGains.toLocaleString()} FCFA\nDépenses: ${totalDep.toLocaleString()} FCFA\nProfit net: ${profit.toLocaleString()} FCFA`;
    if (navigator.share) { await navigator.share({ title: "Mon Journal AgriSahel", text }); }
    else { await navigator.clipboard.writeText(text); toast.success("Copié !"); }
  };

  const filtered = journal.filter(e => (filter === "all" || e.type === filter) && (filterImpact === "all" || e.impact === filterImpact));
  const tType = ENTRY_TYPES.find(t => t.id === form.type);

  return (
    <div style={G.page} className="fade-in">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        {[
          { label: "Gains", val: totalGains, color: COLORS.green, icon: "📥" },
          { label: "Dépenses", val: totalDep, color: COLORS.red, icon: "📤" },
          { label: "Profit", val: profit, color: profit >= 0 ? COLORS.green : COLORS.red, icon: "💰" },
        ].map(s => (
          <Card key={s.label} style={{ padding: "10px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontWeight: 900, fontSize: 14, color: s.color, lineHeight: 1.2 }}>
              {formatMontant(Math.abs(s.val))}
              <span style={{ fontSize: 9, fontWeight: 700 }}> FCFA</span>
            </div>
            <div style={{ fontSize: 10, color: COLORS.gray, marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setShowForm(p => !p)} className="btn-hover"
          style={{ ...G.btn, ...G.btnPrimary, flex: 1, padding: "13px 10px", fontSize: 14 }}>
          {showForm ? "✕ Annuler" : "✏️ Nouvelle entrée"}
        </button>
        <button onClick={exporter} title="Exporter"
          style={{ background: COLORS.grayLight, border: "none", borderRadius: 14, padding: "13px 14px", cursor: "pointer", fontSize: 18, flexShrink: 0 }}>📥</button>
        <button onClick={partager} title="Partager"
          style={{ background: COLORS.grayLight, border: "none", borderRadius: 14, padding: "13px 14px", cursor: "pointer", fontSize: 18, flexShrink: 0 }}>📤</button>
      </div>
      {showForm && (
        <Card style={{ marginBottom: 16, border: `2px solid ${COLORS.primary}30` }}>
          <div style={{ ...G.sectionTitle, marginBottom: 16 }}>Nouvelle entrée</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 14 }}>
            {ENTRY_TYPES.map(t => (
              <button key={t.id} onClick={() => save("type", t.id)} style={{ padding: "10px 6px", borderRadius: 12, border: `2px solid ${form.type === t.id ? COLORS.primary : COLORS.cream2}`, background: form.type === t.id ? COLORS.primary + "12" : COLORS.white, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 20 }}>{t.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: form.type === t.id ? COLORS.primary : COLORS.gray }}>{t.label}</span>
              </button>
            ))}
          </div>
          <Textarea label={`Description (${tType?.icon} ${tType?.label})`} value={form.description} onChange={e => save("description", sanitize(e.target.value, 300))} placeholder="Décrivez votre activité..." maxLength={300} />
          <div style={{ marginBottom: 14 }}>
            <label style={G.label}>Impact financier</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[["gain","📥 Gain",COLORS.green],["depense","📤 Dépense",COLORS.red],["neutre","➖ Neutre",COLORS.gray]].map(([v,l,c]) => (
                <button key={v} onClick={() => save("impact", v)} style={{ flex: 1, padding: 10, borderRadius: 12, border: `2px solid ${form.impact === v ? c : COLORS.cream2}`, background: form.impact === v ? c + "15" : COLORS.white, cursor: "pointer", fontSize: 12, fontWeight: 800, color: form.impact === v ? c : COLORS.gray }}>{l}</button>
              ))}
            </div>
          </div>
          {form.impact !== "neutre" && <Input label="Montant (FCFA)" value={form.montant} onChange={e => save("montant", e.target.value.replace(/\D/g, ""))} type="text" inputMode="numeric" placeholder="Ex: 15000" />}
          <Input label="Date" value={form.date} onChange={e => save("date", e.target.value)} type="date" />
          <button onClick={ajouter} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary }}>✅ Enregistrer</button>
        </Card>
      )}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 12 }}>
        {[["all","Tous"],["gain","Gains"],["depense","Dépenses"],["neutre","Neutres"]].map(([v,l]) => (
          <button key={v} onClick={() => setFilterImpact(v)} style={{ padding: "6px 14px", borderRadius: 20, border: `2px solid ${filterImpact === v ? COLORS.primary : COLORS.cream2}`, background: filterImpact === v ? COLORS.primary : COLORS.white, color: filterImpact === v ? COLORS.white : COLORS.gray, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>
        ))}
      </div>
      {filtered.length === 0 ? <EmptyState emoji="📔" title="Journal vide" subtitle="Ajoutez votre première entrée" /> :
        filtered.map(e => {
          const et = ENTRY_TYPES.find(t => t.id === e.type);
          const impColor = e.impact === "gain" ? COLORS.green : e.impact === "depense" ? COLORS.red : COLORS.gray;
          return (
            <Card key={e.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 10, flex: 1 }}>
                  <span style={{ fontSize: 28 }}>{et?.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: COLORS.dark }}>{e.description}</div>
                    <div style={{ fontSize: 12, color: COLORS.gray, marginTop: 2 }}>{e.date} • {et?.label}</div>
                    {e.impact !== "neutre" && <div style={{ fontSize: 13, fontWeight: 800, color: impColor, marginTop: 4 }}>{e.impact === "gain" ? "+" : "-"}{(e.montant || 0).toLocaleString()} FCFA</div>}
                  </div>
                </div>
                <button onClick={() => supprimer(e.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: COLORS.gray, padding: 4 }}>🗑️</button>
              </div>
            </Card>
          );
        })
      }
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 3 — MARCHÉ
// ════════════════════════════════════════════════════════
const CATEGORIES_MARCHE = [
  { id: "agriculture", label: "Agriculture", icon: "🌾", subs: ["Céréales","Légumes","Fruits","Semences","Engrais","Pesticides"] },
  { id: "elevage", label: "Élevage", icon: "🐄", subs: ["Bovins","Ovins","Caprins","Volaille","Porcins","Pisciculture","Aliments bétail"] },
  { id: "services", label: "Services", icon: "🔧", subs: ["Location matériel","Transport","Labour","Irrigation","Formation","Autre"] },
  { id: "recherche", label: "Recherche", icon: "🛒", subs: ["Cherche terrain","Cherche semences","Cherche main-d'œuvre","Cherche financement"] },
];

const MarchePage = ({ user }) => {
  const [listings, setListings] = useState(() => storage.get(KEYS.LISTINGS, []));
  const [loadingListings, setLoadingListings] = useState(false);

  useEffect(() => {
    const charger = async () => {
      if (!estEnLigne()) return;
      setLoadingListings(true);
      try {
        const { data } = await getAnnonces();
        if (data && data.length > 0) {
          const norm = data.map(a => ({
            id: a.id, titre: a.produit, categorie: a.categorie || "agriculture",
            sous_categorie: a.categorie || "Céréales", description: a.description,
            prix: a.prix, ville: a.ville, telephone: a.utilisateurs?.telephone || "",
            auteur: a.utilisateurs?.nom || "Inconnu", auteurId: a.vendeur_id,
            images: a.images || [],
            date: new Date(a.date_creation).toLocaleDateString("fr-FR"),
          }));
          setListings(norm);
          storage.set(KEYS.LISTINGS, norm);
        }
      } catch (e) { console.warn("Marché Supabase:", e); }
      finally { setLoadingListings(false); }
    };
    charger();
  }, []);
  const [tab, setTab] = useState("voir");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [subFilter, setSubFilter] = useState("all");
  const [villeFilter, setVilleFilter] = useState("all");
  const [form, setForm] = useState({ titre: "", categorie: "agriculture", sous_categorie: "Céréales", description: "", prix: "", ville: user.ville, telephone: user.telephone });
  const [images, setImages] = useState([]);
  const [noteModal, setNoteModal] = useState(null);
  const [noteForm, setNoteForm] = useState({ note: 5, commentaire: "" });
  const [avisMap, setAvisMap] = useState({});
  const save = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const publier = async () => {
    if (!form.titre.trim() || !form.prix) { toast.error("Titre et prix obligatoires"); return; }
    const tempId = crypto.randomUUID();
    const listing = { id: tempId, ...form, prix: parseInt(form.prix), images, auteur: user.nom, auteurId: user.id, date: new Date().toLocaleDateString("fr-FR"), createdAt: Date.now() };
    const newL = [listing, ...listings];
    setListings(newL);
    storage.set(KEYS.LISTINGS, newL);
    setTab("voir");
    setForm(p => ({ ...p, titre: "", description: "", prix: "" }));
    setImages([]);
    toast.success("Annonce publiée !");
    // Sync Supabase
    if (estEnLigne() && user.id) {
      try {
        const { data, error } = await publierAnnonce({
          vendeurId: user.id, produit: form.titre, categorie: form.categorie,
          quantite: "", prix: parseInt(form.prix), description: form.description, ville: form.ville,
          images: images,
        });
        if (data) {
          const updated = newL.map(l => l.id === tempId ? { ...l, id: data.id } : l);
          setListings(updated); storage.set(KEYS.LISTINGS, updated);
        }
        if (error) console.warn("Annonce Supabase:", error);
      } catch (e) { sauvegarderOffline("INSERT", "annonces", form); }
    } else {
      sauvegarderOffline("INSERT", "annonces", form);
    }
  };

  const supprimer = async (id) => {
    const newL = listings.filter(l => l.id !== id);
    setListings(newL);
    storage.set(KEYS.LISTINGS, newL);
    toast.info("Annonce supprimée");
    if (estEnLigne() && user.id) {
      try { await supprimerAnnonce(id, user.id); }
      catch (e) { console.warn("Suppr annonce Supabase:", e); }
    }
  };

  const cat = CATEGORIES_MARCHE.find(c => c.id === catFilter);
  const filtered = listings.filter(l => {
    const q = search.toLowerCase();
    const matchSearch = !q || l.titre?.toLowerCase().includes(q) || l.description?.toLowerCase().includes(q) || l.sous_categorie?.toLowerCase().includes(q);
    const matchCat = catFilter === "all" || l.categorie === catFilter;
    const matchSub = subFilter === "all" || l.sous_categorie === subFilter;
    const matchVille = villeFilter === "all" || l.ville === villeFilter;
    return matchSearch && matchCat && matchSub && matchVille;
  });

  return (
    <div style={G.page} className="fade-in">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["voir","Annonces"],["publier","Publier"]].map(([v,l]) => (
          <button key={v} onClick={() => setTab(v)} style={{ flex: 1, padding: "11px 0", borderRadius: 14, border: `2px solid ${tab === v ? COLORS.primary : COLORS.cream2}`, background: tab === v ? COLORS.primary : COLORS.white, color: tab === v ? COLORS.white : COLORS.gray, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>{l}</button>
        ))}
      </div>
      {tab === "voir" ? (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher..." style={{ ...G.input, marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 8 }}>
            <button onClick={() => { setCatFilter("all"); setSubFilter("all"); }} style={{ padding: "6px 14px", borderRadius: 20, border: `2px solid ${catFilter === "all" ? COLORS.primary : COLORS.cream2}`, background: catFilter === "all" ? COLORS.primary : COLORS.white, color: catFilter === "all" ? COLORS.white : COLORS.gray, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Tous</button>
            {CATEGORIES_MARCHE.map(c => (
              <button key={c.id} onClick={() => { setCatFilter(c.id); setSubFilter("all"); }} style={{ padding: "6px 14px", borderRadius: 20, border: `2px solid ${catFilter === c.id ? COLORS.primary : COLORS.cream2}`, background: catFilter === c.id ? COLORS.primary : COLORS.white, color: catFilter === c.id ? COLORS.white : COLORS.gray, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{c.icon} {c.label}</button>
            ))}
          </div>
          {cat && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 8 }}>
              <button onClick={() => setSubFilter("all")} style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${subFilter === "all" ? COLORS.primary2 : COLORS.cream2}`, background: subFilter === "all" ? COLORS.primary2 + "20" : COLORS.white, color: subFilter === "all" ? COLORS.primary2 : COLORS.gray, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Tous</button>
              {cat.subs.map(s => <button key={s} onClick={() => setSubFilter(s)} style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${subFilter === s ? COLORS.primary2 : COLORS.cream2}`, background: subFilter === s ? COLORS.primary2 + "20" : COLORS.white, color: subFilter === s ? COLORS.primary2 : COLORS.gray, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{s}</button>)}
            </div>
          )}
          <Select options={["all", ...VILLES_BF.map(v => ({ value: v, label: v }))]} value={villeFilter} onChange={e => setVilleFilter(e.target.value)} />
          {filtered.length === 0 ? <EmptyState emoji="🛒" title="Aucune annonce" subtitle="Soyez le premier à publier !" /> :
            filtered.map(l => (
              <Card key={l.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.dark }}>{l.titre}</div>
                    <div style={{ fontSize: 12, color: COLORS.gray, marginTop: 2 }}>{l.auteur} • {l.ville} • {l.date}</div>
                    <Badge color={COLORS.primary2}>{l.sous_categorie}</Badge>
                  </div>
                  <div style={{ fontWeight: 900, fontSize: 16, color: COLORS.primary }}>{(l.prix || 0).toLocaleString()} FCFA</div>
                </div>
                {l.description && <div style={{ fontSize: 13, color: COLORS.gray, marginBottom: 10 }}>{l.description}</div>}
                {l.images && l.images.length > 0 && (
                  <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(l.images.length, 3)},1fr)`, gap:6, marginBottom:10 }}>
                    {l.images.slice(0,3).map((img,i) => (
                      <div key={img.id||i} style={{ borderRadius:10, overflow:"hidden", aspectRatio:"1" }}>
                        <img src={img.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                      </div>
                    ))}
                  </div>
                )}
                {/* Avis */}
                {avisMap[l.id] && avisMap[l.id].length > 0 && (
                  <div style={{ display:"flex", gap:4, alignItems:"center", marginBottom:8 }}>
                    {[1,2,3,4,5].map(s => <span key={s} style={{ fontSize:14, color: s <= Math.round(avisMap[l.id].reduce((a,v)=>a+v.note,0)/avisMap[l.id].length) ? "#F59E0B" : COLORS.cream2 }}>★</span>)}
                    <span style={{ fontSize:11, color:COLORS.gray, marginLeft:4 }}>({avisMap[l.id].length} avis)</span>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap:"wrap" }}>
                  <button onClick={() => openWhatsApp(l.telephone, `Bonjour, je suis intéressé par votre annonce "${l.titre}" sur AgriSahel BF`)} className="btn-hover" style={{ flex:1, minWidth:120, padding:"10px 0", borderRadius:12, border:"none", background:"#25D366", color:COLORS.white, fontWeight:800, fontSize:13, cursor:"pointer" }}>💬 WhatsApp</button>
                  {l.auteurId !== user.id && (
                    <button onClick={() => { setNoteModal(l); setNoteForm({ note:5, commentaire:"" }); }}
                      style={{ padding:"10px 12px", borderRadius:12, border:`2px solid ${COLORS.amber}`, background:COLORS.amber+"15", color:COLORS.amber, cursor:"pointer", fontSize:13, fontWeight:700 }}>⭐ Noter</button>
                  )}
                  {l.auteurId === user.id && <button onClick={() => supprimer(l.id)} style={{ padding:"10px 14px", borderRadius:12, border:"none", background:"#FEE2E2", color:COLORS.red, cursor:"pointer", fontSize:14 }}>🗑️</button>}
                </div>
              </Card>
            ))
          }
        </>
      ) : (
        <Card>
          <div style={G.sectionTitle}>Nouvelle annonce</div>
          <Input label="Titre de l'annonce" value={form.titre} onChange={e => save("titre", sanitize(e.target.value, 100))} placeholder="Ex: Sorgho blanc disponible 100 sacs" maxLength={100} />
          <Select label="Catégorie" value={form.categorie} onChange={e => { save("categorie", e.target.value); save("sous_categorie", CATEGORIES_MARCHE.find(c => c.id === e.target.value)?.subs[0] || ""); }} options={CATEGORIES_MARCHE.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }))} />
          <Select label="Sous-catégorie" value={form.sous_categorie} onChange={e => save("sous_categorie", e.target.value)} options={CATEGORIES_MARCHE.find(c => c.id === form.categorie)?.subs || []} />
          <Input label="Prix (FCFA)" value={form.prix} onChange={e => save("prix", e.target.value.replace(/\D/g, ""))} type="text" inputMode="numeric" placeholder="Ex: 15000" />
          <Select label="Ville" value={form.ville} onChange={e => save("ville", e.target.value)} options={VILLES_BF} />
          <Input label="Votre numéro WhatsApp" value={form.telephone} onChange={e => save("telephone", e.target.value)} type="tel" placeholder="70 12 34 56" />
          <Textarea label="Description (optionnel)" value={form.description} onChange={e => save("description", sanitize(e.target.value, 500))} placeholder="Détails sur votre annonce..." maxLength={500} />
          <ImageUploader images={images} setImages={setImages} max={IMG_MAX_COUNT} label="📸 Photos du produit (optionnel)" />
          <button onClick={publier} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary }}>📢 Publier l'annonce</button>
        </Card>
      )}
      {/* Modal notation vendeur */}
      {noteModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div style={{ background:COLORS.white, borderRadius:"24px 24px 0 0", padding:24, width:"100%", maxWidth:480 }} className="slide-up">
            <div style={{ fontWeight:800, fontSize:17, color:COLORS.primary, marginBottom:4 }}>⭐ Noter ce vendeur</div>
            <div style={{ fontSize:13, color:COLORS.gray, marginBottom:16 }}>{noteModal.auteur} — {noteModal.titre}</div>
            {/* Étoiles */}
            <div style={{ display:"flex", gap:8, marginBottom:16, justifyContent:"center" }}>
              {[1,2,3,4,5].map(s => (
                <button key={s} onClick={() => setNoteForm(p => ({ ...p, note:s }))}
                  style={{ fontSize:36, background:"none", border:"none", cursor:"pointer", color: s <= noteForm.note ? "#F59E0B" : COLORS.cream2, transition:"all 0.15s" }}>★</button>
              ))}
            </div>
            <div style={{ textAlign:"center", fontSize:14, fontWeight:800, color:COLORS.amber, marginBottom:14 }}>
              {["","Très mauvais","Mauvais","Correct","Bien","Excellent !"][noteForm.note]}
            </div>
            <Textarea label="Commentaire (optionnel)" value={noteForm.commentaire} onChange={e => setNoteForm(p => ({ ...p, commentaire:e.target.value }))} placeholder="Décrivez votre expérience avec ce vendeur..." maxLength={300} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setNoteModal(null)} style={{ ...G.btn, ...G.btnSecondary, flex:1 }}>Annuler</button>
              <button onClick={async () => {
                const newAvis = { id: crypto.randomUUID(), auteur: user.nom, auteurId: user.id, note: noteForm.note, commentaire: noteForm.commentaire, date: new Date().toLocaleDateString("fr-FR") };
                const current = avisMap[noteModal.id] || [];
                if (current.find(a => a.auteurId === user.id)) { toast.error("Vous avez déjà noté ce vendeur"); setNoteModal(null); return; }
                setAvisMap(p => ({ ...p, [noteModal.id]: [...current, newAvis] }));
                setNoteModal(null);
                toast.success("Avis publié ! ⭐");
              }} className="btn-hover" style={{ ...G.btn, background:COLORS.amber, color:COLORS.white, flex:1 }}>
                ✅ Publier l'avis
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 4 — COMMUNAUTÉ
// ════════════════════════════════════════════════════════
const POST_TYPES = [
  { id: "alerte_ravageur", label: "Alerte ravageur", icon: "🚨", color: COLORS.red },
  { id: "alerte_sanitaire", label: "Alerte sanitaire", icon: "🏥", color: COLORS.orange },
  { id: "astuce", label: "Astuce", icon: "💡", color: COLORS.amber },
  { id: "prix_marche", label: "Prix marché", icon: "📢", color: COLORS.blue },
  { id: "conseil_elevage", label: "Conseil élevage", icon: "🐄", color: COLORS.green },
  { id: "conseil_agricole", label: "Conseil agricole", icon: "🌱", color: COLORS.primary2 },
];

const CommunautePage = ({ user }) => {
  const [posts, setPosts] = useState(() => storage.get(KEYS.POSTS, []));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: "astuce", texte: "" });
  const [postImages, setPostImages] = useState([]);

  useEffect(() => {
    const charger = async () => {
      if (!estEnLigne()) return;
      try {
        const { data } = await getPosts();
        if (data && data.length > 0) {
          const norm = data.map(p => ({
            id: p.id, type: p.categorie || "astuce", texte: p.texte,
            images: p.images || [],
            auteur: p.utilisateurs?.nom || "Inconnu", auteurId: p.auteur_id,
            photoUrl: p.utilisateurs?.photo_url || null,
            date: new Date(p.date_creation).toLocaleDateString("fr-FR"),
          }));
          setPosts(norm); storage.set(KEYS.POSTS, norm);
        }
      } catch (e) { console.warn("Posts Supabase:", e); }
    };
    charger();
  }, []);

  const publier = async () => {
    if (!form.texte.trim()) { toast.error("Contenu obligatoire"); return; }
    const tempId = crypto.randomUUID();
    const post = { id: tempId, ...form, texte: sanitize(form.texte, 500), images: postImages, auteur: user.nom, auteurId: user.id, date: new Date().toLocaleDateString("fr-FR"), createdAt: Date.now() };
    const newP = [post, ...posts];
    setPosts(newP); storage.set(KEYS.POSTS, newP);
    setShowForm(false); setForm({ type: "astuce", texte: "" }); setPostImages([]);
    toast.success("Post publié !");
    if (estEnLigne() && user.id) {
      try {
        const { data, error } = await publierPost({ auteurId: user.id, categorie: form.type, texte: sanitize(form.texte, 500), ville: user.ville, images: postImages });
        if (data) { const up = newP.map(p => p.id === tempId ? { ...p, id: data.id } : p); setPosts(up); storage.set(KEYS.POSTS, up); }
        if (error) console.warn("Post Supabase:", error);
      } catch (e) { sauvegarderOffline("INSERT", "posts", { categorie: form.type, texte: form.texte, ville: user.ville }); }
    } else {
      sauvegarderOffline("INSERT", "posts", { categorie: form.type, texte: form.texte, ville: user.ville });
    }
  };

  const supprimer = (id) => {
    const newP = posts.filter(p => p.id !== id);
    setPosts(newP); storage.set(KEYS.POSTS, newP);
    toast.info("Post supprimé");
  };

  const partager = async (post) => {
    const text = `${POST_TYPES.find(t => t.id === post.type)?.icon} ${post.texte}\n— ${post.auteur} sur AgriSahel BF`;
    try { await navigator.clipboard.writeText(text); toast.success("Copié !"); }
    catch { toast.error("Impossible de copier"); }
  };

  const [filtre, setFiltre] = useState("all");
  const filtered = filtre === "all" ? posts : posts.filter(p => p.type === filtre);

  return (
    <div style={G.page} className="fade-in">
      {/* Bouton nouveau post */}
      <button onClick={() => setShowForm(p => !p)} className="btn-hover"
        style={{ ...G.btn, ...G.btnPrimary, marginBottom: 14 }}>
        {showForm ? "✕ Annuler" : "✏️ Nouveau post"}
      </button>

      {/* Formulaire nouveau post */}
      {showForm && (
        <Card style={{ marginBottom: 14, border: `2px solid ${COLORS.primary}30` }}>
          <div style={{ ...G.sectionTitle, marginBottom: 12 }}>Nouveau post</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            {POST_TYPES.map(t => (
              <button key={t.id} onClick={() => setForm(p => ({ ...p, type: t.id }))}
                style={{ padding: "10px 8px", borderRadius: 12, border: `2px solid ${form.type === t.id ? t.color : COLORS.cream2}`, background: form.type === t.id ? t.color+"15" : COLORS.white, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, boxSizing:"border-box" }}>
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: form.type === t.id ? t.color : COLORS.gray }}>{t.label}</span>
              </button>
            ))}
          </div>
          <Textarea label="Votre message" value={form.texte} onChange={e => setForm(p => ({ ...p, texte: e.target.value }))} placeholder="Partagez une info utile avec la communauté..." maxLength={500} />
          <ImageUploader images={postImages} setImages={setPostImages} max={3} label="📸 Photos (optionnel)" />
          <button onClick={publier} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary }}>📢 Publier</button>
        </Card>
      )}

      {/* Filtres par catégorie */}
      <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:8, marginBottom:14 }}>
        <button onClick={() => setFiltre("all")} style={{ padding:"6px 14px", borderRadius:20, border:`2px solid ${filtre==="all"?COLORS.primary:COLORS.cream2}`, background:filtre==="all"?COLORS.primary:COLORS.white, color:filtre==="all"?COLORS.white:COLORS.gray, fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
          Tous ({posts.length})
        </button>
        {POST_TYPES.map(t => {
          const count = posts.filter(p => p.type === t.id).length;
          return (
            <button key={t.id} onClick={() => setFiltre(t.id)}
              style={{ padding:"6px 12px", borderRadius:20, border:`2px solid ${filtre===t.id?t.color:COLORS.cream2}`, background:filtre===t.id?t.color:COLORS.white, color:filtre===t.id?COLORS.white:COLORS.gray, fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, display:"flex", alignItems:"center", gap:4 }}>
              {t.icon} {t.label} {count > 0 && <span style={{ background:"rgba(255,255,255,0.3)", borderRadius:10, padding:"1px 6px", fontSize:10 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Liste des posts filtrés */}
      {filtered.length === 0
        ? <EmptyState emoji={filtre==="all"?"👥":POST_TYPES.find(t=>t.id===filtre)?.icon||"📝"}
            title={filtre==="all"?"Aucun post":"Aucun post dans cette catégorie"}
            subtitle="Soyez le premier à partager !" />
        : filtered.map(post => {
          const pt = POST_TYPES.find(t => t.id === post.type);
          return (
            <Card key={post.id} style={{ marginBottom: 12, borderLeft: `4px solid ${pt?.color}` }}>
              {/* Auteur */}
              <div style={{ display:"flex", gap:10, marginBottom:8, alignItems:"center" }}>
                <div style={{ width:36, height:36, borderRadius:"50%", overflow:"hidden", background:COLORS.primary+"20", border:`2px solid ${COLORS.cream2}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  {post.photoUrl ? <img src={post.photoUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <span style={{ fontSize:16 }}>{pt?.icon}</span>}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:pt?.color }}>{pt?.label}</div>
                  <div style={{ fontSize:11, color:COLORS.gray }}>{post.auteur} • {post.date}</div>
                </div>
              </div>
              {/* Texte */}
              <div style={{ fontSize:14, color:COLORS.dark, lineHeight:1.6, marginBottom:10 }}>{post.texte}</div>
              {/* Images */}
              {post.images && post.images.length > 0 && (
                <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(post.images.length,3)},1fr)`, gap:6, marginBottom:10 }}>
                  {post.images.slice(0,3).map((img,i) => (
                    <div key={img.id||i} style={{ borderRadius:10, overflow:"hidden", aspectRatio:"1" }}>
                      <img src={img.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                    </div>
                  ))}
                </div>
              )}
              {/* Actions */}
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => partager(post)} style={{ flex:1, padding:"8px 0", borderRadius:10, border:`1px solid ${COLORS.cream2}`, background:COLORS.grayLight, color:COLORS.gray, cursor:"pointer", fontSize:13, fontWeight:700 }}>📋 Copier</button>
                {post.auteurId === user.id && <button onClick={() => supprimer(post.id)} style={{ padding:"8px 12px", borderRadius:10, border:"none", background:"#FEE2E2", color:COLORS.red, cursor:"pointer", fontSize:14 }}>🗑️</button>}
              </div>
            </Card>
          );
        })
      }
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 5 — GROUPES
// ════════════════════════════════════════════════════════
const GroupesPage = ({ user }) => {
  const [groups, setGroups] = useState(() => storage.get(KEYS.GROUPS, []));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nom: "", objectif: "", montantCible: "", cotisation: "", coordinateur: user.telephone });

  const save = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    const charger = async () => {
      if (!estEnLigne()) return;
      try {
        const { data } = await getGroupements();
        if (data && data.length > 0) {
          const norm = data.map(g => ({
            id: g.id, nom: g.produit, objectif: g.description || "",
            montantCible: g.prix_estime || 0, cotisation: 0,
            membres: (g.groupements_participants || []).map(p => p.utilisateur_id),
            createur: g.utilisateurs?.nom || "Inconnu", createurId: g.initiateur_id,
            coordinateur: g.utilisateurs?.telephone || user.telephone,
            date: new Date(g.date_creation).toLocaleDateString("fr-FR"),
          }));
          setGroups(norm); storage.set(KEYS.GROUPS, norm);
        }
      } catch (e) { console.warn("Groupes Supabase:", e); }
    };
    charger();
  }, []);

  const creer = async () => {
    if (!form.nom.trim() || !form.montantCible) { toast.error("Nom et montant cible obligatoires"); return; }
    const tempId = crypto.randomUUID();
    const g = { id: tempId, ...form, montantCible: parseInt(form.montantCible), cotisation: parseInt(form.cotisation) || 0, membres: [user.id], createur: user.nom, createurId: user.id, date: new Date().toLocaleDateString("fr-FR"), createdAt: Date.now() };
    const newG = [g, ...groups];
    setGroups(newG); storage.set(KEYS.GROUPS, newG);
    setShowForm(false);
    setForm({ nom: "", objectif: "", montantCible: "", cotisation: "", coordinateur: user.telephone });
    toast.success("Groupe créé !");
    if (estEnLigne() && user.id) {
      try {
        const { data, error } = await creerGroupement({
          initiateurId: user.id, produit: form.nom, quantiteCible: 1,
          unite: "unité", prixEstime: parseInt(form.montantCible),
          economiePct: 0, description: form.objectif, ville: user.ville,
        });
        if (data) { const up = newG.map(x => x.id === tempId ? { ...x, id: data.id } : x); setGroups(up); storage.set(KEYS.GROUPS, up); }
        if (error) console.warn("Groupe Supabase:", error);
      } catch (e) { console.warn("Groupe Supabase err:", e); }
    }
  };

  const rejoindre = async (id) => {
    const newG = groups.map(g => {
      if (g.id !== id) return g;
      if (g.membres.includes(user.id)) { toast.info("Vous êtes déjà membre"); return g; }
      toast.success("Vous avez rejoint le groupe !");
      return { ...g, membres: [...g.membres, user.id] };
    });
    setGroups(newG); storage.set(KEYS.GROUPS, newG);
    if (estEnLigne() && user.id) {
      try { await rejoindreGroupement(id, user.id); }
      catch (e) { console.warn("Rejoindre Supabase:", e); }
    }
  };

  return (
    <div style={G.page} className="fade-in">
      <button onClick={() => setShowForm(p => !p)} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary, marginBottom: 16 }}>{showForm ? "✕ Annuler" : "➕ Créer un groupe"}</button>
      {showForm && (
        <Card style={{ marginBottom: 16, border: `2px solid ${COLORS.primary}30` }}>
          <div style={G.sectionTitle}>Nouveau groupe d'achat</div>
          <Input label="Nom du groupe" value={form.nom} onChange={e => save("nom", sanitize(e.target.value, 80))} placeholder="Ex: Achat groupé engrais Kaya" />
          <Input label="Objectif" value={form.objectif} onChange={e => save("objectif", sanitize(e.target.value, 200))} placeholder="Ex: Acheter 50 sacs d'engrais NPK" />
          <Input label="Montant cible (FCFA)" value={form.montantCible} onChange={e => save("montantCible", e.target.value.replace(/\D/g, ""))} type="text" inputMode="numeric" placeholder="Ex: 500000" />
          <Input label="Cotisation par membre (FCFA)" value={form.cotisation} onChange={e => save("cotisation", e.target.value.replace(/\D/g, ""))} type="text" inputMode="numeric" placeholder="Ex: 25000" />
          <Input label="Numéro coordinateur WhatsApp" value={form.coordinateur} onChange={e => save("coordinateur", e.target.value)} type="tel" />
          <button onClick={creer} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary }}>✅ Créer le groupe</button>
        </Card>
      )}
      {groups.length === 0 ? <EmptyState emoji="🤝" title="Aucun groupe" subtitle="Créez le premier groupe d'achat !" /> :
        groups.map(g => {
          const total = g.membres.length * (g.cotisation || 0);
          const pct = Math.min(100, Math.round((total / g.montantCible) * 100));
          const estMembre = g.membres.includes(user.id);
          return (
            <Card key={g.id} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.primary, marginBottom: 4 }}>{g.nom}</div>
              <div style={{ fontSize: 13, color: COLORS.gray, marginBottom: 8 }}>{g.objectif}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span>{g.membres.length} membre(s)</span>
                <span style={{ fontWeight: 800, color: COLORS.primary }}>{total.toLocaleString()} / {g.montantCible.toLocaleString()} FCFA</span>
              </div>
              <div style={{ background: COLORS.grayLight, borderRadius: 20, height: 10, marginBottom: 12, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg,${COLORS.primary},${COLORS.primary3})`, borderRadius: 20, transition: "width 0.5s" }} />
              </div>
              <div style={{ fontSize: 12, color: COLORS.gray, marginBottom: 10 }}>Créé par {g.createur} • {g.date}</div>
              <div style={{ display: "flex", gap: 8 }}>
                {estMembre ? (
                  <div style={{ flex: 1, padding: "10px 0", borderRadius: 12, background: COLORS.green + "15", color: COLORS.green, fontSize: 13, fontWeight: 800, textAlign: "center" }}>✅ Déjà membre</div>
                ) : (
                  <button onClick={() => rejoindre(g.id)} className="btn-hover" style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "none", background: COLORS.primary, color: COLORS.white, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>🤝 Rejoindre</button>
                )}
                <button onClick={() => openWhatsApp(g.coordinateur, `Bonjour, je souhaite rejoindre le groupe "${g.nom}" sur AgriSahel BF`)} style={{ padding: "10px 14px", borderRadius: 12, border: "none", background: "#25D366", color: COLORS.white, cursor: "pointer", fontSize: 16 }}>💬</button>
              </div>
            </Card>
          );
        })
      }
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 6 — DIAGNOSTIC IA
// ════════════════════════════════════════════════════════
const CULTURES = ["Sorgho","Maïs","Mil","Coton","Arachide","Sésame","Niébé","Riz","Haricot vert","Tomate"];
const ANIMAUX = ["Bovins","Ovins","Caprins","Volaille","Porcins","Lapins","Ânes"];

const IAPage = ({ user }) => {
  const [mode, setMode] = useState("agriculture");
  const [sujet, setSujet] = useState("Sorgho");
  const [symptomes, setSymptomes] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [history, setHistory] = useState(() => storage.get(priv(user.id, "ia_history"), []));

  const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

  const analyser = async () => {
    if (!symptomes.trim()) { toast.error("Décrivez les symptômes"); return; }
    setLoading(true); setErr(""); setResult(null);
    try {
      const symSafe = sanitize(symptomes, 500);
      const prompt = `Tu es un expert agronome et vétérinaire spécialisé en Afrique de l'Ouest (Burkina Faso).
${mode === "agriculture" ? `Culture: ${sujet}` : `Animal: ${sujet}`}
Symptômes: ${symSafe}
Réponds UNIQUEMENT en JSON valide:
{"diagnostic":"nom de la maladie ou problème","probabilite":"Élevée/Moyenne/Faible","causes":["cause1","cause2"],"traitements":[{"titre":"traitement","description":"détail","urgent":true/false}],"prevention":["conseil1","conseil2"],"urgence":"Critique/Modérée/Faible","reference_veterinaire":true/false,"produits_locaux":["produit BF disponible"]}`;

      if (!API_KEY) {
        await new Promise(r => setTimeout(r, 2000));
        const demoResult = { diagnostic: `Helminthosporiose (${sujet}) — MODE DÉMO`, probabilite: "Élevée", causes: ["Humidité excessive", "Sol pauvre"], traitements: [{ titre: "Fongicide Mancozèbe", description: "2g/L d'eau, appliquer tôt le matin. Disponible au marché.", urgent: true }], prevention: ["Rotation cultures", "Semences certifiées"], urgence: "Modérée", reference_veterinaire: mode === "elevage", produits_locaux: ["Mancozèbe SOFITEX", "Dithane M45"] };
        setResult(demoResult);
        const h = [{ id: crypto.randomUUID(), sujet, symptomes: symSafe, result: demoResult, date: new Date().toLocaleDateString("fr-FR") }, ...history].slice(0, 10);
        setHistory(h); storage.set(priv(user.id, "ia_history"), h);
        return;
      }

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] })
      });
      if (!resp.ok) throw new Error(`Erreur API ${resp.status}`);
      const data = await resp.json();
      const text = data.content?.find(c => c.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setResult(parsed);
      const h = [{ id: crypto.randomUUID(), sujet, symptomes: symSafe, result: parsed, date: new Date().toLocaleDateString("fr-FR") }, ...history].slice(0, 10);
      setHistory(h); storage.set(priv(user.id, "ia_history"), h);
    } catch (e) {
      setErr(`❌ ${e.message || "Erreur d'analyse"}`);
    } finally { setLoading(false); }
  };

  const urgColor = { Critique: COLORS.red, Modérée: COLORS.orange, Faible: COLORS.green };

  return (
    <div style={G.page} className="fade-in">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["agriculture","🌾 Agriculture"],["elevage","🐄 Élevage"]].map(([v,l]) => (
          <button key={v} onClick={() => { setMode(v); setSujet(v === "agriculture" ? CULTURES[0] : ANIMAUX[0]); setResult(null); }} style={{ flex: 1, padding: "11px 0", borderRadius: 14, border: `2px solid ${mode === v ? COLORS.primary : COLORS.cream2}`, background: mode === v ? COLORS.primary : COLORS.white, color: mode === v ? COLORS.white : COLORS.gray, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>{l}</button>
        ))}
      </div>
      <Card>
        <Select label={mode === "agriculture" ? "Culture" : "Animal"} value={sujet} onChange={e => setSujet(e.target.value)} options={mode === "agriculture" ? CULTURES : ANIMAUX} />
        <Textarea label="Symptômes observés" value={symptomes} onChange={e => setSymptomes(e.target.value)} placeholder={`Décrivez ce que vous observez sur votre ${mode === "agriculture" ? "culture" : "animal"}...`} maxLength={500} />
        {!API_KEY && <div style={{ background: "#FEF3C7", borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#92400E", fontWeight: 700 }}>⚠️ Mode démo — Configurez VITE_ANTHROPIC_API_KEY pour l'IA réelle</div>}
        {err && <div style={{ background: "#FEE2E2", borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: COLORS.red, fontWeight: 700 }}>{err}</div>}
        <button onClick={analyser} disabled={loading} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary, opacity: loading ? 0.7 : 1 }}>
          {loading ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Spinner size={18} /> Analyse en cours...</span> : "🤖 Analyser"}
        </button>
      </Card>
      {result && (
        <Card style={{ marginTop: 16, border: `2px solid ${urgColor[result.urgence] || COLORS.primary}40` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontFamily: "Fraunces,serif", fontSize: 18, fontWeight: 900, color: COLORS.primary }}>{result.diagnostic}</div>
            <Badge color={urgColor[result.urgence] || COLORS.orange}>{result.urgence}</Badge>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <Badge color={COLORS.blue}>Probabilité: {result.probabilite}</Badge>
            {result.reference_veterinaire && <Badge color={COLORS.red}>🏥 Voir vétérinaire</Badge>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.dark, marginBottom: 8 }}>📋 Causes</div>
          {result.causes?.map((c, i) => <div key={i} style={{ fontSize: 13, color: COLORS.gray, padding: "3px 0" }}>• {c}</div>)}
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.dark, margin: "12px 0 8px" }}>💊 Traitements</div>
          {result.traitements?.map((t, i) => (
            <div key={i} style={{ background: t.urgent ? "#FEE2E2" : COLORS.grayLight, borderRadius: 12, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: t.urgent ? COLORS.red : COLORS.dark }}>{t.urgent ? "🚨 " : ""}{t.titre}</div>
              <div style={{ fontSize: 12, color: COLORS.gray, marginTop: 4 }}>{t.description}</div>
            </div>
          ))}
          {result.produits_locaux?.length > 0 && (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.dark, margin: "12px 0 8px" }}>🏪 Disponible au Burkina</div>
              {result.produits_locaux.map((p, i) => <Badge key={i} color={COLORS.primary2}>{p}</Badge>)}
            </>
          )}
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#FEF3C7", borderRadius: 12, fontSize: 12, color: "#92400E", fontWeight: 700 }}>
            ⚠️ Ce diagnostic est indicatif. Consultez un agronome ou vétérinaire avant tout traitement massif.
          </div>
        </Card>
      )}
      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={G.sectionTitle}>Historique ({history.length}/10)</div>
          {history.map(h => (
            <Card key={h.id} style={{ marginBottom: 8, cursor: "pointer", padding: 12 }} onClick={() => setResult(h.result)}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{h.sujet} — {h.date}</div>
              <div style={{ fontSize: 12, color: COLORS.gray }}>{h.symptomes.slice(0, 60)}...</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 7 — VÉTÉRINAIRES
// ════════════════════════════════════════════════════════
const VETO_DATA = [
  { region: "Centre (Ouagadougou)", nom: "DPRAH Centre", tel: "70001001", adresse: "Ouagadougou, secteur 17" },
  { region: "Hauts-Bassins (Bobo)", nom: "DPRAH Hauts-Bassins", tel: "70001002", adresse: "Bobo-Dioulasso" },
  { region: "Centre-Nord (Kaya)", nom: "DPRAH Centre-Nord", tel: "70001003", adresse: "Kaya" },
  { region: "Sahel (Dori)", nom: "DPRAH Sahel", tel: "70001004", adresse: "Dori" },
  { region: "Est (Fada)", nom: "DPRAH Est", tel: "70001005", adresse: "Fada N'Gourma" },
];

const MALADIES_REF = {
  "bovins": ["Fièvre aphteuse", "Trypanosomiase", "PPCB", "Charbon", "Péripneumonie"],
  "ovins": ["PPR (Clavelée)", "Pasteurellose", "Ecthyma contagieux", "Variole ovine"],
  "volaille": ["Newcastle", "Grippe aviaire", "Marek", "Gumboro"],
  "porcins": ["Peste porcine africaine", "Rouget du porc", "SDRP"],
};

const VeterinaireePage = () => {
  const [animal, setAnimal] = useState("bovins");
  const [alerteEnvoyee, setAlerteEnvoyee] = useState(false);
  return (
    <div style={G.page} className="fade-in">
      <Card style={{ background: `linear-gradient(135deg,${COLORS.red},#dc2626)`, color: COLORS.white, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>🚨 Alerte sanitaire d'urgence</div>
        <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 12 }}>Si vous observez une maladie suspecte ou une mortalité massive, alertez immédiatement.</div>
        <button onClick={() => { openWhatsApp("70001001", "🚨 URGENCE SANITAIRE — J'observe une maladie suspecte dans mon troupeau. Besoin d'assistance immédiate."); setAlerteEnvoyee(true); }} className="btn-hover" style={{ background: COLORS.white, color: COLORS.red, border: "none", borderRadius: 12, padding: "10px 20px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
          {alerteEnvoyee ? "✅ Alerte envoyée" : "📞 Envoyer alerte maintenant"}
        </button>
      </Card>
      <div style={G.sectionTitle}>Services vétérinaires régionaux</div>
      {VETO_DATA.map((v, i) => (
        <Card key={i} style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: COLORS.primary }}>{v.nom}</div>
          <div style={{ fontSize: 13, color: COLORS.gray, margin: "4px 0 10px" }}>📍 {v.adresse} • {v.region}</div>
          <button onClick={() => openWhatsApp(v.tel, `Bonjour, j'ai besoin d'une assistance vétérinaire. Je suis dans la région ${v.region}.`)} className="btn-hover" style={{ ...G.btn, background: "#25D366", color: COLORS.white, padding: "10px 0", fontSize: 14, fontWeight: 800 }}>💬 Contacter via WhatsApp</button>
        </Card>
      ))}
      <div style={G.sectionTitle}>Référence maladies courantes</div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 12 }}>
        {Object.keys(MALADIES_REF).map(a => (
          <button key={a} onClick={() => setAnimal(a)} style={{ padding: "6px 14px", borderRadius: 20, border: `2px solid ${animal === a ? COLORS.primary : COLORS.cream2}`, background: animal === a ? COLORS.primary : COLORS.white, color: animal === a ? COLORS.white : COLORS.gray, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", textTransform: "capitalize" }}>{a}</button>
        ))}
      </div>
      <Card>
        <div style={{ fontWeight: 800, fontSize: 15, color: COLORS.primary, marginBottom: 10 }}>Maladies fréquentes — {animal}</div>
        {MALADIES_REF[animal].map((m, i) => <div key={i} style={{ padding: "8px 0", borderBottom: i < MALADIES_REF[animal].length - 1 ? `1px solid ${COLORS.cream2}` : "none", fontSize: 14, color: COLORS.dark }}>🔴 {m}</div>)}
      </Card>
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 8 — CALCULATEUR
// ════════════════════════════════════════════════════════
const CalculateurPage = () => {
  const [rev, setRev] = useState({ culture: "Sorgho", superficie: "", rendement: "", prixVente: "" });
  const [dep, setDep] = useState({ semences: "", engrais: "", main_oeuvre: "", irrigation: "", autre: "" });
  const [result, setResult] = useState(null);

  const sRev = (k, v) => setRev(p => ({ ...p, [k]: v }));
  const sDep = (k, v) => setDep(p => ({ ...p, [k]: v }));

  const calculer = () => {
    const n = (v) => parseFloat(v) || 0;
    const totalProduction = n(rev.superficie) * n(rev.rendement);
    const totalRevenu = totalProduction * n(rev.prixVente);
    const totalDepenses = n(dep.semences) + n(dep.engrais) + n(dep.main_oeuvre) + n(dep.irrigation) + n(dep.autre);
    const profitNet = totalRevenu - totalDepenses;
    const margeGrossiere = totalRevenu > 0 ? Math.round((profitNet / totalRevenu) * 100) : 0;
    setResult({ totalRevenu, totalDepenses, profitNet, margeGrossiere, totalProduction });
  };

  const partager = async () => {
    if (!result) return;
    const text = `📊 Calcul AgriSahel BF\nCulture: ${rev.culture} (${rev.superficie}ha)\nRevenu brut: ${result.totalRevenu.toLocaleString()} FCFA\nDépenses: ${result.totalDepenses.toLocaleString()} FCFA\n💰 Profit net: ${result.profitNet.toLocaleString()} FCFA\nMarge: ${result.margeGrossiere}%`;
    if (navigator.share) await navigator.share({ title: "Mon calcul AgriSahel", text });
    else { await navigator.clipboard.writeText(text); toast.success("Copié !"); }
  };

  return (
    <div style={G.page} className="fade-in">
      <Card style={{ marginBottom: 12 }}>
        <div style={G.sectionTitle}>📥 Revenus</div>
        <Select label="Culture" value={rev.culture} onChange={e => sRev("culture", e.target.value)} options={CULTURES} />
        <Input label="Superficie (hectares)" value={rev.superficie} onChange={e => sRev("superficie", e.target.value)} type="text" inputMode="decimal" placeholder="Ex: 2.5" />
        <Input label="Rendement estimé (kg/ha)" value={rev.rendement} onChange={e => sRev("rendement", e.target.value)} type="text" inputMode="numeric" placeholder="Ex: 800" />
        <Input label="Prix de vente (FCFA/kg)" value={rev.prixVente} onChange={e => sRev("prixVente", e.target.value)} type="text" inputMode="numeric" placeholder="Ex: 175" />
      </Card>
      <Card style={{ marginBottom: 12 }}>
        <div style={G.sectionTitle}>📤 Dépenses</div>
        {[["semences","🌱 Semences"],["engrais","🧪 Engrais"],["main_oeuvre","👷 Main d'œuvre"],["irrigation","💧 Irrigation"],["autre","📦 Autre"]].map(([k,l]) => (
          <Input key={k} label={l} value={dep[k]} onChange={e => sDep(k, e.target.value)} type="text" inputMode="numeric" placeholder="0 FCFA" />
        ))}
      </Card>
      <button onClick={calculer} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary, marginBottom: 16 }}>🧮 Calculer le profit</button>
      {result && (
        <Card style={{ border: `2px solid ${result.profitNet >= 0 ? COLORS.green : COLORS.red}40` }}>
          <div style={{ fontFamily: "Fraunces,serif", fontSize: 20, fontWeight: 900, color: COLORS.primary, marginBottom: 16, textAlign: "center" }}>Résultats — {rev.culture}</div>
          {[
            { label: "Production totale", val: `${result.totalProduction.toLocaleString()} kg`, color: COLORS.blue, icon: "🌾" },
            { label: "Revenu brut", val: `${result.totalRevenu.toLocaleString()} FCFA`, color: COLORS.blue, icon: "📥" },
            { label: "Total dépenses", val: `${result.totalDepenses.toLocaleString()} FCFA`, color: COLORS.red, icon: "📤" },
            { label: "Profit net", val: `${result.profitNet.toLocaleString()} FCFA`, color: result.profitNet >= 0 ? COLORS.green : COLORS.red, icon: "💰" },
            { label: "Marge brute", val: `${result.margeGrossiere}%`, color: result.margeGrossiere >= 30 ? COLORS.green : COLORS.orange, icon: "📊" },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${COLORS.cream2}` }}>
              <span style={{ fontSize: 14, color: COLORS.gray }}>{r.icon} {r.label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: r.color }}>{r.val}</span>
            </div>
          ))}
          <button onClick={partager} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary, marginTop: 16 }}>📤 Partager les résultats</button>
        </Card>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 9 — MICRO-FINANCE
// ════════════════════════════════════════════════════════
const INSTITUTIONS = [
  { nom: "BADF", label: "Banque Agricole du Faso", emoji: "🏦", badge: "Banque d'État", tel: "25340001", color: COLORS.blue },
  { nom: "RCPB", label: "Réseau des Caisses Populaires", emoji: "🏛️", badge: "Coopérative", tel: "25340002", color: COLORS.green },
  { nom: "Baobab BF", label: "Baobab Microfinance", emoji: "🌳", badge: "IMF", tel: "70340003", color: COLORS.amber },
  { nom: "COOPEC-BF", label: "Coopérative d'Épargne et Crédit", emoji: "🤝", badge: "Coopérative", tel: "70340004", color: COLORS.primary2 },
];

const LOAN_TYPES = ["Crédit agricole", "Fonds de roulement", "Micro-épargne", "Subvention"];

const MicroFinancePage = ({ user, journal }) => {
  const [requests, setRequests] = useState(() => storage.get(priv(user.id, "financing"), []));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: LOAN_TYPES[0], montant: "", institution: "BADF", objet: "" });
  const [showScore, setShowScore] = useState(false);

  const calcScore = () => {
    let score = 0;
    const entries = journal.length;
    if (entries >= 10) score += 25; else if (entries >= 5) score += 15; else if (entries > 0) score += 5;
    const gains = journal.filter(e => e.impact === "gain").length;
    if (gains > 5) score += 25; else if (gains > 2) score += 15;
    const totalG = journal.filter(e => e.impact === "gain").reduce((s, e) => s + (e.montant || 0), 0);
    if (totalG > 500000) score += 25; else if (totalG > 100000) score += 15; else if (totalG > 0) score += 5;
    if (requests.length > 0) score += 10;
    if (user.verifie) score += 15;
    return Math.min(100, score);
  };

  const score = calcScore();
  const scoreColor = score >= 70 ? COLORS.green : score >= 40 ? COLORS.orange : COLORS.red;
  const scoreLabel = score >= 70 ? "Excellent" : score >= 40 ? "Moyen" : "À améliorer";

  const ajouter = () => {
    if (!form.montant || !form.objet.trim()) { toast.error("Montant et objet obligatoires"); return; }
    const r = { id: crypto.randomUUID(), ...form, montant: parseInt(form.montant), statut: "En attente", date: new Date().toLocaleDateString("fr-FR"), createdAt: Date.now() };
    const newR = [r, ...requests];
    setRequests(newR);
    storage.set(priv(user.id, "financing"), newR);
    setShowForm(false);
    toast.success("Demande enregistrée !");
  };

  const exporterScore = () => {
    const text = `RAPPORT DE CRÉDIBILITÉ AGRISAHEL BF\n${"=".repeat(40)}\nNom: ${user.nom}\nTéléphone: ${user.telephone}\nVille: ${user.ville}\nDate: ${new Date().toLocaleDateString("fr-FR")}\n\nSCORE DE CRÉDIBILITÉ: ${score}/100 — ${scoreLabel}\n\nINDICATEURS:\n• Régularité journal: ${journal.length} entrées\n• Transactions enregistrées: ${journal.filter(e => e.impact !== "neutre").length}\n• Gains totaux: ${journal.filter(e => e.impact === "gain").reduce((s, e) => s + (e.montant || 0), 0).toLocaleString()} FCFA\n• Compte vérifié: ${user.verifie ? "Oui" : "Non"}\n\nDocument généré par AgriSahel BF v${APP_VERSION}`;
    navigator.clipboard.writeText(text).then(() => toast.success("Rapport copié !"));
  };

  return (
    <div style={G.page} className="fade-in">
      <Card style={{ marginBottom: 16, textAlign: "center", cursor: "pointer" }} onClick={() => setShowScore(p => !p)}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.gray, marginBottom: 8 }}>Score de crédibilité</div>
        <div style={{ position: "relative", width: 100, height: 100, margin: "0 auto 12px" }}>
          <svg viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="50" cy="50" r="40" fill="none" stroke={COLORS.grayLight} strokeWidth="10" />
            <circle cx="50" cy="50" r="40" fill="none" stroke={scoreColor} strokeWidth="10" strokeDasharray={`${score * 2.51} 251`} strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: scoreColor }}>{score}</div>
            <div style={{ fontSize: 10, color: COLORS.gray }}>/100</div>
          </div>
        </div>
        <Badge color={scoreColor}>{scoreLabel}</Badge>
        {showScore && (
          <div style={{ marginTop: 12, textAlign: "left" }}>
            {[
              { label: "Entrées journal", val: journal.length, ok: journal.length >= 5 },
              { label: "Transactions enregistrées", val: journal.filter(e => e.impact !== "neutre").length, ok: journal.filter(e => e.impact !== "neutre").length >= 3 },
              { label: "Compte vérifié", val: user.verifie ? "Oui" : "Non", ok: user.verifie },
              { label: "Demandes de financement", val: requests.length, ok: requests.length > 0 },
            ].map((ind, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLORS.cream2}`, fontSize: 13 }}>
                <span style={{ color: COLORS.gray }}>{ind.ok ? "✅" : "⚠️"} {ind.label}</span>
                <span style={{ fontWeight: 800, color: ind.ok ? COLORS.green : COLORS.orange }}>{String(ind.val)}</span>
              </div>
            ))}
            <button onClick={exporterScore} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary, marginTop: 12, padding: 12, fontSize: 13 }}>📋 Exporter rapport banque</button>
          </div>
        )}
      </Card>
      <div style={G.sectionTitle}>Institutions partenaires</div>
      {INSTITUTIONS.map((inst, i) => (
        <Card key={i} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 28 }}>{inst.emoji}</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{inst.nom}</div>
                <div style={{ fontSize: 12, color: COLORS.gray }}>{inst.label}</div>
              </div>
            </div>
            <Badge color={inst.color}>{inst.badge}</Badge>
          </div>
          <button onClick={() => openWhatsApp(inst.tel, `Bonjour ${inst.nom}, je souhaite des informations sur vos services de financement agricole.`)} className="btn-hover" style={{ ...G.btn, background: "#25D366", color: COLORS.white, padding: "10px 0", fontSize: 13, fontWeight: 800 }}>💬 Contacter</button>
        </Card>
      ))}
      <button onClick={() => setShowForm(p => !p)} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary, margin: "8px 0 16px" }}>{showForm ? "✕ Annuler" : "📝 Nouvelle demande"}</button>
      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <Select label="Type de financement" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} options={LOAN_TYPES} />
          <Input label="Montant demandé (FCFA)" value={form.montant} onChange={e => setForm(p => ({ ...p, montant: e.target.value.replace(/\D/g, "") }))} type="text" inputMode="numeric" placeholder="Ex: 250000" />
          <Select label="Institution" value={form.institution} onChange={e => setForm(p => ({ ...p, institution: e.target.value }))} options={INSTITUTIONS.map(i => i.nom)} />
          <Textarea label="Objet de la demande" value={form.objet} onChange={e => setForm(p => ({ ...p, objet: sanitize(e.target.value, 300) }))} placeholder="Expliquez l'utilisation des fonds..." />
          <button onClick={ajouter} className="btn-hover" style={{ ...G.btn, ...G.btnPrimary }}>✅ Enregistrer la demande</button>
        </Card>
      )}
      {requests.length > 0 && (
        <>
          <div style={G.sectionTitle}>Mes demandes</div>
          {requests.map(r => (
            <Card key={r.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{r.type}</div>
                <Badge color={COLORS.orange}>{r.statut}</Badge>
              </div>
              <div style={{ fontSize: 13, color: COLORS.primary, fontWeight: 800, marginTop: 4 }}>{r.montant.toLocaleString()} FCFA</div>
              <div style={{ fontSize: 12, color: COLORS.gray, marginTop: 2 }}>{r.institution} • {r.date}</div>
              <div style={{ fontSize: 13, color: COLORS.dark, marginTop: 6 }}>{r.objet}</div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 10 — AIDE
// ════════════════════════════════════════════════════════
const FAQ = [
  { q: "Comment créer un compte ?", a: "Sur l'écran d'accueil, choisissez S'inscrire. Entrez votre numéro burkinabè, un mot de passe et validez avec le code OTP reçu." },
  { q: "Comment ajouter une entrée dans mon journal ?", a: "Allez dans Journal → Ajouter. Choisissez le type (Activité, Vente, Élevage...), décrivez votre activité, et ajoutez l'impact financier si nécessaire." },
  { q: "Comment publier une annonce sur le marché ?", a: "Marché → Publier. Remplissez le titre, la catégorie, le prix et votre numéro WhatsApp. Les acheteurs vous contactent directement." },
  { q: "Comment rejoindre un groupe d'achat ?", a: "Groupes → trouvez un groupe qui vous intéresse → Rejoindre. Contactez le coordinateur via WhatsApp pour les détails." },
  { q: "Comment fonctionne le diagnostic IA ?", a: "IA Diagnostic → choisissez Agriculture ou Élevage → sélectionnez votre culture/animal → décrivez les symptômes → Analyser. Obtenez un diagnostic en quelques secondes." },
  { q: "L'app fonctionne-t-elle sans internet ?", a: "Oui ! Le journal, le calculateur et les données déjà chargées fonctionnent hors ligne. Le marché et la communauté nécessitent une connexion pour les nouvelles données." },
  { q: "Comment exporter mes données ?", a: "Paramètres → Exporter mes données. Vous obtenez un fichier JSON contenant votre journal, diagnostics et demandes de financement." },
  { q: "Comment améliorer mon score de crédibilité ?", a: "Remplissez régulièrement votre journal, enregistrez vos ventes et dépenses, et faites des demandes de financement. Plus vous utilisez l'app, plus votre score monte." },
];

const AidePage = () => {
  const [open, setOpen] = useState(null);
  return (
    <div style={G.page} className="fade-in">
      <Card style={{ background: `linear-gradient(135deg,${COLORS.primary},${COLORS.primary2})`, color: COLORS.white, marginBottom: 20, textAlign: "center", padding: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>❓</div>
        <div style={{ fontFamily: "Fraunces,serif", fontSize: 20, fontWeight: 900 }}>Centre d'aide</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>AgriSahel BF v{APP_VERSION}</div>
      </Card>
      {FAQ.map((item, i) => (
        <Card key={i} style={{ marginBottom: 8 }}>
          <button onClick={() => setOpen(open === i ? null : i)} style={{ width: "100%", background: "none", border: "none", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: COLORS.dark, textAlign: "left", flex: 1 }}>{item.q}</span>
            <span style={{ fontSize: 20, color: COLORS.gray, marginLeft: 8 }}>{open === i ? "▲" : "▼"}</span>
          </button>
          {open === i && <div style={{ fontSize: 13, color: COLORS.gray, lineHeight: 1.7, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.cream2}` }}>{item.a}</div>}
        </Card>
      ))}
    </div>
  );
};

// ════════════════════════════════════════════════════════
// TAB 11 — PARAMÈTRES
// ════════════════════════════════════════════════════════
const ParametresPage = ({ user, journal, onLogout }) => {
  const listings = storage.get(KEYS.LISTINGS, []);
  const posts = storage.get(KEYS.POSTS, []);
  const diagnostics = storage.get(priv(user.id, "ia_history"), []);
  const financing = storage.get(priv(user.id, "financing"), []);

  const exporter = () => {
    const data = { version: APP_VERSION, exportDate: new Date().toISOString(), user: { nom: user.nom, telephone: user.telephone, ville: user.ville, dateInscription: user.dateInscription }, journal, diagnostics, financing };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `agrisahel_export_${Date.now()}.json`; a.click();
    toast.success("Données exportées !");
  };

  const importer = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.journal) { storage.set(priv(user.id, "journal"), data.journal); }
        if (data.diagnostics) { storage.set(priv(user.id, "ia_history"), data.diagnostics); }
        if (data.financing) { storage.set(priv(user.id, "financing"), data.financing); }
        toast.success(`${(data.journal?.length || 0)} entrées importées !`);
      } catch { toast.error("Fichier invalide"); }
    };
    reader.readAsText(file);
  };

  const stats = [
    { label: "Entrées journal", val: journal.length, icon: "📔" },
    { label: "Annonces publiées", val: listings.filter(l => l.auteurId === user.id).length, icon: "🛒" },
    { label: "Posts communauté", val: posts.filter(p => p.auteurId === user.id).length, icon: "👥" },
    { label: "Diagnostics IA", val: diagnostics.length, icon: "🤖" },
    { label: "Demandes financement", val: financing.length, icon: "🏦" },
  ];

  return (
    <div style={G.page} className="fade-in">
      <Card style={{ marginBottom: 16, background: `linear-gradient(135deg,${COLORS.primary},${COLORS.primary2})`, color: COLORS.white }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: COLORS.amber, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900 }}>{user.nom[0]}</div>
          <div>
            <div style={{ fontFamily: "Fraunces,serif", fontSize: 20, fontWeight: 900 }}>{user.nom}</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>📱 {user.telephone}</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>📍 {user.ville}</div>
            {user.verifie && <Badge color={COLORS.white}>✅ Compte vérifié</Badge>}
          </div>
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {stats.map(s => (
          <Card key={s.label} style={{ padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>{s.icon}</div>
            <div style={{ fontWeight: 900, fontSize: 20, color: COLORS.primary }}>{s.val}</div>
            <div style={{ fontSize: 11, color: COLORS.gray }}>{s.label}</div>
          </Card>
        ))}
      </div>
      <Card style={{ marginBottom: 12 }}>
        <div style={G.sectionTitle}>Gestion des données</div>
        <button onClick={exporter} className="btn-hover" style={{ ...G.btn, background: COLORS.primary + "15", color: COLORS.primary, fontWeight: 800, marginBottom: 10 }}>📥 Exporter mes données (JSON)</button>
        <label className="btn-hover" style={{ ...G.btn, background: COLORS.grayLight, color: COLORS.dark, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          📤 Importer des données
          <input type="file" accept=".json" onChange={importer} style={{ display: "none" }} />
        </label>
      </Card>
      <button onClick={onLogout} className="btn-hover" style={{ ...G.btn, background: "#FEE2E2", color: COLORS.red, fontWeight: 800 }}>🚪 Se déconnecter</button>
    </div>
  );
};

// ════════════════════════════════════════════════════════
// APP PRINCIPALE
// ════════════════════════════════════════════════════════
const SESSION_KEY = "agrisahel_v4_session";

export default function AgriSahelBF() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [journal, setJournal] = useState([]);

  const pageTitles = {
    dashboard: "🌾 AgriSahel BF", journal: "📔 Journal de bord", marche: "🛒 Marché",
    communaute: "👥 Communauté", groupes: "🤝 Groupes d'achat", ia: "🤖 Diagnostic IA",
    veterinaire: "🐄 Vétérinaires", calculateur: "💡 Calculateur", microfinance: "🏦 Micro-Finance",
    aide: "❓ Aide", parametres: "⚙️ Paramètres",
  };

  const chargerJournal = useCallback(async (u) => {
    // Essayer Supabase d'abord, fallback localStorage
    if (estEnLigne() && u.id) {
      try {
        const { data } = await getJournalDB(u.id);
        if (data && data.length > 0) {
          const norm = data.map(j => ({
            id: j.id, type: j.type, categorie: j.categorie,
            montant: j.montant, description: j.description,
            impact: j.type === "revenu" ? "gain" : j.type === "depense" ? "depense" : "neutre",
            date: j.date_entree,
          }));
          setJournal(norm);
          storage.set(priv(u.id, "journal"), norm);
          return;
        }
      } catch (e) { console.warn("Journal Supabase:", e); }
    }
    // Fallback localStorage
    setJournal(storage.get(priv(u.id, "journal"), []));
  }, []);

  const handleAuth = useCallback(async (u) => {
    setUser(u);
    storage.set(SESSION_KEY, { user: u, expireAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    await chargerJournal(u);
    // Sync auto offline→online
    if (u.id) initialiserSyncAuto(u.id, (nb) => nb > 0 && toast.success(`${nb} action(s) synchronisée(s) !`));
    setTab("dashboard");
  }, [chargerJournal]);

  const handleLogout = () => {
    storage.remove(SESSION_KEY);
    setUser(null);
    setJournal([]);
    setTab("dashboard");
    toast.info("Déconnecté");
  };

  useEffect(() => {
    const session = storage.get(SESSION_KEY);
    if (session && session.user && Date.now() < session.expireAt) {
      handleAuth(session.user);
    }
  }, [handleAuth]);

  if (!user) return (
    <>
      <GlobalStyle />
      <ToastContainer />
      <AuthPage onAuth={handleAuth} />
    </>
  );

  const renderTab = () => {
    const props = { user, journal, setJournal, onTabChange: setTab, onLogout: handleLogout };
    const tabs = {
      dashboard: <DashboardPage {...props} />,
      journal: <JournalPage {...props} />,
      marche: <MarchePage {...props} />,
      communaute: <CommunautePage {...props} />,
      groupes: <GroupesPage {...props} />,
      ia: <IAPage {...props} />,
      veterinaire: <VeterinaireePage {...props} />,
      calculateur: <CalculateurPage {...props} />,
      microfinance: <MicroFinancePage {...props} />,
      aide: <AidePage />,
      parametres: <ParametresPage {...props} />,
    };
    return (
      <TabErrorBoundary tabName={pageTitles[tab] || tab}>
        {tabs[tab] || <EmptyState emoji="🚧" title="En construction" subtitle="Bientôt disponible" />}
      </TabErrorBoundary>
    );
  };

  return (
    <>
      <GlobalStyle />
      <ToastContainer />
      <div style={{ maxWidth: "480px", margin: "0 auto", minHeight: "100vh", background: COLORS.cream, paddingBottom: "80px", position: "relative", overflowX: "hidden" }}>
        <TopBar title={pageTitles[tab] || "AgriSahel BF"} user={user} onLogout={handleLogout} />
        <div className="fade-in">{renderTab()}</div>
        <BottomNav active={tab} onChange={setTab} />
      </div>
    </>
  );
}