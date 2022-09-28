const fs = require('fs');
const path = require('path');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const babel = require('babel-core');

/** それぞれのAssetに付与される一意なID */
let ID = 0;

/**
 * 与えられたファイルの依存関係を解析し、Assetを生成する
 */
function createAsset(filename) {
  const content = fs.readFileSync(filename, 'utf-8');


  // JavaScriptのParserを使ってASTを構築する
  // ref: https://astexplorer.net
  const ast = babylon.parse(content, { sourceType: 'module' });

  const dependencies = [];

  // ASTを走査して、依存関係を抽出する
  traverse(ast, {
    ImportDeclaration: ({ node }) => {
      dependencies.push(node.source.value);
    }
  })

  const id = ID++;

  // Babelを用いてほとんどのブラウザが利用できるようなコードにトランスパイルする
  const { code } = babel.transformFromAst(ast, null, {
    // どのようにトランスパイルするかを指定するルールセット
    presets: ['env'],
  });

  return {
    id,
    filename,
    dependencies,
    code,
  }
}

/**
 * Entry Pointから依存関係を解析し、Dependency graphを再帰的に生成する
 */
function createGraph(entry) {
  const mainAsset = createAsset(entry);

  const queue = [mainAsset];  

  for (const asset of queue) {
    const dirname = path.dirname(asset.filename);

    asset.mapping = {};

    asset.dependencies.forEach(relativePath => {
      const absolutePath = path.join(dirname, relativePath);
      const child = createAsset(absolutePath);

      asset.mapping[relativePath] = child.id;

      queue.push(child);
    })
  }

  return queue;
}

/**
 * AssetのGraphを受け取り、実行可能なコードを生成する
 */
function bundle(graph) {
  let modules = '';

  // トランスパイル後のモジュールはCommonJSのModule Systemを利用する
  // しかしブラウザではrequire, module, exportsといったオブジェクトは利用できないので、独自で定義する
  // 2つめの値はそのモジュールの依存関係のマッピングを表す
  graph.forEach(mod => {
    modules += `${mod.id}: [
      function (require, module, exports) {
        ${mod.code}
      },
      ${JSON.stringify(mod.mapping)},
    ],`;
  });

  const result = `
    (function(modules) {
      function require(id) {
        const [fn, mapping] = modules[id];

        function localRequire(relativePath) {
          return require(mapping[relativePath]);
        }

        const module = { exports: {} };

        fn(localRequire, module, module.exports);

        return module.exports;  
      }

      require(0);
    })({${modules}})
  `;

  return result;
}

const graph = createGraph('./example/entry.js');
const result = bundle(graph);

console.log(result);
