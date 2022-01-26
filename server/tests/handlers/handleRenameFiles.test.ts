import { URL } from 'url'
import { MessageConnection, WorkspaceEdit } from 'vscode-languageserver-protocol'
import * as Parser from 'web-tree-sitter'
import { DependencyMap } from '../../src/dependencies'
import { Context, SymbolsByUri, SymbolsMap, TreesByUri } from '../../src/interfaces'
import * as io from '../../src/io'
import { initializeParser } from '../../src/parser'
import { getConnections, getDummyContext, getRange } from '../helpers'
import {
  adaptFolderRenames,
  getRenameFilesHandler,
} from '../../src/handlers/handleRenameFiles'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Tree } from 'web-tree-sitter'

describe('handleRenameFiles', () => {
  let server: MessageConnection
  let client: MessageConnection
  let context: Context
  let parser: Parser
  let trees: TreesByUri = {}
  let symbols: SymbolsByUri = {}

  const dependencies = new DependencyMap()
  const uriA = 'file:///a.awk'
  const uriB = 'file:///b.awk'
  const uriC = 'file:///c.awk'
  const uriD = 'file:///d.awk'
  let treeC: Tree

  beforeAll(async () => {
    jest.spyOn(io, 'isDir').mockImplementation((uri: string) => uri.endsWith('/'))

    parser = await initializeParser()

    const connections = getConnections()

    server = connections.server
    client = connections.client

    const contentA = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'rename_file.awk'),
      'utf8',
    )

    treeC = parser.parse(contentA)
  })

  afterAll(() => {
    jest.restoreAllMocks()
  })

  beforeEach(() => {
    trees = {}
    symbols = {}

    trees[uriA] = {} as Parser.Tree
    trees[uriC] = treeC
    trees[uriD] = {} as Parser.Tree

    symbols[uriA] = {} as SymbolsMap
    symbols[uriC] = {} as SymbolsMap
    symbols[uriD] = {} as SymbolsMap

    dependencies.update(uriA, new Set([uriD]))
    dependencies.update(uriC, new Set([uriA]))

    context = getDummyContext(server, parser)
  })

  it('should rename trees', async () => {
    // Arrange
    const handleRenameFiles = getRenameFilesHandler(context, trees, symbols, dependencies)

    const didRenameNotification = new Promise<void>((resolve) => {
      server.onNotification('workspace/didRenameFiles', (params) => {
        resolve()
        handleRenameFiles(params)
      })
    })

    const oldTree = trees[uriA]

    // Act
    client.sendNotification('workspace/didRenameFiles', {
      files: [
        {
          oldUri: uriA,
          newUri: uriB,
        },
      ],
    })

    await didRenameNotification

    // Assert
    expect(trees[uriB]).toEqual(oldTree)
    expect(trees[uriA]).toBeUndefined()
  })

  it('should rename symbols', async () => {
    // Arrange
    const handleRenameFiles = getRenameFilesHandler(context, trees, symbols, dependencies)

    const didRenameNotification = new Promise<void>((resolve) => {
      server.onNotification('workspace/didRenameFiles', (params) => {
        resolve()
        handleRenameFiles(params)
      })
    })

    const oldSymbols = symbols[uriA]

    // Act
    client.sendNotification('workspace/didRenameFiles', {
      files: [
        {
          oldUri: uriA,
          newUri: uriB,
        },
      ],
    })

    await didRenameNotification

    // Assert
    expect(symbols[uriB]).toEqual(oldSymbols)
    expect(symbols[uriA]).toBeUndefined()
  })

  it('should update dependencies', async () => {
    // Arrange
    const handleRenameFiles = getRenameFilesHandler(context, trees, symbols, dependencies)

    const didRenameNotification = new Promise<void>((resolve) => {
      server.onNotification('workspace/didRenameFiles', (params) => {
        resolve()
        handleRenameFiles(params)
      })
    })

    // Act
    client.sendNotification('workspace/didRenameFiles', {
      files: [
        {
          oldUri: uriA,
          newUri: uriB,
        },
      ],
    })

    await didRenameNotification

    // Assert
    expect(dependencies.get(uriB)).toEqual({
      parentUris: new Set([uriC]),
      childrenUris: new Set([uriD]),
    })

    expect(dependencies.get(uriC)).toEqual({
      parentUris: new Set(),
      childrenUris: new Set([uriB]),
    })

    expect(dependencies.get(uriD)).toEqual({
      parentUris: new Set([uriB]),
      childrenUris: new Set(),
    })
  })

  it('should apply @include edits', async () => {
    // Arrange
    const workspace = {
      applyEdit: jest.fn(),
    }

    const context = getDummyContext(server, parser, { workspace })
    const handleRenameFiles = getRenameFilesHandler(context, trees, symbols, dependencies)

    const didRenameNotification = new Promise<void>((resolve) => {
      server.onNotification('workspace/didRenameFiles', (params) => {
        resolve()
        handleRenameFiles(params)
      })
    })

    // Act
    client.sendNotification('workspace/didRenameFiles', {
      files: [
        {
          oldUri: uriA,
          newUri: uriB,
        },
      ],
    })

    await didRenameNotification

    // Assert
    expect(workspace.applyEdit).toHaveBeenLastCalledWith({
      changes: {
        [uriC]: [{ range: getRange(0, 0, 0, 12), newText: '@include "b"' }],
      },
    })
  })
})

describe('adaptFolderRenames', () => {
  const uriA = 'file:///a.awk'
  const uriOldFolder = 'file:///old_folder/'
  const uriNewFolder = 'file:///new_folder/'
  const uriOldF1 = uriOldFolder + 'f1.awk'
  const uriNewF1 = uriNewFolder + 'f1.awk'
  const uriB = 'file:///b.awk'

  beforeAll(() => {
    jest.spyOn(io, 'isDir').mockImplementation((uri: string) => uri.endsWith('/'))
    jest
      .spyOn(io, 'getAwkFilesInDir')
      .mockImplementation((uri: string) =>
        [uri.includes('new') ? uriNewF1 : uriOldF1].map((f) => new URL(f)),
      )
  })

  it('should replace folder edits with corresponding file edits', () => {
    // Arrange
    // Act
    const result = adaptFolderRenames([{ oldUri: uriOldFolder, newUri: uriNewFolder }])
    // Assert
    expect(result).toEqual([{ oldUri: uriOldF1, newUri: uriNewF1 }])
  })

  it('should not affect file edits', () => {
    // Arrange
    // Act
    const result = adaptFolderRenames([{ oldUri: uriA, newUri: uriB }])
    // Assert
    expect(result).toEqual([{ oldUri: uriA, newUri: uriB }])
  })
})
