import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  _Connection,
} from 'vscode-languageserver/node'
import { getFunctionName, getRange, nodesGen } from './utils'
import { Tree } from 'web-tree-sitter'
import { SymbolsByUri } from './interfaces'
import { DependencyMap } from './dependencies'

function isSameRange(range1: Range, range2: Range): boolean {
  return (
    range1.start.line === range2.start.line &&
    range1.start.character === range2.start.character &&
    range1.end.line === range2.end.line &&
    range1.end.character === range2.end.character
  )
}

export function validate(
  tree: Tree,
  symbols: SymbolsByUri,
  dependencies: DependencyMap,
  uri: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []

  for (const node of nodesGen(tree.rootNode)) {
    if (node.type === 'ERROR') {
      diagnostics.push(
        Diagnostic.create(getRange(node), 'Syntax error', DiagnosticSeverity.Error),
      )
      continue
    }

    if (node.isMissing()) {
      diagnostics.push(
        Diagnostic.create(
          getRange(node),
          `Syntax error: missing ${node.type}`,
          DiagnosticSeverity.Warning,
        ),
      )
      continue
    }

    if (node.type === 'func_def') {
      const name = getFunctionName(node)
      const range = getRange(node)
      const linkedUris = dependencies.getLinkedUris(uri)

      const existingDefinition = [...linkedUris]
        .map((u) => symbols[u])
        .find((sm) => sm.has(name))
        ?.get(name)![0]!

      const { uri: eduri, range: edrange } = existingDefinition.location

      if (uri !== eduri || !isSameRange(range, edrange)) {
        diagnostics.push(
          Diagnostic.create(
            range,
            `Function name must be unique`,
            DiagnosticSeverity.Error,
          ),
        )
      }
    }
  }

  return diagnostics
}
