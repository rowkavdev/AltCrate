export const PAGE_DEFINITIONS = [
  {id:'overview',title:'Visão geral',description:'O estado das tuas contas e operações, num só lugar.'},
  {id:'accounts',title:'Contas',description:'Gere sessões, saldos e caixas das contas ligadas.'},
  {id:'automation',title:'Automação',description:'Caixas, dinheiro e cofre nas contas que selecionares.'},
  {id:'opening',title:'Abrir caixas',description:'Escolhe as contas, abre caixas e acompanha os resultados.'},
  {id:'converter',title:'Conversor de tokens',description:'Converte caixas em tokens e envia-os para a conta que escolheres.'},
  {id:'inventory',title:'Inventário',description:'Os itens das tuas contas, com fotografias e detalhes.'},
  {id:'games',title:'Jogos',description:'Mesas e jogos das tuas contas, com controlos independentes.'},
  {id:'rewards',title:'Recompensas',description:'Recompensas, missões e passe mensal das tuas contas.'},
  {id:'skills',title:'Mapas de skills',description:'Planeia as skills, revê os custos e acompanha cada alteração.'},
  {id:'autoopen',title:'Preferências de abertura',description:'Escolhe os favoritos e a venda automática nas aberturas do jogo.'},
  {id:'diagnostics',title:'Diagnóstico',description:'Compara os valores observados em duas leituras da conta.'},
  {id:'settings',title:'Definições',description:'Idioma e funcionalidades opcionais da aplicação.'},
  {id:'activity',title:'Atividade',description:'Pedidos, resultados e confirmações desta sessão.'},
];
export function parsePageHash(hash='') {
  const id=String(hash).replace(/^#\/?/,'').split('?')[0];
  return PAGE_DEFINITIONS.some(page=>page.id===id)?id:'overview';
}
export function pageHash(page) {return '#'+parsePageHash(page);}
export function visiblePages(preferences={}){return PAGE_DEFINITIONS.filter(page=>page.id!=='autoopen'||preferences.enableSiteOpening===true);}
export function availablePage(page,preferences={}){return page==='autoopen'&&preferences.enableSiteOpening!==true?'settings':parsePageHash(page);}
