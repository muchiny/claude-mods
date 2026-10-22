import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { checkReleaseVersion } from '../../dev/check-release-version.mjs'

const plugin = (version: unknown) => JSON.stringify({ name: 'mode-clair', version })

describe('checkReleaseVersion', () => {
  test('tag vX.Y.Z égal à la version du plugin : aucune erreur', () => {
    expect(checkReleaseVersion(plugin('0.2.0'), 'v0.2.0')).toEqual([])
  })

  test('version différente du tag : erreur qui cite les deux', () => {
    const errors = checkReleaseVersion(plugin('0.2.0'), 'v0.3.0')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('0.2.0')
    expect(errors[0]).toContain('0.3.0')
  })

  test('tag sans le préfixe v : refusé', () => {
    const errors = checkReleaseVersion(plugin('0.2.0'), '0.2.0')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('v')
  })

  test('tag vide ou absent : refusé', () => {
    expect(checkReleaseVersion(plugin('0.2.0'), '')).toHaveLength(1)
    expect(checkReleaseVersion(plugin('0.2.0'), undefined)).toHaveLength(1)
  })

  test('seul le premier v est retiré', () => {
    expect(checkReleaseVersion(plugin('v1.0.0'), 'vv1.0.0')).toEqual([])
    expect(checkReleaseVersion(plugin('1.0.0'), 'vv1.0.0')).toHaveLength(1)
  })

  test('version absente ou non texte : erreur', () => {
    expect(checkReleaseVersion(JSON.stringify({ name: 'x' }), 'v1.0.0')).toHaveLength(1)
    expect(checkReleaseVersion(plugin(1), 'v1')).toHaveLength(1)
  })

  test('JSON illisible : erreur, pas une exception', () => {
    expect(checkReleaseVersion('{pas du json', 'v1.0.0')).toHaveLength(1)
  })
})
