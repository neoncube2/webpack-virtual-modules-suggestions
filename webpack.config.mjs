import webpack from 'webpack';

const WEBPACK_CONFIG = {
    entry: './index.js',
    mode: 'production',
    module: {
        rules: [
            {
                test: /\.(js|jsx|mjs)$/,
                resolve: {
                    fullySpecified: false
                },
                use: [
                    {
                        loader: 'splitter-loader',
                    }
                ]
            },
            {
                test: /\.(png|jpg|jpeg|svg)$/i,
                type: 'asset/resource',
                generator: {
                    filename: '[path]-[contenthash][ext]'
                }
            }
        ]
    },
    plugins: [
        new webpack.experiments.schemes.VirtualUrlPlugin(
            {
                '__unused__': ''
            },
            'splitter-loader'
        )
    ]
};

export default WEBPACK_CONFIG;