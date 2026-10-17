import { describe, expect, test } from 'claude-code/testing'

import { fr } from '../../hooks/fr'

const NBSP = '\u00A0'

describe('fr : typographie du texte propre au mod (spec §4.1, critère 14)', () => {
  test('espace insécable avant : ; ? ! quand une espace les précède', () => {
    expect(fr('à toi : réponds')).toBe(`à toi${NBSP}: réponds`)
    expect(fr('un ; deux')).toBe(`un${NBSP}; deux`)
    expect(fr('code ?')).toBe(`code${NBSP}?`)
    expect(fr('attention !')).toBe(`attention${NBSP}!`)
  })

  test('sans espace devant, la ponctuation reste telle quelle', () => {
    expect(fr('voir /clair:12')).toBe('voir /clair:12')
    expect(fr('a;b?c!')).toBe('a;b?c!')
  })

  test('guillemets : insécable après « et avant », espace ordinaire ou absente', () => {
    expect(fr('plan « X »')).toBe(`plan «${NBSP}X${NBSP}»`)
    expect(fr('«X»')).toBe(`«${NBSP}X${NBSP}»`)
  })

  test('apostrophe typographique seulement entre deux lettres', () => {
    expect(fr("rien n'a tourné")).toBe('rien n\u2019a tourné')
    expect(fr("erreur d'usage")).toBe('erreur d\u2019usage')
    expect(fr("l'été")).toBe('l\u2019été')
    expect(fr("'x'")).toBe("'x'")
    expect(fr("3'4")).toBe("3'4")
  })

  test('idempotente : une seconde passe ne change rien', () => {
    const once = fr("à toi : réponds ; « n'importe » ?")
    expect(once).toBe(`à toi${NBSP}: réponds${NBSP}; «${NBSP}n\u2019importe${NBSP}»${NBSP}?`)
    expect(fr(once)).toBe(once)
  })

  test('un texte sans motif revient identique', () => {
    expect(fr('ssh_disk_usage · lecture')).toBe('ssh_disk_usage · lecture')
    expect(fr('')).toBe('')
  })
})
