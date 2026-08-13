import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "@typescript/typescript6";

export type DirectProcessEnvRead = {
  path: string;
  line: number;
  column: number;
  expression: string;
};

const sourceRoots = ["agent", "scripts", "src"];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);

function unwrapExpression(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isProcessEnv(node: ts.Node): boolean {
  const expression = unwrapExpression(node);
  return (
    (ts.isPropertyAccessExpression(expression) &&
      isProcessReference(expression.expression) &&
      expression.name.text === "env") ||
    (ts.isElementAccessExpression(expression) &&
      isProcessReference(expression.expression) &&
      ts.isStringLiteral(expression.argumentExpression) &&
      expression.argumentExpression.text === "env")
  );
}

function isProcessReference(node: ts.Node): boolean {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) return expression.text === "process";
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    (expression.expression.text === "globalThis" || expression.expression.text === "global") &&
    expression.name.text === "process"
  );
}

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  const walk = async (relativeDirectory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(relativePath);
      } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
        if (relativePath === "src/lib/config/registry.ts") continue;
        files.push(relativePath);
      }
    }
  };

  for (const sourceRoot of sourceRoots) await walk(sourceRoot);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function findDirectProcessEnvReads(root: string): Promise<DirectProcessEnvRead[]> {
  const violations: DirectProcessEnvRead[] = [];

  for (const relativePath of await sourceFiles(root)) {
    const content = await readFile(path.join(root, relativePath), "utf8");
    const sourceFile = ts.createSourceFile(
      relativePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(relativePath),
    );

    const visit = (node: ts.Node): void => {
      const memberRead =
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        isProcessEnv(node.expression);
      const parent = node.parent;
      const destructuredRead =
        isProcessEnv(node) &&
        ((ts.isVariableDeclaration(parent) &&
          parent.initializer === node &&
          ts.isObjectBindingPattern(parent.name)) ||
          (ts.isParameter(parent) &&
            parent.initializer === node &&
            ts.isObjectBindingPattern(parent.name)) ||
          (ts.isBinaryExpression(parent) &&
            parent.right === node &&
            parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            (ts.isObjectLiteralExpression(unwrapExpression(parent.left)) ||
              ts.isArrayLiteralExpression(unwrapExpression(parent.left)))));
      const directRead = memberRead || destructuredRead;
      const allowedFrameworkRead =
        relativePath === "src/instrumentation.ts" &&
        node.getText(sourceFile) === "process.env.NEXT_RUNTIME";

      if (directRead && !allowedFrameworkRead) {
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          path: relativePath,
          line: location.line + 1,
          column: location.character + 1,
          expression: node.getText(sourceFile),
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return violations;
}

if (import.meta.main) {
  findDirectProcessEnvReads(process.cwd())
    .then((violations) => {
      if (violations.length === 0) return;
      for (const violation of violations) {
        console.error(
          `${violation.path}:${violation.line}:${violation.column} direct environment read: ${violation.expression}`,
        );
      }
      process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
