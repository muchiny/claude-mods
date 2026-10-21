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
// groupe du Claude courant sur SIGINT, SIGTERM, SIGHUP et exception non rattrapée.
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Crée un HOME jetable sous `base`. `credentials` : chemin du fichier d'identifiants à copier, ou null.
 * Sur erreur, rien ne reste sous `base` et l'erreur remonte.
 */
export function createHome({ base, repo, fakeBridge, key = '', credentials = null }) {
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
    mkdirSync(join(home, 'bin'))
    symlinkSync(fakeBridge, join(home, 'bin', 'bridge-mcp'))
    return home
  } catch (e) {
    removeHome(home)
    throw e
  }
}

export function removeHome(home) {
  if (home) rmSync(home, { recursive: true, force: true })
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
 * `current` : { home, pid } tenu à jour par l'appelant. Sur signal ou exception non rattrapée : tue le
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
