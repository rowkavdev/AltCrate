const ORIGIN = 'https://case-clicker.com';
const CASE_ID = /^[a-f0-9]{24}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORIES = Object.freeze(['cases', 'capsules', 'collections', 'keychainCollections']);

function picture(value, folder) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,238}\.(?:png|webp|jpe?g)$/i.test(name) || name.includes('..')) return '';
  return `${ORIGIN}/pictures/${folder}/${name}`;
}

function skinPicture(value) {
  const local = picture(value, 'skins');
  if (local) return local;
  if (typeof value === 'string' && /^https:\/\/cdn\.case-clicker\.com\/(?:stickers|keychains)\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,238}\.(?:png|webp|jpe?g)$/i.test(value) && !value.includes('..')) return value;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,2048}$/.test(value)
    ? `https://steamcommunity-a.akamaihd.net/economy/image/${value}` : '';
}

function pageProps(html) {
  if (typeof html !== 'string' || html.length > 4_000_000) throw Error('Resposta do catálogo inválida');
  const match = html.match(/<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw Error('O catálogo de caixas está indisponível');
  const data = JSON.parse(match[1]);
  if (!data?.props?.pageProps) throw Error('Dados do catálogo indisponíveis');
  return data.props.pageProps;
}

function unpack(value) { return typeof value === 'string' ? JSON.parse(value) : value; }

function normalizeCatalog(html, category = 'cases') {
  if (!CATEGORIES.includes(category)) throw Error('Categoria inválida');
  const cases = unpack(pageProps(html).cases);
  if (!Array.isArray(cases)) throw Error('Lista de caixas inválida');
  return cases.filter(item => CASE_ID.test(item?._id) && SLUG.test(item?.slug)).map(item => ({
    id: item._id,
    name: String(item.name || '').slice(0, 120),
    slug: item.slug,
    category,
    image: picture(item.iconUrl, 'cases'),
  }));
}

function normalizeDetails(html, expectedId) {
  const props = pageProps(html);
  const box = unpack(props.caseProp);
  const skins = unpack(props.skins);
  if (!CASE_ID.test(expectedId) || box?._id !== expectedId || !Array.isArray(skins)) throw Error('Conteúdo da caixa inválido');
  return {
    id: box._id,
    name: String(box.name || '').slice(0, 120),
    image: picture(box.iconUrl, 'cases'),
    items: skins.slice(0, 120).map(item => ({
      name: String(item?.name || '').slice(0, 130),
      rarity: String(item?.rarity || '').slice(0, 40),
      rarityColor: /^[a-f0-9]{6}$/i.test(item?.rarityColor || '') ? `#${item.rarityColor}` : '',
      image: skinPicture(item?.iconUrl),
      specialCount: Array.isArray(item?.specialItems) ? item.specialItems.length : 0,
      specialItems: Array.isArray(item?.specialItems)?item.specialItems.slice(0,500).map(special=>({
        name:String(typeof special==='string'?special:special?.name||'').slice(0,130),
        image:skinPicture(typeof special==='string'?'':special?.iconUrl),
      })).filter(special=>special.name):[],
    })).filter(item => item.name),
  };
}

function createCaseShowcase({ listAccounts, fetchForAccount, now = Date.now }) {
  if (typeof listAccounts !== 'function' || typeof fetchForAccount !== 'function') throw TypeError('Leitor de caixas inválido');
  let catalog = null;
  let catalogAt = 0;
  let catalogPromise = null;
  const details = new Map();

  async function read(path) {
    const account = (await listAccounts())[0];
    if (!account) throw Error('Liga uma conta para ver as caixas');
    const response = await fetchForAccount(account)(path, { method: 'GET', cache: 'no-store', credentials: 'include', headers: { Accept: 'text/html' } });
    if (!response.ok) throw Error(`Catálogo de caixas: HTTP ${response.status}`);
    return response.text();
  }

  async function list() {
    if (catalog && now() - catalogAt < 30 * 60_000) return catalog;
    if (!catalogPromise) catalogPromise = Promise.all(CATEGORIES.map(async category => normalizeCatalog(await read(`/cases/${category}`), category))).then(groups => groups.flat()).then(value => {
      catalog = value;
      catalogAt = now();
      return value;
    }).finally(() => { catalogPromise = null; });
    return catalogPromise;
  }

  async function detail(id) {
    if (!CASE_ID.test(id)) throw Error('Caixa inválida');
    const box = (await list()).find(item => item.id === id);
    if (!box) throw Error('Caixa não encontrada no catálogo');
    if (details.has(id)) return details.get(id);
    const value = await read(`/cases/${box.category}/${box.slug}`).then(html => normalizeDetails(html, id));
    details.set(id, value);
    return value;
  }

  return { list, detail };
}

module.exports = { picture, skinPicture, pageProps, normalizeCatalog, normalizeDetails, createCaseShowcase };
