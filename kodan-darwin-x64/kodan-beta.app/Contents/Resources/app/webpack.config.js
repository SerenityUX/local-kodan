const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    main: './src/index.js',  // Entry point for index.html
    projectViewer: './src/projectViewer.js',  // Entry point for project-viewer.html
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js',  // Output each entry point's bundle with its name
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      filename: 'index.html',  // Output file name
      template: './public/index.html',  // Template file
      chunks: ['main'],  // Entry point chunk to include
    }),
    new HtmlWebpackPlugin({
      filename: 'project-viewer.html',  // Output file name
      template: './public/project-viewer.html',  // Template file
      chunks: ['projectViewer'],  // Entry point chunk to include
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'public/icons', to: 'icons' },  // Only copy the directories that exist
        // Remove or comment out this line if 'other-assets' doesn't exist
        // { from: 'public/other-assets', to: 'assets' },
      ],
    }),
  ],
  target: 'electron-renderer',
  devtool: 'source-map',  // Optional for better debugging
};
