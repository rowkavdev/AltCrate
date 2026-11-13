function pageProps(html) {
 if(typeof html!=='string'||html.length>4_000_000)throw Error('Resposta do catálogo inválida');
 const match=html.match(/<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i);
 if(!match)throw Error('O catálogo de caixas está indisponível');
 const data=JSON.parse(match[1]);
 if(!data?.props?.pageProps)throw Error('Dados do catálogo indisponíveis');
 return data.props.pageProps;
}
module.exports={pageProps};
