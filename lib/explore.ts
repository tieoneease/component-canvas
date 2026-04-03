import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { svelte2tsx } from 'svelte2tsx';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const SVELTE_SHIMS_PATH = require.resolve('svelte2tsx/svelte-shims-v4.d.ts');
const TYPE_FORMAT_FLAGS =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.MultilineObjectLiterals;

export interface PropInfo {
  name: string;
  type: string;
  required: boolean;
  category: 'prop' | 'event' | 'snippet';
  default?: string;
}

export interface ComponentAPI {
  props: PropInfo[];
  events: PropInfo[];
  snippets: PropInfo[];
}

export async function extractComponentAPI(filePath: string): Promise<ComponentAPI> {
  const resolvedFilePath = resolve(filePath);
  const source = await readFile(resolvedFilePath, 'utf8');
  const generatedFilePath = `${resolvedFilePath}.tsx`;
  const generated = svelte2tsx(source, { filename: resolvedFilePath }).code;
  const defaults = collectDefaultValues(generatedFilePath, generated);
  const { checker, sourceFile } = createTypeProgram(generatedFilePath, generated);
  const renderFunction = findRenderFunction(sourceFile);

  if (!renderFunction) {
    throw new Error(`Unable to locate $$render() while exploring ${resolvedFilePath}.`);
  }

  const renderSignature = checker.getSignatureFromDeclaration(renderFunction);

  if (!renderSignature) {
    throw new Error(`Unable to inspect the render signature for ${resolvedFilePath}.`);
  }

  const renderReturnType = checker.getReturnTypeOfSignature(renderSignature);
  const propsSymbol = renderReturnType.getProperty('props');

  if (!propsSymbol) {
    return {
      props: [],
      events: [],
      snippets: []
    };
  }

  const propsType = checker.getTypeOfSymbolAtLocation(propsSymbol, renderFunction);
  const members = checker.getPropertiesOfType(propsType).map((member) =>
    toPropInfo(member, checker, renderFunction, defaults)
  );

  return {
    props: members.filter((member) => member.category === 'prop'),
    events: members.filter((member) => member.category === 'event'),
    snippets: members.filter((member) => member.category === 'snippet')
  };
}

function createTypeProgram(
  filePath: string,
  source: string
): { checker: ts.TypeChecker; sourceFile: ts.SourceFile } {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowJs: true,
    checkJs: true,
    strict: true,
    jsx: ts.JsxEmit.Preserve,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    noEmit: true,
    skipLibCheck: true
  };
  const defaultHost = ts.createCompilerHost(options, true);
  const virtualFiles = new Map([[filePath, source]]);
  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      if (virtualFiles.has(fileName)) {
        return ts.createSourceFile(
          fileName,
          virtualFiles.get(fileName) ?? '',
          languageVersion,
          true,
          ts.ScriptKind.TSX
        );
      }

      return defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
    readFile(fileName) {
      if (virtualFiles.has(fileName)) {
        return virtualFiles.get(fileName);
      }

      return defaultHost.readFile(fileName);
    },
    fileExists(fileName) {
      if (virtualFiles.has(fileName)) {
        return true;
      }

      return defaultHost.fileExists(fileName);
    }
  };
  const program = ts.createProgram([filePath, SVELTE_SHIMS_PATH], options, host);
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) {
    throw new Error(`Unable to create a TypeScript source file for ${filePath}.`);
  }

  return {
    checker: program.getTypeChecker(),
    sourceFile
  };
}

function findRenderFunction(sourceFile: ts.SourceFile): ts.FunctionDeclaration | null {
  let renderFunction: ts.FunctionDeclaration | null = null;

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === '$$render') {
      renderFunction = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return renderFunction;
}

function collectDefaultValues(filePath: string, source: string): Map<string, string> {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const defaults = new Map<string, string>();

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && isPropsCall(node.initializer)) {
      for (const element of node.name.elements) {
        if (element.dotDotDotToken || !element.initializer) {
          continue;
        }

        const propName = getBindingElementName(element);

        if (propName) {
          defaults.set(propName, element.initializer.getText(sourceFile));
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return defaults;
}

function isPropsCall(node: ts.Expression | undefined): node is ts.CallExpression {
  return (
    node !== undefined &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === '$props'
  );
}

function getBindingElementName(element: ts.BindingElement): string | null {
  const propNode = element.propertyName ?? element.name;

  if (ts.isIdentifier(propNode) || ts.isStringLiteralLike(propNode) || ts.isNumericLiteral(propNode)) {
    return propNode.text;
  }

  return null;
}

function toPropInfo(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  location: ts.Node,
  defaults: Map<string, string>
): PropInfo {
  const type = checker.getTypeOfSymbolAtLocation(symbol, location);
  const defaultValue = defaults.get(symbol.name);
  const required = (symbol.flags & ts.SymbolFlags.Optional) === 0 && defaultValue === undefined;
  const category = getCategory(symbol.name, type, checker, location);
  const info: PropInfo = {
    name: symbol.name,
    type: formatType(type, checker, location),
    required,
    category
  };

  if (defaultValue !== undefined) {
    info.default = defaultValue;
  }

  return info;
}

function getCategory(
  name: string,
  type: ts.Type,
  checker: ts.TypeChecker,
  location: ts.Node
): PropInfo['category'] {
  if (isSnippetType(type, checker, location)) {
    return 'snippet';
  }

  if (name.startsWith('on') && isFunctionType(type, checker)) {
    return 'event';
  }

  return 'prop';
}

function isSnippetType(type: ts.Type, checker: ts.TypeChecker, location: ts.Node): boolean {
  return getDefinedTypes(type).some((member) => {
    const symbol = member.aliasSymbol ?? member.getSymbol();
    const typeName = checker.typeToString(member, location, TYPE_FORMAT_FLAGS);

    return symbol?.name === 'Snippet' || typeName === 'Snippet' || typeName.startsWith('Snippet<');
  });
}

function isFunctionType(type: ts.Type, checker: ts.TypeChecker): boolean {
  return getDefinedTypes(type).some(
    (member) => checker.getSignaturesOfType(member, ts.SignatureKind.Call).length > 0
  );
}

function getDefinedTypes(type: ts.Type): ts.Type[] {
  if (!type.isUnion()) {
    return [type];
  }

  return type.types.filter((member) => (member.flags & ts.TypeFlags.Undefined) === 0);
}

function formatType(type: ts.Type, checker: ts.TypeChecker, location: ts.Node): string {
  const members = getDefinedTypes(type);

  if (members.length === 0) {
    return normalizeTypeText(checker.typeToString(type, location, TYPE_FORMAT_FLAGS));
  }

  if (members.every((member) => (member.flags & ts.TypeFlags.BooleanLiteral) !== 0)) {
    return 'boolean';
  }

  return normalizeTypeText(
    members.map((member) => checker.typeToString(member, location, TYPE_FORMAT_FLAGS)).join(' | ')
  );
}

function normalizeTypeText(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .replace(/\{\s+/gu, '{ ')
    .replace(/;\}/gu, '; }')
    .replace(/\s+\}/gu, ' }')
    .trim();
}
