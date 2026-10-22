// Sous `bun test`, 'claude-code/testing' (fourni par `claude plugin test`) est remplacé par bun:test,
// de même API pour describe, test et expect. Sert à mesurer la couverture des modules purs.
import { describe, expect, mock, test } from 'bun:test'

mock.module('claude-code/testing', () => ({ describe, expect, test }))
