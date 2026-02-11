import path from 'path';
import { readFile } from 'fs/promises';
// VSCode shows Node as not being used, but it's used in the instanceof calls in visitAllNodes()
import { Parser, Node } from 'acorn';
import { generate } from 'astring';

function shouldExport(identifier, exportName) {
    return identifier === exportName || exportName === '*';
}

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

async function makeImportSource(importPath, functionName, context, loader, mustFindImport = true) {
    if (!await isESMModule(importPath, loader))
        return importPath;

    const importFilepath = await getNormalizedImportFilepath(importPath, context, loader);

    const virtualModulePlugin = loader._compiler.options.plugins.find(plugin => plugin.scheme === 'splitter-loader');

    const virtualModuleName = 'splitter-loader:' + functionName + '--' + importFilepath;

    if (virtualModulePlugin.modules[virtualModuleName] == null) {
        const readFileContentsTask = readFile(importFilepath);
        virtualModulePlugin.modules[virtualModuleName] = {
            type: path.extname(importFilepath),
            source: async (loaderContext) => await readFileContentsTask
        };
    }

    const loaderOptions = JSON.stringify({
        exportName: functionName,
        importFilepath: importFilepath,
        context: path.dirname(importFilepath),
        mustFindImport: mustFindImport
    });

    return 'splitter-loader/loader-inner.js?' + loaderOptions + '!' + virtualModuleName;
}

function getImportName(importSpecifier) {
    switch (importSpecifier.type) {
        case 'ImportDefaultSpecifier':
            return 'default';

        case 'ImportSpecifier': {
            const imported = importSpecifier.imported;

            if (imported.type !== 'Identifier')
                throw `Expected import type to be an identifier but got type "${imported.type}"`;

            return imported.name;
        }
    }

    throw `Unexpected import specifier type "${importSpecifier.type}"`;
}

async function getNewImportDeclarations(importDeclaration, importPath, context, loader) {
    const newImportDeclarations = [];

    for (let specifier of importDeclaration.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier')
            return specifier;

        const originalImportFunction = getImportName(specifier);

        newImportDeclarations.push({
            ...importDeclaration,
            specifiers: [specifier],
            source: {
                ...importDeclaration.source,
                raw: JSON.stringify(await makeImportSource(importPath, originalImportFunction, context, loader))
            }
        });
    }

    return newImportDeclarations;
}

export async function isESMModule(importPath, loader) {
    // TODO: Hardcoded
    if (importPath[0] === '.' || importPath.startsWith('C:') || importPath.startsWith('/'))
        return true;

    const moduleType = (await loader.importModule(importPath)).toString();

    return moduleType === '[object Module]' || moduleType === '[object NormalModule]';
}

function makeImportFromSource(importSource, functionName) {
    return {
        type: 'ImportDeclaration',
        specifiers: [
            {
                type: 'ImportSpecifier',
                imported: {
                    type: 'Identifier',
                    name: functionName
                },
                local: {
                    type: 'Identifier',
                    name: functionName
                }
            }
        ],
        source: {
            raw: JSON.stringify(importSource)
        }
    };
}

async function makeImport(importPath, functionName, context, loader) {
    const importSource = await makeImportSource(importPath, functionName, context, loader);

    return makeImportFromSource(importSource, functionName);
}

function getDeclarations(namedDeclaration) {
    return namedDeclaration.declarations ?? [namedDeclaration];
}

function getDeclarationName(declaration) {
    const declarationName = declaration.id.name;

    if (declarationName == null)
        throw `Encountered top-level destructuring`;

    return declarationName;
}

function makeNamedExportStatement(exportName) {
    return {
        type: 'ExportNamedDeclaration',
        specifiers: [
            {
                type: 'ExportSpecifier',
                exported: {
                    name: exportName
                },
                local: {
                    name: exportName
                }
            }
        ]
    }
}

async function handleDeclaration(namedDeclaration, newImports, exportsAndDeclarations, exportName, importPath, context, loader) {
    const declarations = getDeclarations(namedDeclaration);

    for (let declaration of declarations) {
        const declarationName = getDeclarationName(declaration);

        if (shouldExport(declarationName, exportName)) {
            const exportStatement = namedDeclaration.declarations == null ?
                {
                    ...namedDeclaration,
                    declaration: declaration
                }
                :
                {
                    ...namedDeclaration,
                    declarations: [declaration]
                };

            exportsAndDeclarations.push({
                declaration: exportStatement,
                export: makeNamedExportStatement(declarationName)
            });

            continue;
        }

        newImports.push(await makeImport(importPath, declarationName, context, loader));
    }
}

async function getPossiblyNeededImportStatements(imports, statements, context, loader) {
    const allIdentifiers = new Set();

    for (let statement of statements) {
        if (statement.type === 'ExportNamedDeclaration') {
            for (let specifier of statement.specifiers) {

                allIdentifiers.add(specifier.local.name);
            }

            continue;
        }

        const importExpressions = [];

        visitAllNodes(statement, (node) => {
            if (node == null)
                return;

            switch (node.type) {
                case 'Identifier':
                    allIdentifiers.add(node.name);
                    break;

                case 'ImportExpression':
                    importExpressions.push(node);
                    break;
            }
        });

        for (let importExpression of importExpressions) {
            const source = importExpression.source;

            source.raw = JSON.stringify(await makeImportSource(source.value, '*', context, loader, false));
        }
    }

    const neededImports = [];

    for (let importStatement of imports) {
        if (importStatement.type !== 'ImportNamespaceSpecifier' && !allIdentifiers.has(importStatement.specifiers[0].local.name))
            continue;

        const importAlreadyExists = neededImports.some(neededImport => {
            const neededImportSpecifier = neededImport.specifiers[0];
            const importStatementSpecifier = importStatement.specifiers[0];

            return neededImport.type === importStatement.type && neededImportSpecifier.local.name === importStatementSpecifier.local.name;
        });

        if (importAlreadyExists)
            continue;

        neededImports.push(importStatement);
    }

    return neededImports;
}

function getDeclarationAndExportStatements(exportName, importFilepath, exportsAndDeclarations, exportAllStatements, mustFindImport) {
    if (exportsAndDeclarations.length === 0 && exportAllStatements.length === 0 && mustFindImport)
        throw `Failed to find desired export "${exportName}" in "${importFilepath}"`;

    const exportStatements = {};

    for (let exportAndDeclarationStatement of exportsAndDeclarations) {
        const exportStatement = exportAndDeclarationStatement.export;

        const exportName = exportStatement.type === 'ExportDefaultDeclaration' ? 'default' : exportStatement.specifiers[0].exported.name;

        exportStatements[exportName] = exportStatement;
    }

    return exportsAndDeclarations.map(exportAndDeclarationStatement => exportAndDeclarationStatement.declaration)
        .filter(statement => statement != null)
        .concat(Object.values(exportStatements));
}

export async function getSplitterLoader(loader, context) {
    const loaderPath = await getNormalizedImportFilepath('splitter-loader', context, loader);

    return loader.loaders.find(loader => loader.path === loaderPath);
}

export async function processContent(content, exportName, importFilepath, context, loader, mustFindImport) {
    const parsedImportText = Parser.parse(content, { ecmaVersion: 'latest', sourceType: 'module' })

    const beforeImports = [];
    let originalImports = [];
    const newImports = [];
    const statementsWithSideEffects = [];

    const exportsAndDeclarations = [];

    const exportAllStatements = [];

    for (let statement of parsedImportText.body) {
        switch (statement.type) {
            case 'ExpressionStatement':
                if (statement.expression.value === 'use strict') {
                    beforeImports.push(statement);

                    break;
                }

            case 'IfStatement':
            case 'TryStatement':
            case 'ForStatement':
            case 'WhileStatement':
                statementsWithSideEffects.push(statement);
                break;

            case 'FunctionDeclaration':
            case 'ClassDeclaration':
                await handleDeclaration(statement, newImports, exportsAndDeclarations, exportName, importFilepath, context, loader);
                break;

            case 'VariableDeclaration':
                switch (statement.kind) {
                    case 'const':
                        await handleDeclaration(statement, newImports, exportsAndDeclarations, exportName, importFilepath, context, loader);
                        break;

                    case 'let':
                    case 'var': {
                        statementsWithSideEffects.push(statement);

                        for (let declaration of statement.declarations) {
                            const declarationName = getDeclarationName(declaration);

                            if (exportName === 'original-statements-with-side-effects') {
                                statementsWithSideEffects.push(makeNamedExportStatement(declarationName));
                            } else {
                                newImports.push(makeImportFromSource(await makeImportSource(importFilepath, 'original-statements-with-side-effects', context, loader), declarationName));
                            }
                        }
                    }
                        break;

                    default:
                        throw `Unrecognized variable declaration "${statement.kind}"`;
                }
                break;

            case 'ExportNamedDeclaration': {
                const namedDeclaration = statement.declaration;
                const specifiers = statement.specifiers;

                if (namedDeclaration != null) {
                    if (namedDeclaration.type === 'VariableDeclaration' || namedDeclaration.type === 'FunctionDeclaration' || namedDeclaration.type === 'ClassDeclaration') {
                        await handleDeclaration(namedDeclaration, newImports, exportsAndDeclarations, exportName, importFilepath, context, loader);

                        break;
                    }

                    throw 'Found unknown named export declaration type';
                }

                if (specifiers != null) {
                    for (let specifier of specifiers) {
                        if (specifier.type !== 'ExportSpecifier')
                            throw 'Found specifier of unknown type';

                        if (shouldExport(specifier.exported.name, exportName)) {
                            exportsAndDeclarations.push({
                                export: {
                                    ...statement,
                                    specifiers: [
                                        specifier
                                    ]
                                }
                            });

                            const specifierName = specifier.local.name;

                            if (specifierName == null)
                                throw `Undefined specifier name`;

                            if (!exportsAndDeclarations.some(exportAndDeclaration => exportAndDeclaration.declaration != null && getDeclarations(exportAndDeclaration.declaration).some(declaration => declaration?.id.name === specifierName)))
                                newImports.push(await makeImport(importFilepath, specifierName, context, loader));
                        }
                    }

                    break;
                }

                throw 'ExportNamedDeclaraction had neither declarations nor specifiers';
            }

            case 'ImportDeclaration':
                if (statement.specifiers.length === 0)
                    statementsWithSideEffects.push(statement);
                else
                    originalImports = originalImports.concat(await getNewImportDeclarations(statement, statement.source.value, context, loader));
                break;

            case 'ExportDefaultDeclaration':
                if (exportName === 'default')
                    exportsAndDeclarations.push({
                        export: statement
                    });
                break;

            case 'ExportAllDeclaration':
                exportAllStatements.push({
                    ...statement,
                    source: {
                        raw: JSON.stringify(await makeImportSource(statement.source.value, exportName, context, loader, false))
                    }
                });
                break;

            default:
                throw `Unknown statement type "${statement.type}" in file "${importFilepath}". Bailing.`;
        }
    }

    const statements = exportName === 'original-statements-with-side-effects' ?
        statementsWithSideEffects
        :
        getDeclarationAndExportStatements(exportName, importFilepath, exportsAndDeclarations, exportAllStatements, mustFindImport);

    const imports = [...originalImports, ...newImports];

    const possiblyNeededImportStatements = await getPossiblyNeededImportStatements(imports, statements, context, loader);

    let newBody = [
        ...beforeImports
    ];

    if (exportName !== 'original-statements-with-side-effects' && statementsWithSideEffects.length > 0) {
        const newSource = await makeImportSource(importFilepath, 'original-statements-with-side-effects', context, loader);

        newBody.push({
            type: 'ImportDeclaration',
            specifiers: [],
            source: {
                raw: JSON.stringify(newSource)
            }
        });
    }

    newBody = newBody.concat(possiblyNeededImportStatements).concat(statements).concat(exportAllStatements);

    return generate({
        ...parsedImportText,
        body: newBody
    });
}