import {
  MessageConnection,
  SymbolInformation,
  SymbolKind,
  Range,
  Position,
  CompletionRequest,
  TextDocumentPositionParams,
  CompletionItem,
  CompletionItemKind,
} from 'vscode-languageserver-protocol'
import { getConnections, getRange } from '../helpers'
import { SymbolsByUri, SymbolsMap } from '../../src/interfaces'
import { getCompletionHandler } from '../../src/handlers/handleCompletion'
import { DependencyMap } from '../../src/dependencies'
import { initCompletionList } from '../../src/completion'
import { getDocumentation } from '../../src/documentation'

describe('handleCompletion', () => {
  let server: MessageConnection
  let client: MessageConnection
  let uri: string
  let symbols: SymbolsByUri
  let dependencies: DependencyMap

  beforeAll(() => {
    const connections = getConnections()

    server = connections.server
    client = connections.client
    uri = 'file:///my_file.awk'
    dependencies = new DependencyMap()
    dependencies.update(uri, new Set())

    const symbolsMap: SymbolsMap = new Map()
    const symbolInfo = SymbolInformation.create(
      'myFunc',
      SymbolKind.Function,
      Range.create(Position.create(0, 0), Position.create(3, 1)),
    )

    symbolsMap.set('myFunc', [symbolInfo])

    symbols = { [uri]: symbolsMap }
  })

  it('should provide completions from current document', async () => {
    // Arrange
    const sentParams: TextDocumentPositionParams = {
      textDocument: { uri },
      position: Position.create(0, 0),
    }

    server.onRequest(CompletionRequest.type, getCompletionHandler(symbols, dependencies))

    // Act
    const result = (await client.sendRequest(
      CompletionRequest.type,
      sentParams,
    )) as CompletionItem[]

    // Assert
    const item = CompletionItem.create('myFunc')
    item.kind = CompletionItemKind.Function
    expect(
      result.find((i) => i.kind === item.kind && i.label === item.label),
    ).toMatchObject(item)
  })

  it('should provide completions from included document', async () => {
    // Arrange
    const includedUri = 'file:///somelib.awk'
    dependencies.update(uri, new Set([includedUri]))

    symbols[includedUri] = new Map()
    symbols[includedUri].set('new_func', [
      SymbolInformation.create('new_func', SymbolKind.Function, getRange(0, 0, 1, 1)),
    ])

    const sentParams: TextDocumentPositionParams = {
      textDocument: { uri },
      position: Position.create(0, 0),
    }

    server.onRequest(CompletionRequest.type, getCompletionHandler(symbols, dependencies))

    // Act
    const result = (await client.sendRequest(
      CompletionRequest.type,
      sentParams,
    )) as CompletionItem[]

    // Assert
    const item = CompletionItem.create('new_func')
    item.kind = CompletionItemKind.Function
    expect(
      result.find((i) => i.kind === item.kind && i.label === item.label),
    ).toMatchObject(item)
  })

  it('should provide completions for builtins', async () => {
    // Arrange
    initCompletionList(getDocumentation())

    const sentParams: TextDocumentPositionParams = {
      textDocument: { uri },
      position: Position.create(0, 0),
    }

    server.onRequest(CompletionRequest.type, getCompletionHandler(symbols, dependencies))

    // Act
    const result = (await client.sendRequest(
      CompletionRequest.type,
      sentParams,
    )) as CompletionItem[]

    // Assert
    expect(
      result.find((i) => i.label === 'tolower' && i.kind === CompletionItemKind.Function),
    ).toBeTruthy()
  })
})