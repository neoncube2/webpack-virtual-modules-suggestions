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
// Breaks, because dynamically-loader.js is at /webpack-virtual-modules-suggestions/src/pages/dynamically-loaded.js and our import statement is evaluated from /webpack-virtual-modules-suggestions, since that's where the context defaults to
const dynamicallyLoaded = import('./dynamically-loaded.js');

// Also breaks, because logo.svg is at /webpack-virtual-modules-suggestions/img/logo.svg and our import statement is evaluated from /webpack-virtual-modules-suggestions, since that's where the context defaults to
import Logo from '../../img/logo.svg';
```

To get around this, the loader manually passes the context as an option and then rewrites the contents of import statements:

**index.js**
```js
import HomePage from 'splitter-loader/loader-inner.js?{\"context\":\"/webpack-virtual-modules-suggestions/src/pages/\"}!virtual:./src/pages/home-page.js';
```

**virtual:./src/pages/home-page.js**
```js
import Logo from '/webpack-virtual-modules-suggestions/img/logo.svg';
```

It would be nice to be able to set the context of a virtual module:

```js
virtualModulePlugin.modules['./src/pages/home-page.js'] = {
    type: '.js'，
    context: '/webpack-virtual-modules-suggestions/src/pages/',
    source: ....
};
```

## Virtual module filename

The loader rewrites the source of all import statements so that they're in the form `splitter-loader/loader-inner.js!virtual:./src/pages/home-page.js`. Import sources for asset files are also rewritten (e.g. `splitter-loader/loader-inner.js!virtual:../img/logo.svg`). The loader then checks if the file is an asset file, and if it is, it passes the contents through without touching it (`return content;`). This breaks the naming of output files for two reasons: `[name]` is different than the original filename, and also `[path]` is not defined.

Asset configuration in `webpack.config.js`:

```js
{
    test: /\.(png|jpg|jpeg|svg)$/i,
    type: 'asset/resource',
    generator: {
        filename: '[path][name]-[contenthash][ext]'
    }
}
```

`import Logo from 'img/logo.svg';` result in `dist/img/logo.svg`, but `import Logo from 'virtual:img/logo.svg';` results in `dist/__virtual__logo.svg`. (The filename is different, and also it's not placed in the `img/` directory, because `[path]` is not defined.

### [name]

For `[name]`, it might make sense to just drop `virtual:` from the resulting filename. This would make the behaviour of virtual modules the same as normal modules:

```js
// Results in dist/logo.svg
import Logo from 'file:/webpack-virtual-modules-suggestions/img/logo.svg';

// Results in dist/logo.svg
import Logo from 'example-package/logo.svg';

// Currently results in dist/__virtual__logo.svg. Perhaps should also result in dist/logo.svg, to match file: and normal module behaviour.
import Logo from 'virtual:logo.svg';
```

Alternatively, `name` could be added as another option when creating the virtual module:

```js
virtualModulePlugin.modules['./img/logo.svg'] = {
    type: '.svg',
    name: 'logo.svg',
    source: ....
};
```

### [path]

`[path]` could also be set manually:
```js
virtualModulePlugin.modules['./img/logo.svg'] = {
    type: '.svg',
    name: 'logo.svg',
    path: 'img',
    source: ....
};
```

Alternatively, it could be automaticaly extracted from the virtual module name:

```js
// Automatically sets [name] to 'logo.svg' and [path] to 'img'
import Logo from 'virtual:img/logo.svg'
```

Finally, it could be extracted from the context:

```js
virtualModulePlugin.modules['./img/logo.svg'] = {
    type: '.svg',
    context: 'img',
    source: ....
};
```
