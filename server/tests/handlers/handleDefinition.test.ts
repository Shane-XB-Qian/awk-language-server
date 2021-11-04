import {
  MessageConnection,
  SymbolInformation,
  SymbolKind,
  DefinitionParams,
  Position,
  DefinitionRequest,
  Location,
} from 'vscode-languageserver-protocol'
import { getConnections, getRange } from '../helpers'
import { SymbolsByUri, TreesByUri } from '../../src/interfaces'
import { getDefinitionHandler } from '../../src/handlers/handleDefinition'
import { initializeParser } from '../../src/parser'
import { DependencyMap } from '../../src/dependencies'
import * as Parser from 'web-tree-sitter'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('handleDefinition', () => {
  let server: MessageConnection
  let client: MessageConnection
  let parser: Parser
  const trees: TreesByUri = {}
  const symbols: SymbolsByUri = {}
  const dependencies = new DependencyMap()
  let uriA: string
  let uriB: string
  let uriC: string

  beforeAll(async () => {
    parser = await initializeParser()
    const connections = getConnections()

    server = connections.server
    client = connections.client

    const contentA = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'definition_a.awk'),
      'utf8',
    )
    const contentB = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'definition_b.awk'),
      'utf8',
    )
    const contentC = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'definition_c.awk'),
      'utf8',
    )
    uriA = 'file:///a.awk'
    uriB = 'file:///b.awk'
    uriC = 'file:///c.awk'

    trees[uriA] = parser.parse(contentA)
    trees[uriB] = parser.parse(contentB)
    trees[uriC] = parser.parse(contentC)

    dependencies.update(uriA, new Set([uriB, uriC]))

    symbols[uriA] = new Map()
    symbols[uriB] = new Map()
    symbols[uriC] = new Map()

    symbols[uriA].set('f', [
      SymbolInformation.create('f', SymbolKind.Function, getRange(3, 0, 3, 16), uriA),
    ])
    symbols[uriA].set('a', [
      SymbolInformation.create('a', SymbolKind.Function, getRange(7, 0, 9, 1), uriA),
    ])
    symbols[uriA].set('x', [
      SymbolInformation.create(
        'x',
        SymbolKind.Function,
        getRange(7, 11, 7, 12),
        uriA,
        'a',
      ),
    ])
    symbols[uriB].set('sum', [
      SymbolInformation.create('sum', SymbolKind.Function, getRange(0, 0, 0, 21), uriB),
    ])
  })

  it('should provide locations for same file symbols', async () => {
    // Arrange
    const sentParams: DefinitionParams = {
      textDocument: { uri: uriA },
      position: Position.create(5, 2),
    }

    server.onRequest(
      DefinitionRequest.type,
      getDefinitionHandler(trees, symbols, dependencies),
    )

    // Act
    const result = await client.sendRequest(DefinitionRequest.type, sentParams)

    // Assert
    expect(result).toEqual([Location.create(uriA, getRange(3, 0, 3, 16))])
  })

  it('should provide locations for included symbols', async () => {
    // Arrange
    const sentParams: DefinitionParams = {
      textDocument: { uri: uriA },
      position: Position.create(5, 8),
    }

    server.onRequest(
      DefinitionRequest.type,
      getDefinitionHandler(trees, symbols, dependencies),
    )

    // Act
    const result = await client.sendRequest(DefinitionRequest.type, sentParams)

    // Assert
    expect(result).toEqual([Location.create(uriB, getRange(0, 0, 0, 21))])
  })

  it('should handle function parameters', async () => {
    // Arrange
    const sentParams: DefinitionParams = {
      textDocument: { uri: uriA },
      position: Position.create(8, 4),
    }

    server.onRequest(
      DefinitionRequest.type,
      getDefinitionHandler(trees, symbols, dependencies),
    )

    // Act
    const result = await client.sendRequest(DefinitionRequest.type, sentParams)

    // Assert
    expect(result).toEqual([Location.create(uriA, getRange(7, 11, 7, 12))])
  })

  it('should handle definitions from documents included somewhere above on parent chain', async () => {
    // Arrange
    const sentParams: DefinitionParams = {
      textDocument: { uri: uriC },
      position: Position.create(0, 8),
    }

    server.onRequest(
      DefinitionRequest.type,
      getDefinitionHandler(trees, symbols, dependencies),
    )

    // Act
    const result = await client.sendRequest(DefinitionRequest.type, sentParams)

    // Assert
    expect(result).toEqual([Location.create(uriB, getRange(0, 0, 0, 21))])
  })
})
