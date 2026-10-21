// HOME jetable de la peinture et son nettoyage garanti (drive.ts ; testé par tests/dev/paint-home.test.ts).
//
// Le HOME ne contient qu'un .claude.json minimal (accueil passé, dossier du dépôt approuvé), le faux
// bridge-mcp et, sur consentement explicite seulement (PAINT_USE_REAL_HOME=1), une copie du fichier
// d'identifiants de l'utilisateur.
//
// AVERTISSEMENT (PAINT_USE_REAL_HOME=1) : la session lancée dans le HOME jetable peut rafraîchir le jeton
// OAuth ; le serveur peut alors faire tourner le jeton de rafraîchissement, et la copie effacée emporte le
// nouveau : la connexion réelle de l'utilisateur peut devenir invalide (il faudra /login). Opt-in seulement,
// jamais en CI.
//
// Nettoyage : le dossier est créé d'abord, tout le reste (copie comprise) dans un try qui l'efface en cas
// d'erreur ; l'appelant l'efface dans un finally ; installCleanup() efface aussi le HOME courant et tue le
// groupe du Claude courant sur SIGINT, SIGTERM, SIGHUP et exception non rattrapée. Un HOME laissé par une
// exécution tuée sans nettoyage (SIGKILL, coupure) est balayé au démarrage suivant (sweepHomes).
// Modes : HOME et ses dossiers en 700, fichiers en 600.
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** Âge au-delà duquel un paint-home-* est périmé : une exécution entière dure bien moins. */
export const STALE_MS = 30 * 60 * 1000

/** Vrai pour un dossier réel (pas un lien) à soi, fermé au groupe et aux autres (700). */
function privateDir(path) {
  try {
    const st = lstatSync(path)
    return st.isDirectory() && st.uid === process.getuid() && (st.mode & 0o077) === 0
  } catch {
    return false
  }
}

/**
 * Dossier où naissent les HOME jetables : $RUNNER_TEMP en CI, /var/tmp en local (jamais /tmp). Avec
 * PAINT_USE_REAL_HOME=1 (copie des identifiants), $XDG_RUNTIME_DIR s'il est un dossier à soi en 700 :
 * propre à l'utilisateur, effacé à la fin de sa session.
 */
export function homeBase() {
  const xdg = process.env.XDG_RUNTIME_DIR
  if (process.env.PAINT_USE_REAL_HOME === '1' && xdg && privateDir(xdg)) return xdg
  return process.env.RUNNER_TEMP || '/var/tmp'
}

/**
 * Efface sous `base` les paint-home-* périmés (dossiers réels à soi, modifiés il y a plus de STALE_MS), par
 * removeHome seulement. Rend le nombre de dossiers effacés.
 */
export function sweepHomes(base = homeBase(), now = Date.now()) {
  let names
  try {
    names = readdirSync(base)
  } catch {
    return 0
  }
  let n = 0
  for (const name of names) {
    if (!name.startsWith('paint-home-')) continue
    const path = join(base, name)
    let st
    try {
      st = lstatSync(path)
    } catch {
      continue
    }
    if (!st.isDirectory() || st.uid !== process.getuid() || now - st.mtimeMs < STALE_MS) continue
    if (removeHome(path, base)) n += 1
  }
  return n
}

/**
 * Crée un HOME jetable sous `base`. `credentials` : chemin du fichier d'identifiants à copier, ou null.
 * Sur erreur, rien ne reste sous `base` et l'erreur remonte.
 */
export function createHome({ base = homeBase(), repo, fakeBridge, key = '', credentials = null }) {
  const home = mkdtempSync(join(base, 'paint-home-'))
  try {
    const cfg = {
      hasCompletedOnboarding: true,
      theme: 'dark',
      projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } },
    }
    // Clé fournie par le secret de CI : la session la demande sinon (« Detected a custom API key »).
    if (key !== '') cfg.customApiKeyResponses = { approved: [key.slice(-20)], rejected: [] }
    writeFileSync(join(home, '.claude.json'), JSON.stringify(cfg), { mode: 0o600 })
    mkdirSync(join(home, '.claude'), { mode: 0o700 })
    if (credentials !== null) {
      const dst = join(home, '.claude', '.credentials.json')
      copyFileSync(credentials, dst)
      chmodSync(dst, 0o600)
    }
    // Le faux bridge-mcp, en tête de PATH pour les scénarios avec modèle.
    mkdirSync(join(home, 'bin'), { mode: 0o700 })
    symlinkSync(fakeBridge, join(home, 'bin', 'bridge-mcp'))
    return home
  } catch (e) {
    removeHome(home, base)
    throw e
  }
}

/**
 * Efface un HOME jetable, et rien d'autre : un dossier réel (pas un lien) nommé paint-home-* placé
 * directement sous `base`. Tout autre chemin est refusé (message sur stderr, rien d'effacé). Rend true si
 * le dossier a été effacé ou n'existait plus.
 */
export function removeHome(home, base = homeBase()) {
  if (!home) return true
  const path = resolve(home)
  let st = null
  try {
    st = lstatSync(path)
  } catch {
    return true
  }
  const ours = dirname(path) === resolve(base) && basename(path).startsWith('paint-home-') && st.isDirectory()
  if (!ours) {
    console.error(`removeHome : chemin refusé (pas un paint-home-* sous ${resolve(base)}) : ${path}`)
    return false
  }
  rmSync(path, { recursive: true, force: true })
  return true
}

export function killGroup(pid) {
  if (!pid) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // groupe déjà parti
  }
}

/**
 * `current` : { home, pid } tenu à jour par l'appelant (HOME né sous homeBase()). Sur signal ou exception non rattrapée : tue le
 * groupe du Claude courant, efface le HOME courant, puis sort (128 + numéro du signal, 1 sur exception).
 */
export function installCleanup(current) {
  const clean = () => {
    killGroup(current.pid)
    removeHome(current.home)
    current.pid = null
    current.home = null
  }
  const codes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }
  for (const [sig, code] of Object.entries(codes)) {
    process.on(sig, () => {
      clean()
      process.exit(code)
    })
  }
  process.on('uncaughtException', (e) => {
    clean()
    console.error(e)
    process.exit(1)
  })
  process.on('unhandledRejection', (e) => {
    clean()
    console.error(e)
    process.exit(1)
  })
  process.on('exit', clean)
  return clean
}
