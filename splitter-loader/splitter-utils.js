import path from 'path';
import { readFile } from 'fs/promises';
// VSCode shows Node as not being used, but it's used in the instanceof calls in visitAllNodes()
import { Parser, Node } from 'acorn';
import { generate } from 'astring';

// From https://github.com/acornjs/acorn/issues/272#issuecomment-121350586
function visitAllNodes(topNode, handler) {
    const visited = [];
    visit(topNode);

    function visit(node) {
        if (visited.indexOf(node) >= 0) {
            return;
        }
        visited.push(node);
        handler(node);

        for (var key in node) {
            if (node.hasOwnProperty(key)) {
                const value = node[key];
                if (value instanceof Node) {
                    visit(value);
                } else if (Array.isArray(value) && value.length && value[0] instanceof Node) {
                    for (let i = 0; i < value.length; i++) {
                        visit(value[i]);
                    }
                }
            }
        }
    }
}

export async function getNormalizedImportFilepath(importFilepath, context, loader) {
    const resolve = loader.getResolve({
        dependencyType: 'esm'
    });

    return await resolve(context, importFilepath);
}

async function makeImportSource(importPath, context, loader) {
    if (!await isESMModule(importPath, loader))
        return importPath;

    const importFilepath = await getNormalizedImportFilepath(importPath, context, loader);

    const virtualModulePlugin = loader._compiler.options.plugins.find(plugin => plugin.scheme === 'splitter-loader');

    const virtualModuleName = 'splitter-loader:' + importFilepath;

    if (virtualModulePlugin.modules[virtualModuleName] == null) {
        const readFileContentsTask = readFile(importFilepath);
        virtualModulePlugin.modules[virtualModuleName] = {
            type: path.extname(importFilepath),
            source: async (loaderContext) => await readFileContentsTask
        };
    }

    const loaderOptions = JSON.stringify({
        context: path.dirname(importFilepath)
    });

    return 'splitter-loader/loader-inner.js?' + loaderOptions + '!' + virtualModuleName;
}

export async function isESMModule(importPath, loader) {
    // TODO: Hardcoded
    if (importPath[0] === '.' || importPath.startsWith('C:') || importPath.startsWith('/'))
        return true;

    const moduleType = (await loader.importModule(importPath)).toString();

    return moduleType === '[object Module]' || moduleType === '[object NormalModule]';
}

export async function getSplitterLoader(loader, context) {
    const loaderPath = await getNormalizedImportFilepath('splitter-loader', context, loader);

    return loader.loaders.find(loader => loader.path === loaderPath);
}

async function rewriteImportDeclaration(statement, context, loader) {
    if (statement.specifiers.length !== 1)
        throw "This simplified version of the loader only handles single import statements (e.g. `import HomePage from 'home-page.js'`)";

    const newImportSource = await makeImportSource(statement.source.value, context, loader);

    statement.source.raw = JSON.stringify(newImportSource);
}

async function rewriteDynamicImports(statement, context, loader) {
    const importExpressions = [];

    visitAllNodes(statement, (node) => {
        if (node?.type !== 'ImportExpression')
            return;

        importExpressions.push(node);
    });

    for (let importExpression of importExpressions) {
        const source = importExpression.source;

        source.raw = JSON.stringify(await makeImportSource(source.value, context, loader));
    }
}

export async function processContent(content, context, loader) {
    const parsedImportText = Parser.parse(content, { ecmaVersion: 'latest', sourceType: 'module' })

    for (let statement of parsedImportText.body) {
        switch (statement.type) {
            case 'ImportDeclaration':
                await rewriteImportDeclaration(statement, context, loader);
                break;

            default:
                await rewriteDynamicImports(statement, context, loader);
        }
    }

    return generate(parsedImportText);
}