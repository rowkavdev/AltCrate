const path=require('node:path');
const {buildSync}=require('../runtime/node_modules/esbuild');
const root=path.resolve(__dirname,'../runtime');
buildSync({entryPoints:[path.join(root,'engine/worker.cjs')],outfile:path.join(root,'engine/desktop-worker.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'warning'});
