import fs from 'fs';
import path from 'path';
import { Project, SyntaxKind } from 'ts-morph';
import { Tool } from './Tool.js';

// Cache the project instance globally so we don't re-parse the AST for every single call
let sharedProject = null;
let lastWorkspace = null;

function getProject(userWorkspace) {
  if (sharedProject && lastWorkspace === userWorkspace) {
    return sharedProject;
  }
  sharedProject = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: true,
      resolveJsonModule: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  // Load all js/ts files in the workspace, excluding node_modules
  // We do a fast globbing equivalent
  try {
    sharedProject.addSourceFilesAtPaths([
      path.join(userWorkspace, '**/*.js'),
      path.join(userWorkspace, '**/*.ts'),
      path.join(userWorkspace, '**/*.jsx'),
      path.join(userWorkspace, '**/*.tsx'),
      `!${path.join(userWorkspace, 'node_modules/**/*')}`,
      `!${path.join(userWorkspace, 'dist/**/*')}`,
      `!${path.join(userWorkspace, 'build/**/*')}`,
    ]);
  } catch (err) {
    console.warn('[LSPTool] Error loading files into ts-morph project:', err.message);
  }

  lastWorkspace = userWorkspace;
  return sharedProject;
}

export class LSPTool extends Tool {
  constructor() {
    super();
    this.name = 'LSP_SemanticQuery';
    this.description =
      'Advanced Semantic Code Engine (LSP). Use this tool to perform precise AST-based queries like finding all references of a function or class across the entire project, or jumping to its definition. This is far more accurate than simple grep searches. Only works for JS/TS/JSX/TSX files.';
    this.inputSchema = {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['find_references', 'go_to_definition', 'view_symbols'],
          description: 'The semantic action to perform.',
        },
        filePath: {
          type: 'string',
          description: 'The absolute path to the file containing the target identifier.',
        },
        identifier: {
          type: 'string',
          description:
            'The precise name of the variable, function, or class to inspect (required for find_references and go_to_definition). Leave empty for view_symbols to get all symbols in the file.',
        },
        lineNumber: {
          type: 'number',
          description:
            'Optional 1-indexed line number where the identifier is located to resolve ambiguities if multiple symbols share the same name in the file.',
        },
      },
      required: ['action', 'filePath'],
    };
  }

  success(text) {
    return {
      content: [{ type: 'text', text }],
      isError: false,
    };
  }

  error(text) {
    return {
      content: [{ type: 'text', text }],
      isError: true,
    };
  }

  async call(input, context) {
    return this.execute(input, context);
  }

  async execute(args, context) {
    const { action, filePath, identifier, lineNumber } = args;
    const { userWorkspace } = context;

    if (!fs.existsSync(filePath)) {
      return this.error(`File not found: ${filePath}`);
    }

    try {
      const project = getProject(userWorkspace);
      const sourceFile = project.getSourceFile(filePath) || project.addSourceFileAtPath(filePath);

      // refresh from disk to ensure we have the latest edits made by Bash or Write
      await sourceFile.refreshFromFileSystem();

      if (action === 'view_symbols') {
        const symbols = this.getAllSymbols(sourceFile);
        if (symbols.length === 0)
          return this.success('No significant semantic symbols found in this file.');
        return this.success(`Outline for ${filePath}:\n` + symbols.join('\n'));
      }

      if (!identifier) {
        return this.error('The "identifier" parameter is required for action: ' + action);
      }

      // Find the specific node
      const nodes = sourceFile
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .filter((n) => n.getText() === identifier);

      if (nodes.length === 0) {
        return this.error(`Identifier '${identifier}' not found in file ${filePath}`);
      }

      let targetNode = nodes[0];
      if (lineNumber && nodes.length > 1) {
        // Find the node closest to the requested line number
        targetNode = nodes.reduce((prev, curr) => {
          const prevDist = Math.abs(prev.getStartLineNumber() - lineNumber);
          const currDist = Math.abs(curr.getStartLineNumber() - lineNumber);
          return currDist < prevDist ? curr : prev;
        });
      }

      if (action === 'go_to_definition') {
        return this.goToDefinition(targetNode, project);
      } else if (action === 'find_references') {
        return this.findReferences(targetNode, project);
      } else {
        return this.error(`Unknown action ${action}`);
      }
    } catch (err) {
      return this.error(`LSP Engine Error: ${err.stack}`);
    }
  }

  goToDefinition(node, _project) {
    const definitions = node.getDefinitions();
    if (!definitions || definitions.length === 0) {
      return this.success(
        `No definition found for '${node.getText()}'. It might be a built-in type or an unresolved import.`,
      );
    }

    const defs = definitions.map((def) => {
      const sourceFile = def.getSourceFile();
      const declarationNode = def.getDeclarationNode();
      const lineNum = declarationNode ? declarationNode.getStartLineNumber() : 'unknown';
      let snippet = declarationNode ? declarationNode.getText() : '';
      if (snippet.length > 300) snippet = snippet.slice(0, 300) + '... (truncated)';

      return `File: ${sourceFile.getFilePath()}\nLine: ${lineNum}\nSnippet:\n${snippet}\n`;
    });

    return this.success(
      `Found ${definitions.length} definition(s) for '${node.getText()}':\n\n` +
        defs.join('\n---\n'),
    );
  }

  findReferences(node, _project) {
    const referencedSymbols = node.findReferences();
    if (!referencedSymbols || referencedSymbols.length === 0) {
      return this.success(`No references found for '${node.getText()}'.`);
    }

    const results = [];
    let count = 0;

    for (const refSymbol of referencedSymbols) {
      for (const reference of refSymbol.getReferences()) {
        const sourceFile = reference.getSourceFile();
        const lineNum = reference.getNode().getStartLineNumber();
        const lineText = sourceFile.getFullText().split('\n')[lineNum - 1].trim();
        results.push(`- ${sourceFile.getFilePath()}:${lineNum} -> ${lineText}`);
        count++;

        // Safety truncation if there are thousands of references
        if (count >= 100) {
          results.push(`\n... limiting to 100 references. Search truncated.`);
          break;
        }
      }
      if (count >= 100) break;
    }

    return this.success(
      `Found ${count} references for '${node.getText()}':\n\n` + results.join('\n'),
    );
  }

  getAllSymbols(sourceFile) {
    const symbols = [];
    sourceFile.getFunctions().forEach((f) => {
      if (f.getName()) symbols.push(`[Function] ${f.getName()} (Line ${f.getStartLineNumber()})`);
    });
    sourceFile.getClasses().forEach((c) => {
      if (c.getName()) symbols.push(`[Class] ${c.getName()} (Line ${c.getStartLineNumber()})`);
      c.getMethods().forEach((m) => {
        symbols.push(`  - [Method] ${m.getName()} (Line ${m.getStartLineNumber()})`);
      });
    });
    sourceFile.getInterfaces().forEach((i) => {
      if (i.getName()) symbols.push(`[Interface] ${i.getName()} (Line ${i.getStartLineNumber()})`);
    });
    sourceFile.getVariableDeclarations().forEach((v) => {
      const stmt = v.getVariableStatement();
      if (stmt && stmt.getParent() && stmt.getParent().getKind() === SyntaxKind.SourceFile) {
        symbols.push(`[Variable] ${v.getName()} (Line ${v.getStartLineNumber()})`);
      }
    });
    return symbols;
  }
}
