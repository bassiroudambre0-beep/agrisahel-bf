 // ══════════════════════════════════════════════════
// AgriSahel BF — Service Supabase
// Toutes les fonctions base de données
// ══════════════════════════════════════════════════
import { supabase } from './supabase'

// ─────────────────────────────────────────────────
// 👤 UTILISATEURS
// ─────────────────────────────────────────────────

// Inscription — créer un nouveau compte
export const inscrireUtilisateur = async ({ telephone, nom, ville, activites, mdpHash, photoUrl }) => {
  const { data, error } = await supabase
    .from('utilisateurs')
    .insert([{
      telephone,
      nom,
      ville,
      activites,
      mdp_hash: mdpHash,
      photo_url: photoUrl || null,
      verifie: true,
    }])
    .select()
    .single()

  if (error) {
    // Numéro déjà inscrit
    if (error.code === '23505') return { data: null, error: "Ce numéro est déjà inscrit." }
    return { data: null, error: error.message }
  }
  return { data, error: null }
}

// Connexion — vérifier identifiants
export const connecterUtilisateur = async (telephone, mdpHash) => {
  const { data, error } = await supabase
    .from('utilisateurs')
    .select('*')
    .eq('telephone', telephone)
    .eq('mdp_hash', mdpHash)
    .eq('actif', true)
    .single()

  if (error) return { data: null, error: "Numéro ou mot de passe incorrect." }

  // Mettre à jour la dernière connexion
  await supabase
    .from('utilisateurs')
    .update({ derniere_connexion: new Date().toISOString() })
    .eq('id', data.id)

  return { data, error: null }
}

// Vérifier si numéro existe déjà
export const verifierTelephone = async (telephone) => {
  const { data } = await supabase
    .from('utilisateurs')
    .select('id')
    .eq('telephone', telephone)
    .single()
  return !!data
}

// Récupérer profil utilisateur
export const getProfil = async (userId) => {
  const { data, error } = await supabase
    .from('utilisateurs')
    .select('*')
    .eq('id', userId)
    .single()
  return { data, error }
}

// ─────────────────────────────────────────────────
// 🛒 ANNONCES MARCHÉ
// ─────────────────────────────────────────────────

// Récupérer toutes les annonces actives
export const getAnnonces = async (ville = null, categorie = null) => {
  let query = supabase
    .from('annonces')
    .select(`
      *,
      images,
      utilisateurs (id, nom, telephone, ville, photo_url, reputation_score, nb_avis, verifie)
    `)
    .eq('actif', true)
    .gt('date_expiration', new Date().toISOString())
    .order('date_creation', { ascending: false })

  if (ville) query = query.eq('ville', ville)
  if (categorie) query = query.eq('categorie', categorie)

  const { data, error } = await query
  return { data: data || [], error }
}

// Publier une annonce
export const publierAnnonce = async ({ vendeurId, produit, categorie, quantite, prix, description, ville, images = [] }) => {
  const { data, error } = await supabase
    .from('annonces')
    .insert([{
      vendeur_id: vendeurId,
      produit,
      categorie,
      quantite,
      prix,
      description,
      ville,
      images: images || [],
    }])
    .select()
    .single()
  return { data, error }
}

// Supprimer une annonce
export const supprimerAnnonce = async (annonceId, vendeurId) => {
  const { error } = await supabase
    .from('annonces')
    .update({ actif: false })
    .eq('id', annonceId)
    .eq('vendeur_id', vendeurId)
  return { error }
}

// ─────────────────────────────────────────────────
// ⭐ AVIS ET RÉPUTATION
// ─────────────────────────────────────────────────

// Récupérer les avis d'un vendeur
export const getAvisVendeur = async (vendeurId) => {
  const { data, error } = await supabase
    .from('avis')
    .select(`*, utilisateurs!auteur_id (nom, photo_url)`)
    .eq('vendeur_id', vendeurId)
    .order('date_creation', { ascending: false })
  return { data: data || [], error }
}

// Laisser un avis
export const laisserAvis = async ({ vendeurId, auteurId, annonceId, note, commentaire }) => {
  const { data, error } = await supabase
    .from('avis')
    .insert([{
      vendeur_id: vendeurId,
      auteur_id: auteurId,
      annonce_id: annonceId,
      note,
      commentaire,
    }])
    .select()
    .single()

  if (error?.code === '23505') return { data: null, error: "Vous avez déjà noté ce vendeur pour cette annonce." }
  return { data, error }
}

// ─────────────────────────────────────────────────
// 📔 JOURNAL DE BORD
// ─────────────────────────────────────────────────

// Récupérer le journal d'un utilisateur
export const getJournal = async (utilisateurId, saison = null) => {
  let query = supabase
    .from('journal')
    .select('*')
    .eq('utilisateur_id', utilisateurId)
    .order('date_entree', { ascending: false })

  if (saison) query = query.eq('saison', saison)

  const { data, error } = await query
  return { data: data || [], error }
}

// Ajouter une entrée journal
export const ajouterEntreeJournal = async ({ utilisateurId, type, categorie, montant, description, date }) => {
  const { data, error } = await supabase
    .from('journal')
    .insert([{
      utilisateur_id: utilisateurId,
      type,
      categorie,
      montant,
      description,
      date_entree: date || new Date().toISOString().split('T')[0],
      saison: new Date().getFullYear().toString(),
    }])
    .select()
    .single()
  return { data, error }
}

// Supprimer une entrée journal
export const supprimerEntreeJournal = async (entreeId, utilisateurId) => {
  const { error } = await supabase
    .from('journal')
    .delete()
    .eq('id', entreeId)
    .eq('utilisateur_id', utilisateurId)
  return { error }
}

// ─────────────────────────────────────────────────
// 👥 COMMUNAUTÉ — POSTS
// ─────────────────────────────────────────────────

// Récupérer les posts
export const getPosts = async (categorie = null, ville = null) => {
  let query = supabase
    .from('posts')
    .select(`
      *,
      images,
      utilisateurs (id, nom, photo_url, ville, verifie)
    `)
    .eq('actif', true)
    .order('date_creation', { ascending: false })
    .limit(50)

  if (categorie) query = query.eq('categorie', categorie)
  if (ville) query = query.eq('ville', ville)

  const { data, error } = await query
  return { data: data || [], error }
}

// Publier un post
export const publierPost = async ({ auteurId, categorie, texte, ville, images = [] }) => {
  const { data, error } = await supabase
    .from('posts')
    .insert([{
      auteur_id: auteurId,
      categorie,
      texte: texte.slice(0, 1000),
      ville,
      images: images || [],
      images: images || [],
    }])
    .select()
    .single()
  return { data, error }
}

// Liker un post
export const likerPost = async (postId, utilisateurId) => {
  // Vérifier si déjà liké
  const { data: existant } = await supabase
    .from('likes_posts')
    .select('*')
    .eq('post_id', postId)
    .eq('utilisateur_id', utilisateurId)
    .single()

  if (existant) {
    // Unlike
    await supabase.from('likes_posts').delete()
      .eq('post_id', postId).eq('utilisateur_id', utilisateurId)
    await supabase.from('posts').update({ likes: supabase.rpc('decrement', { x: 1 }) }).eq('id', postId)
    return { liked: false }
  } else {
    // Like
    await supabase.from('likes_posts').insert([{ post_id: postId, utilisateur_id: utilisateurId }])
    await supabase.from('posts').update({ likes: supabase.rpc('increment', { x: 1 }) }).eq('id', postId)
    return { liked: true }
  }
}

// ─────────────────────────────────────────────────
// 🤝 GROUPEMENTS D'ACHAT
// ─────────────────────────────────────────────────

// Récupérer les groupements actifs
export const getGroupements = async (ville = null) => {
  let query = supabase
    .from('groupements')
    .select(`
      *,
      utilisateurs (nom, photo_url),
      groupements_participants (utilisateur_id)
    `)
    .eq('actif', true)
    .order('date_creation', { ascending: false })

  if (ville) query = query.eq('ville', ville)

  const { data, error } = await query
  return { data: data || [], error }
}

// Créer un groupement
export const creerGroupement = async ({ initiateurId, produit, quantiteCible, unite, prixEstime, economiePct, description, ville, dateExpiration }) => {
  const { data, error } = await supabase
    .from('groupements')
    .insert([{
      initiateur_id: initiateurId,
      produit,
      quantite_cible: quantiteCible,
      unite,
      prix_estime: prixEstime,
      economie_pct: economiePct,
      description,
      ville,
      date_expiration: dateExpiration,
    }])
    .select()
    .single()
  return { data, error }
}

// Rejoindre un groupement
export const rejoindreGroupement = async (groupementId, utilisateurId, quantite = 1) => {
  const { data, error } = await supabase
    .from('groupements_participants')
    .insert([{ groupement_id: groupementId, utilisateur_id: utilisateurId, quantite }])
    .select()
    .single()

  if (error?.code === '23505') return { data: null, error: "Vous participez déjà à ce groupement." }
  return { data, error }
}

// ─────────────────────────────────────────────────
// 🚨 ALERTES
// ─────────────────────────────────────────────────

// Récupérer les alertes
export const getAlertes = async () => {
  const { data, error } = await supabase
    .from('alertes')
    .select(`*, utilisateurs (nom, ville)`)
    .order('date_creation', { ascending: false })
    .limit(20)
  return { data: data || [], error }
}

// Publier une alerte
export const publierAlerte = async ({ auteurId, type, message, province, severite }) => {
  const { data, error } = await supabase
    .from('alertes')
    .insert([{ auteur_id: auteurId, type, message, province, severite }])
    .select()
    .single()
  return { data, error }
}

// ─────────────────────────────────────────────────
// 📶 OFFLINE SYNC
// Quand pas de réseau → on sauvegarde localement
// Au retour du réseau → on synchronise
// ─────────────────────────────────────────────────

// Vérifier si connecté à internet
export const estEnLigne = () => navigator.onLine

// Sauvegarder action offline dans IndexedDB
export const sauvegarderOffline = (action, tableCible, donnees) => {
  const queue = JSON.parse(localStorage.getItem('agrisahel_sync_queue') || '[]')
  queue.push({
    id: crypto.randomUUID(),
    action,
    table_cible: tableCible,
    donnees,
    date_creation: new Date().toISOString(),
    synced: false,
  })
  localStorage.setItem('agrisahel_sync_queue', JSON.stringify(queue))
}

// Synchroniser quand réseau revient
export const synchroniserOffline = async (utilisateurId) => {
  const queue = JSON.parse(localStorage.getItem('agrisahel_sync_queue') || '[]')
  const nonSynced = queue.filter(item => !item.synced)

  if (nonSynced.length === 0) return { synced: 0 }

  let syncCount = 0
  const updatedQueue = [...queue]

  for (const item of nonSynced) {
    try {
      if (item.table_cible === 'journal') {
        await ajouterEntreeJournal({ utilisateurId, ...item.donnees })
      } else if (item.table_cible === 'posts') {
        await publierPost({ auteurId: utilisateurId, ...item.donnees })
      } else if (item.table_cible === 'annonces') {
        await publierAnnonce({ vendeurId: utilisateurId, ...item.donnees })
      }
      // Marquer comme synchronisé
      const idx = updatedQueue.findIndex(q => q.id === item.id)
      if (idx !== -1) updatedQueue[idx].synced = true
      syncCount++
    } catch (err) {
      console.error('Sync error:', err)
    }
  }

  localStorage.setItem('agrisahel_sync_queue', JSON.stringify(updatedQueue))
  return { synced: syncCount }
}

// Écouter retour réseau et sync automatique
export const initialiserSyncAuto = (utilisateurId, onSyncComplete) => {
  window.addEventListener('online', async () => {
    const result = await synchroniserOffline(utilisateurId)
    if (result.synced > 0 && onSyncComplete) {
      onSyncComplete(result.synced)
    }
  })
}