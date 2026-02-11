This repo is a simplified version of [webpack-import-splitter-loader](https://github.com/neoncube2/webpack-import-splitter-loader).

This module simply rewrites import statements so that they get their contents from virtual modules, to demonstrate some of the difficulties in doing so.

Ideally, the contents of `dist/` would be the same whether this loader is enabled or not.
