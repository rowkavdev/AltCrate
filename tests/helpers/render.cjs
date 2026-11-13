const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
exports.render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
exports.loadComponent=async(modulePath,exportName='default')=>{
  const {createServer}=await import('vite');
  const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
  try{return (await server.ssrLoadModule(modulePath))[exportName];}finally{await server.close();}
};
