This repo contains a simplified version of [webpack-import-splitter-loader](https://github.com/neoncube2/webpack-import-splitter-loader) and a demo project that uses the simplified loader.

The loader in this repo simply rewrites import statements so that they get their contents from virtual modules, to demonstrate some of the difficulties in doing so.

Ideally, the contents of `dist/` would be the same whether this loader is enabled or not.

# Difficulties

## Context

There's currently no way to be able to set the context of a virtual module, so the context is always the same as the entry point's. This means that relative import statements in virtual modules generally don't work:

**index.js**
```js
import HomePage from 'virtual:src/pages/home-page.js';
```

**virtual:./src/pages/home-page.js**
```js
// Breaks, because logo.svg is at /webpack-virtual-modules-suggestions/src/pages/logo.svg and our import statement is evaluated from /webpack-virtual-modules-suggestions, since that's where the context defaults to
import Logo from './logo.svg';
```

To get around this, the loader manually passes the context as an option and then rewrites the contents of import statements:

**index.js**
```js
import HomePage from 'splitter-loader/loader-inner.js?{\"context\":\"/webpack-virtual-modules-suggestions/src/pages/\"}!!virtual:./src/pages/home-page.js';
```

**virtual:./src/pages/home-page.js**
```js
import Logo from '/webpack-virtual-modules-suggestions/src/pages/logo.svg';
```

It would be nice to be able to set the context of a virtual module:

```js
virtualModulePlugin.modules['src/pages/home-page.js'] = {
    type: '.js'
    context: '/webpack-virtual-modules-suggestions/src/pages/',
    source: ....
};
```
