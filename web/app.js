// Relatórios de mercado BKM: formulário, mapa dos pontos (em janela), histórico e visualização.
// Sem build: módulo ES puro. O servidor (servidor/app.py) valida tudo de novo.

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CORES = ['#0094fe', '#863d8f', '#c67355', '#7d8a3e', '#e0a100']; // as do relatório (template do motor)
const RAIOS_OPC = [1, 2, 3, 5, 7, 10];
const DORMS_OPC = [[0, 'Studio'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']];
const RASCUNHO = 'bkm-relatorio-rascunho';

let CFG = { eu: null, maps_key: '', ambiente: '' };
let OPC = { barreiras: [], max_cenarios: 5, max_raios: 3 };
let ESTACOES = [];

// ------------------------------------------------------------ util
async function api(caminho, op = {}) {
  const r = await fetch(caminho, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...op });
  if (r.status === 401) { location.href = '/entrar?voltar=' + encodeURIComponent('/' + location.hash); throw new Error('sessão expirada'); }
  let d = null; try { d = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) throw new Error((d && (d.detail || d.erro)) || `erro ${r.status}`);
  return d;
}
const salvar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
const ler = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const fmtData = iso => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// ------------------------------------------------------------ tema
function aplicarTema(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('bkm-tema', t); } catch { }
  document.querySelectorAll('#menu-tema [data-tema]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.tema === t)));
}
function menus() {
  for (const [b, m] of [['#btn-tema', '#menu-tema'], ['#btn-conta', '#menu-conta']]) {
    $(b).addEventListener('click', e => { e.stopPropagation(); const abrir = $(m).hidden; fecharMenus(); $(m).hidden = !abrir; $(b).setAttribute('aria-expanded', String(abrir)); });
  }
  document.addEventListener('click', fecharMenus);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenus(); });
  $('#menu-tema').addEventListener('click', e => { const t = e.target.closest('[data-tema]'); if (t) aplicarTema(t.dataset.tema); });
  $('#sair').addEventListener('click', async () => { await fetch('/auth/sair', { method: 'POST' }); location.href = '/entrar'; });
  let t = 'auto'; try { t = localStorage.getItem('bkm-tema') || 'auto'; } catch { }
  aplicarTema(t);
}
function fecharMenus() { for (const m of ['#menu-tema', '#menu-conta']) $(m).hidden = true; }

// ------------------------------------------------------------ estado do formulário
function cenarioVazio(n) { return { nome: `Ponto ${n}`, pin: { lat: null, lon: null, descricao: '' }, barreiras: [], est: { ativo: false, km: 1.5, lista: [] }, pontos: [] }; }
function formVazio() {
  return { titulo: '', tipologia: { area_min: '', area_max: '', dorms: [] }, raios_km: [3, 5], min_unidades_projeto: 80,
    excluir_nr: true, lancamento_efetivo: true, periodo_inicio: '', excluir_nomes: '', cenarios: [cenarioVazio(1)] };
}
let F = ler(RASCUNHO) || formVazio();
let ATIVO = 0;           // ponto selecionado
let MODO = null;         // janela do mapa aberta: {i, j} (j = ponto de exclusão j do cenário i; sem j = o pin)
const guardar = () => salvar(RASCUNHO, F);

// spec do histórico -> formulário (botão Duplicar)
function specParaForm(sp) {
  const f = formVazio();
  f.titulo = sp.titulo + ' (cópia)';
  const tp = sp.tipologia || {};
  f.tipologia = { area_min: tp.area_min ?? '', area_max: tp.area_max ?? '', dorms: tp.dorms || [] };
  Object.assign(f, { raios_km: sp.raios_km, min_unidades_projeto: sp.min_unidades_projeto ?? 0, excluir_nr: sp.excluir_nr !== false,
    lancamento_efetivo: sp.lancamento_efetivo !== false, periodo_inicio: sp.periodo_inicio || '', excluir_nomes: (sp.excluir_nomes || []).join('\n') });
  f.cenarios = sp.cenarios.map((c, i) => {
    const x = cenarioVazio(i + 1); x.nome = c.nome; x.pin = { lat: c.pin.lat, lon: c.pin.lon, descricao: c.pin.descricao || '' };
    for (const s of c.sombras || []) {
      if (s.tipo === 'barreira') { const b = OPC.barreiras.find(b => b.nome === s.nome); if (b) x.barreiras.push(b.id); }
      else if (s.tipo === 'raio' && s.estacoes) x.est = { ativo: true, km: s.km, lista: s.estacoes };
      else if (s.tipo === 'raio') x.pontos.push({ km: s.km, lat: s.lat, lon: s.lon, nome: s.nome || '' });
    }
    return x;
  });
  return f;
}

// formulário -> corpo do POST
function corpo() {
  return {
    titulo: F.titulo, tipologia: { area_min: num(F.tipologia.area_min), area_max: num(F.tipologia.area_max), dorms: F.tipologia.dorms },
    raios_km: F.raios_km, min_unidades_projeto: num(F.min_unidades_projeto) ?? 0, excluir_nr: F.excluir_nr, lancamento_efetivo: F.lancamento_efetivo,
    periodo_inicio: F.periodo_inicio || null, excluir_nomes: F.excluir_nomes.split('\n').map(s => s.trim()).filter(Boolean),
    cenarios: F.cenarios.map(c => ({
      nome: c.nome, pin: c.pin,
      sombras: [
        ...c.barreiras.map(id => ({ tipo: 'barreira', id })),
        ...(c.est.ativo && c.est.lista.length ? [{ tipo: 'estacoes', km: num(c.est.km), estacoes: c.est.lista }] : []),
        ...c.pontos.filter(p => p.lat != null).map(p => ({ tipo: 'ponto', km: num(p.km), lat: p.lat, lon: p.lon, nome: p.nome })),
      ],
    })),
  };
}

// conferência no navegador (o servidor confere de novo)
function problemas() {
  const e = [];
  if (!F.titulo.trim()) e.push('Dê um título ao relatório.');
  const a = num(F.tipologia.area_min), b = num(F.tipologia.area_max);
  if (a != null && b != null && a > b) e.push('A área mínima está maior que a máxima.');
  if (a == null && b == null && !F.tipologia.dorms.length) e.push('Sem faixa de área nem dormitórios, o relatório pega todas as tipologias. Se for isso, ignore.');
  if (!F.raios_km.length) e.push('Escolha ao menos um raio.');
  F.cenarios.forEach((c, i) => {
    if (c.pin.lat == null || c.pin.lon == null) e.push(`Ponto ${i + 1}: marque no mapa ou busque o endereço.`);
    if (c.est.ativo && !c.est.lista.length) e.push(`Ponto ${i + 1}: escolha as estações ou desligue a exclusão por estação.`);
    c.pontos.forEach((p, j) => { if (p.lat == null) e.push(`Ponto ${i + 1}: marque no mapa o ponto de exclusão ${j + 1}.`); });
  });
  return e;
}

// ------------------------------------------------------------ telas
const TELA = () => $('#tela');
function marcarNav(r) {
  $('#nav-relatorios').toggleAttribute('aria-current', r === 'relatorios');
  if (r === 'relatorios') $('#nav-relatorios').setAttribute('aria-current', 'page');
}

async function rota() {
  const h = location.hash.replace(/^#\/?/, '');
  const [r, id] = h.split('/');
  marcarNav(r || 'novo');
  window.scrollTo(0, 0);
  if (r === 'relatorios') return telaLista();
  if (r === 'r' && id) return telaVer(id);
  if (r === 'duplicar' && id) {
    try { const x = await api(`/api/relatorios/${id}`); F = specParaForm(x.spec); ATIVO = 0; guardar(); } catch (e) { alert(e.message); }
    history.replaceState(null, '', '#/novo');
  }
  return telaNovo();
}

// ---- novo relatório
function telaNovo() {
  TELA().innerHTML = `
  <div class="novo">
    <div class="col">
      <h1>Novo relatório</h1>
      <section class="card" aria-labelledby="h-recorte">
        <header><h2 id="h-recorte">Recorte</h2><button class="btn texto peq" data-a="limpar">Limpar formulário</button></header>
        <div class="campo largo"><label class="rotulo" for="titulo">Título</label>
          <input id="titulo" data-k="titulo" maxlength="120" placeholder="Ex.: Mercado de 28 a 33 m² · Jardim Matarazzo" value="${esc(F.titulo)}"></div>
        <div class="linha">
          <div class="campo"><label class="rotulo" for="amin">Área privativa mínima (m²)</label><input id="amin" type="number" min="10" max="500" step="0.5" data-k="tipologia.area_min" value="${esc(F.tipologia.area_min)}"></div>
          <div class="campo"><label class="rotulo" for="amax">Área privativa máxima (m²)</label><input id="amax" type="number" min="10" max="500" step="0.5" data-k="tipologia.area_max" value="${esc(F.tipologia.area_max)}"></div>
        </div>
        <div class="campo"><span class="rotulo">Dormitórios <span class="suave">(nenhum marcado = todos)</span></span>
          <div class="chips">${DORMS_OPC.map(([v, t]) => `<button type="button" class="chip" data-a="dorm" data-v="${v}" aria-pressed="${F.tipologia.dorms.includes(v)}">${t}</button>`).join('')}</div></div>
        <div class="campo"><span class="rotulo">Raios em volta de cada ponto <span class="suave">(até ${OPC.max_raios})</span></span>
          <div class="chips">${RAIOS_OPC.map(v => `<button type="button" class="chip" data-a="raio" data-v="${v}" aria-pressed="${F.raios_km.includes(v)}">${v} km</button>`).join('')}</div></div>
        <div class="linha">
          <div class="campo"><label class="rotulo" for="minu">Mínimo de unidades no projeto</label><input id="minu" type="number" min="0" max="5000" data-k="min_unidades_projeto" value="${esc(F.min_unidades_projeto)}">
            <span class="ajuda">Total do empreendimento, todas as tipologias.</span></div>
          <div class="campo"><label class="rotulo" for="ini">Início do período <span class="suave">(opcional)</span></label><input id="ini" type="month" min="2023-12" data-k="periodo_inicio" value="${esc(F.periodo_inicio)}">
            <span class="ajuda">Vazio = desde dez/2023, o começo da base.</span></div>
        </div>
        <label class="check"><input type="checkbox" data-k="excluir_nr" ${F.excluir_nr ? 'checked' : ''}> Excluir empreendimentos NR (não residenciais)</label>
        <label class="check"><input type="checkbox" data-k="lancamento_efetivo" ${F.lancamento_efetivo ? 'checked' : ''}> Lançamento efetivo (mês da primeira venda)</label>
        <div class="campo"><label class="rotulo" for="exc">Excluir empreendimentos pelo nome <span class="suave">(um por linha; vale parte do nome)</span></label>
          <textarea id="exc" data-k="excluir_nomes" placeholder="Ex.: Moremais João Dias">${esc(F.excluir_nomes)}</textarea></div>
      </section>

      <section class="card" aria-labelledby="h-pontos">
        <header><h2 id="h-pontos">Pontos</h2>
          <button class="btn peq" data-a="add-cenario" ${F.cenarios.length >= OPC.max_cenarios ? 'disabled' : ''}>Adicionar ponto</button></header>
        <p class="suave" style="margin:0">Cada ponto vira um cenário no relatório. Digite o endereço e escolha uma sugestão, ou abra o mapa e dê dois cliques no local. Dá para repetir o mesmo endereço com exclusões diferentes.</p>
        <div id="pontos" style="display:flex;flex-direction:column;gap:12px">${F.cenarios.map(htmlCenario).join('')}</div>
      </section>

      <div class="barra-gerar">
        <button class="btn principal" data-a="gerar" id="gerar">Gerar relatório</button>
        <span id="estado" class="suave" role="status"></span>
      </div>
      <div id="avisos"></div>
    </div>
  </div>`;
  ligarForm();
}

function htmlCenario(c, i) {
  const pos = c.pin.lat != null ? `${(+c.pin.lat).toFixed(5)}, ${(+c.pin.lon).toFixed(5)}` : 'sem posição';
  return `<article class="ponto ${i === ATIVO ? 'ativo' : ''}" data-i="${i}">
    <header><span class="num" style="background:${CORES[i]}">${i + 1}</span>
      <div class="campo" style="flex:1"><label class="rotulo" for="nome-${i}">Nome do cenário</label><input id="nome-${i}" data-k="cenarios.${i}.nome" maxlength="60" value="${esc(c.nome)}"></div>
      <button class="btn texto peq" data-a="ativar" data-i="${i}" ${i === ATIVO ? 'disabled' : ''}>${i === ATIVO ? 'Selecionado' : 'Selecionar'}</button>
      ${F.cenarios.length > 1 ? `<button class="icbtn" data-a="del-cenario" data-i="${i}" title="Remover ponto" aria-label="Remover ponto ${i + 1}">✕</button>` : ''}</header>
    <div class="linha">
      <div class="campo" style="flex:3 1 220px"><label class="rotulo" for="end-${i}">Endereço</label><input id="end-${i}" data-k="cenarios.${i}.pin.descricao" data-busca="pin" data-i="${i}" maxlength="160" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" placeholder="Ex.: R. Catarina Álvares, 136, São Paulo" value="${esc(c.pin.descricao)}"></div>
      <button class="btn peq" data-a="mapa" data-i="${i}" ${CFG.maps_key ? '' : 'disabled title="Sem chave do Google Maps"'}>Abrir mapa</button>
    </div>
    <div class="linha">
      <div class="campo"><label class="rotulo" for="lat-${i}">Latitude</label><input id="lat-${i}" type="number" step="0.00001" data-k="cenarios.${i}.pin.lat" value="${esc(c.pin.lat ?? '')}"></div>
      <div class="campo"><label class="rotulo" for="lon-${i}">Longitude</label><input id="lon-${i}" type="number" step="0.00001" data-k="cenarios.${i}.pin.lon" value="${esc(c.pin.lon ?? '')}"></div>
    </div>
    <span class="ajuda suave" style="font-size:12px">Posição: ${pos}</span>
    <div class="sombra">
      <span class="rotulo">Exclusões (sombras)</span>
      ${OPC.barreiras.map(b => `<label class="check"><input type="checkbox" data-a="barreira" data-i="${i}" data-v="${b.id}" ${c.barreiras.includes(b.id) ? 'checked' : ''}> Só o lado do ponto em relação a ${esc(b.nome)}</label>`).join('')}
      <label class="check"><input type="checkbox" data-a="est-ativo" data-i="${i}" ${c.est.ativo ? 'checked' : ''}> Excluir o entorno de estações</label>
      ${c.est.ativo ? `<div class="linha">
          <div class="campo" style="flex:0 1 120px"><label class="rotulo" for="estkm-${i}">Raio (km)</label><input id="estkm-${i}" type="number" min="0.1" max="10" step="0.1" data-k="cenarios.${i}.est.km" value="${esc(c.est.km)}"></div>
          <div class="campo" style="flex:1 1 220px"><label class="rotulo" for="estadd-${i}">Adicionar estação</label><input id="estadd-${i}" list="lista-estacoes" data-a="est-add" data-i="${i}" placeholder="Digite o nome e escolha"></div>
        </div>
        <div class="chips">${c.est.lista.map((n, j) => `<span class="chip" aria-pressed="true">${esc(n)}<button class="x" data-a="est-del" data-i="${i}" data-j="${j}" aria-label="Tirar ${esc(n)}">×</button></span>`).join('') || '<span class="suave">Nenhuma estação escolhida.</span>'}</div>` : ''}
      ${c.pontos.map((p, j) => `<div class="linha">
          <div class="campo" style="flex:2 1 160px"><label class="rotulo" for="pn-${i}-${j}">Excluir em volta de</label><input id="pn-${i}-${j}" data-k="cenarios.${i}.pontos.${j}.nome" maxlength="60" placeholder="Ex.: favela, indústria" value="${esc(p.nome)}"></div>
          <div class="campo" style="flex:0 1 110px"><label class="rotulo" for="pk-${i}-${j}">Raio (km)</label><input id="pk-${i}-${j}" type="number" min="0.1" max="10" step="0.1" data-k="cenarios.${i}.pontos.${j}.km" value="${esc(p.km)}"></div>
          <button class="btn peq" data-a="marcar" data-i="${i}" data-j="${j}">${p.lat != null ? 'Remarcar no mapa' : 'Marcar no mapa'}</button>
          <button class="icbtn" data-a="del-ponto" data-i="${i}" data-j="${j}" aria-label="Tirar exclusão">✕</button>
        </div>`).join('')}
      <div><button class="btn texto peq" data-a="add-ponto" data-i="${i}">Excluir em volta de um ponto do mapa</button></div>
    </div>
  </article>`;
}

function redesenharPontos() { const p = $('#pontos'); if (p) { p.innerHTML = F.cenarios.map(htmlCenario).join(''); $('[data-a="add-cenario"]').disabled = F.cenarios.length >= OPC.max_cenarios; } desenharMapa(); }

function setPath(obj, path, v) { const k = path.split('.'); const last = k.pop(); let o = obj; for (const p of k) o = o[p]; o[last] = v; }

function ligarForm() {
  const t = TELA();
  t.addEventListener('input', e => {
    const el = e.target, k = el.dataset.k;
    if (k) {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (/\.pin\.(lat|lon)$/.test(k)) v = num(v);
      setPath(F, k, v); guardar();
    }
    if (el.dataset.busca) BUSCA.digitou(el);
  });
  t.addEventListener('keydown', e => { if (e.target.dataset?.busca) BUSCA.tecla(e); });
  t.addEventListener('focusout', e => { if (e.target.dataset?.busca) setTimeout(() => BUSCA.fechar(), 150); });
  t.addEventListener('change', e => {
    const el = e.target, a = el.dataset.a, i = +el.dataset.i;
    if (a === 'barreira') { const c = F.cenarios[i]; c.barreiras = el.checked ? [...new Set([...c.barreiras, el.dataset.v])] : c.barreiras.filter(x => x !== el.dataset.v); guardar(); }
    if (a === 'est-ativo') { F.cenarios[i].est.ativo = el.checked; guardar(); redesenharPontos(); }
    if (a === 'est-add') {
      const n = ESTACOES.find(s => s.rotulo === el.value || s.nome.toLowerCase() === el.value.trim().toLowerCase());
      if (n && !F.cenarios[i].est.lista.includes(n.nome)) { F.cenarios[i].est.lista.push(n.nome); guardar(); redesenharPontos(); $(`#estadd-${i}`)?.focus(); }
      else if (!n) el.setCustomValidity('Escolha uma estação da lista'), el.reportValidity(), el.setCustomValidity('');
    }
  });
  t.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'INPUT') return;
    const a = b.dataset.a, i = +b.dataset.i, j = +b.dataset.j;
    if (a === 'dorm' || a === 'raio') {
      const lista = a === 'dorm' ? F.tipologia.dorms : F.raios_km, v = +b.dataset.v, k = lista.indexOf(v);
      if (k >= 0) lista.splice(k, 1); else if (a === 'raio' && lista.length >= OPC.max_raios) return aviso(`No máximo ${OPC.max_raios} raios.`); else lista.push(v);
      lista.sort((x, y) => x - y); b.setAttribute('aria-pressed', String(k < 0)); guardar(); desenharMapa(); return;
    }
    if (a === 'add-cenario') { const n = F.cenarios.length; const c = cenarioVazio(n + 1); F.cenarios.push(c); ATIVO = n; guardar(); redesenharPontos(); $(`#nome-${n}`)?.select(); return; }
    if (a === 'del-cenario') { F.cenarios.splice(i, 1); ATIVO = Math.min(ATIVO, F.cenarios.length - 1); MODO = null; guardar(); redesenharPontos(); return; }
    if (a === 'ativar') { ATIVO = i; redesenharPontos(); return; }
    if (a === 'mapa') return abrirMapa({ i });
    if (a === 'est-del') { F.cenarios[i].est.lista.splice(j, 1); guardar(); redesenharPontos(); return; }
    if (a === 'add-ponto') { F.cenarios[i].pontos.push({ km: 1, lat: null, lon: null, nome: '' }); ATIVO = i; guardar(); redesenharPontos(); return abrirMapa({ i, j: F.cenarios[i].pontos.length - 1 }); }
    if (a === 'del-ponto') { F.cenarios[i].pontos.splice(j, 1); MODO = null; guardar(); redesenharPontos(); return; }
    if (a === 'marcar') return abrirMapa({ i, j });
    if (a === 'limpar') { if (confirmar('Limpar o formulário inteiro?')) { F = formVazio(); ATIVO = 0; MODO = null; guardar(); telaNovo(); } return; }
    if (a === 'gerar') return gerar();
  });
  // clicar num cartão de ponto seleciona o ponto
  t.addEventListener('focusin', e => { const p = e.target.closest('.ponto'); if (p && +p.dataset.i !== ATIVO) { ATIVO = +p.dataset.i; document.querySelectorAll('.ponto').forEach(x => x.classList.toggle('ativo', +x.dataset.i === ATIVO)); document.querySelectorAll('[data-a="ativar"]').forEach(x => { const s = +x.dataset.i === ATIVO; x.disabled = s; x.textContent = s ? 'Selecionado' : 'Selecionar'; }); } });
}
// confirm() nativo trava automações de teste; aqui só é usado para uma ação destrutiva do próprio usuário
function confirmar(msg) { return window.confirm(msg); }

function aviso(msg, tipo = 'atencao') { const d = $('#avisos'); if (!d) return; d.innerHTML = msg ? `<div class="${tipo === 'erro' ? 'erro' : 'selo atencao'}" style="display:block;padding:10px 14px">${msg}</div>` : ''; }

async function gerar() {
  const p = problemas(), duros = p.filter(x => !x.startsWith('Sem faixa'));
  if (duros.length) return aviso('<b>Falta pouco:</b><ul style="margin:6px 0 0;padding-left:18px">' + duros.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>');
  aviso('');
  const b = $('#gerar'), st = $('#estado');
  b.disabled = true; b.innerHTML = '<span class="girando" aria-hidden="true"></span> Gerando…';
  st.textContent = 'O cálculo leva de 10 s a 1 min (mais na primeira vez do dia).';
  try {
    const x = await api('/api/relatorios', { method: 'POST', body: JSON.stringify(corpo()) });
    location.hash = `#/r/${x.id}`;
  } catch (e) {
    aviso(esc(e.message), 'erro');
  } finally { b.disabled = false; b.textContent = 'Gerar relatório'; st.textContent = ''; }
}

// ---- Google Maps: busca de endereço (sugestões) e mapa em janela (pedido do Moises, 17/nov/2026)
// O mapa não fica na tela: abre numa janela grande com busca; o local é escolhido com dois cliques e confirmado.
let MAPA = null, MARCAS = [], GEOCODER = null, PROVISORIO = null, ESCOLHA = null;
async function carregarMaps() {
  if (window.google?.maps?.Map) return true;
  if (!CFG.maps_key) return false;
  if (!window.__bkmMaps) window.__bkmMaps = new Promise((ok, falha) => {
    window.__bkmMapsPronto = () => ok(true);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.maps_key)}&callback=__bkmMapsPronto&libraries=places&language=pt-BR&region=BR&v=weekly&loading=async`;
    s.async = true; s.onerror = () => { window.__bkmMaps = null; falha(new Error('Google Maps não carregou')); }; document.head.appendChild(s);
  });
  return window.__bkmMaps;
}
const limpaEnd = e => (e || '').replace(/, Brasil$/, '').replace(/, \d{5}-\d{3}$/, '');

// Sugestões de endereço (Places, como na busca do Google). Uma lista só, presa ao campo em foco.
const BUSCA = (() => {
  let campo = null, itens = [], sel = -1, timer = null, token = null, seq = 0;
  const lista = document.createElement('ul'); lista.className = 'sugestoes'; lista.setAttribute('role', 'listbox'); lista.hidden = true; lista.id = 'sugestoes';
  lista.addEventListener('mousedown', e => e.preventDefault()); // não tira o foco do campo
  lista.addEventListener('click', e => { const li = e.target.closest('li[data-n]'); if (li) escolher(+li.dataset.n); });
  function posicionar() {
    const host = campo.closest('dialog') || document.body; if (lista.parentNode !== host) host.appendChild(lista);
    const r = campo.getBoundingClientRect(); Object.assign(lista.style, { left: r.left + 'px', top: (r.bottom + 4) + 'px', width: Math.max(r.width, 320) + 'px' });
  }
  function desenhar() {
    if (!itens.length) return fechar();
    lista.innerHTML = itens.map((p, n) => `<li role="option" data-n="${n}" aria-selected="${n === sel}"><b>${esc(p.mainText?.text || p.text?.text || '')}</b><span>${esc(p.secondaryText?.text || '')}</span></li>`).join('');
    posicionar(); lista.hidden = false; campo.setAttribute('aria-expanded', 'true'); campo.setAttribute('aria-controls', lista.id);
  }
  function fechar() { lista.hidden = true; itens = []; sel = -1; campo?.setAttribute('aria-expanded', 'false'); }
  async function buscar(q, n) {
    try {
      if (!await carregarMaps()) return;
      const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary('places');
      token = token || new AutocompleteSessionToken();
      const centro = MAPA && MODO ? MAPA.getCenter() : { lat: -23.55, lng: -46.63 };
      const r = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: q, sessionToken: token, includedRegionCodes: ['br'], language: 'pt-BR', region: 'br', locationBias: { center: centro, radius: 50000 } });
      if (n !== seq) return; // chegou depois de outra digitação
      itens = r.suggestions.map(x => x.placePrediction).filter(Boolean).slice(0, 6); sel = -1; desenhar();
    } catch (e) { console.warn('sugestões', e); }
  }
  async function escolher(n) {
    const p = itens[n], c = campo; fechar(); if (!p) return;
    try {
      const pl = p.toPlace(); await pl.fetchFields({ fields: ['location', 'formattedAddress', 'displayName', 'types'] }); token = null;
      const lat = +pl.location.lat().toFixed(6), lon = +pl.location.lng().toFixed(6);
      const nome = pl.types?.includes('street_address') || pl.types?.includes('premise') || pl.types?.includes('route') ? '' : pl.displayName;
      const end = limpaEnd(pl.formattedAddress); const desc = nome && !end.startsWith(nome) ? `${nome}, ${end}` : end;
      if (c.dataset.busca === 'pin') { const i = +c.dataset.i, x = F.cenarios[i]; x.pin = { lat, lon, descricao: desc }; ATIVO = i; guardar(); redesenharPontos(); aviso(''); }
      else if (c.dataset.busca === 'janela') { c.value = desc; irPara(lat, lon, desc); }
    } catch (e) { aviso('A busca falhou: ' + esc(e.message || ''), 'erro'); }
  }
  return {
    digitou(el) {
      campo = el; clearTimeout(timer); const q = el.value.trim();
      if (q.length < 3) return fechar();
      const n = ++seq; timer = setTimeout(() => buscar(q, n), 250);
    },
    tecla(e) {
      campo = e.target;
      if (lista.hidden) { if (e.key === 'Enter' && campo.dataset.busca === 'janela') { e.preventDefault(); geocodificar(campo.value); } return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : itens.length - 1)) % itens.length; desenhar(); }
      else if (e.key === 'Enter') { e.preventDefault(); escolher(sel < 0 ? 0 : sel); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); }
    },
    fechar,
  };
})();

// Enter sem sugestão na janela: geocodifica o texto como está
async function geocodificar(q) {
  q = (q || '').trim(); if (!q || !GEOCODER) return;
  try {
    const r = await GEOCODER.geocode({ address: q, region: 'br', componentRestrictions: { country: 'BR' } });
    const g = r.results?.[0]; if (!g) return dica('Endereço não encontrado.');
    irPara(g.geometry.location.lat(), g.geometry.location.lng(), limpaEnd(g.formatted_address));
  } catch (e) { dica('A busca falhou.'); }
}

// ---- janela do mapa
function dica(t) { const d = $('#mapa-dica'); if (d) d.textContent = t; }
function textoDica() { return MODO?.j != null ? 'Dê dois cliques no centro da área a excluir.' : 'Dê dois cliques no local do ponto. Use a busca para chegar perto.'; }
function janela() {
  let d = $('#janela-mapa'); if (d) return d;
  d = document.createElement('dialog'); d.id = 'janela-mapa'; d.className = 'janela-mapa'; d.setAttribute('aria-labelledby', 'janela-tit');
  d.innerHTML = `<header><h2 id="janela-tit">Escolher no mapa</h2>
      <div class="campo busca"><input id="janela-busca" data-busca="janela" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-label="Buscar endereço ou lugar" placeholder="Buscar endereço ou lugar"></div>
      <button class="icbtn" data-j="fechar" aria-label="Fechar" title="Fechar">✕</button></header>
    <div class="janela-corpo"><div id="mapa"></div>
      <div class="mapa-aviso" id="mapa-dica" role="status"></div>
      <div class="confirma" id="confirma" hidden role="alertdialog" aria-labelledby="confirma-tit" aria-describedby="confirma-end">
        <h3 id="confirma-tit">Selecionar este endereço?</h3><p id="confirma-end"></p><p class="suave" id="confirma-pos"></p>
        <div class="acoes"><button class="btn texto" data-j="cancelar">Cancelar</button><button class="btn principal" data-j="ok">Selecionar</button></div></div></div>`;
  document.body.appendChild(d);
  const busca = $('#janela-busca', d);
  busca.addEventListener('input', () => BUSCA.digitou(busca));
  busca.addEventListener('keydown', e => BUSCA.tecla(e));
  busca.addEventListener('blur', () => setTimeout(() => BUSCA.fechar(), 150));
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-j]'); if (!b) return;
    if (b.dataset.j === 'fechar') d.close();
    if (b.dataset.j === 'cancelar') cancelarEscolha();
    if (b.dataset.j === 'ok') confirmarEscolha();
  });
  d.addEventListener('cancel', e => { if (!$('#confirma').hidden) { e.preventDefault(); cancelarEscolha(); } });
  d.addEventListener('close', () => { BUSCA.fechar(); cancelarEscolha(); MODO = null; redesenharPontos(); });
  return d;
}
async function abrirMapa(modo) {
  let ok = false; try { ok = await carregarMaps(); } catch { ok = false; }
  if (!ok) return aviso('O mapa não carregou (sem a chave do Google Maps). Informe latitude e longitude do ponto.', 'erro');
  MODO = modo; ATIVO = modo.i;
  const d = janela(), c = F.cenarios[modo.i];
  $('#janela-tit').textContent = modo.j != null ? `Ponto ${modo.i + 1} · centro da exclusão ${modo.j + 1}` : (c.nome && c.nome !== `Ponto ${modo.i + 1}` ? `Ponto ${modo.i + 1} · ${c.nome}` : `Ponto ${modo.i + 1}`);
  $('#janela-busca').value = '';
  d.showModal();
  if (!MAPA) {
    MAPA = new google.maps.Map($('#mapa'), { center: { lat: -23.55, lng: -46.63 }, zoom: 11, disableDoubleClickZoom: true, clickableIcons: false,
      streetViewControl: false, mapTypeControl: true, mapTypeControlOptions: { position: google.maps.ControlPosition.LEFT_BOTTOM }, fullscreenControl: false });
    GEOCODER = new google.maps.Geocoder();
    MAPA.addListener('dblclick', ev => propor(ev.latLng.lat(), ev.latLng.lng()));
  }
  cancelarEscolha(); desenharMapa();
  const alvo = modo.j != null && c.pontos[modo.j]?.lat != null ? { lat: c.pontos[modo.j].lat, lng: c.pontos[modo.j].lon } : c.pin.lat != null ? { lat: +c.pin.lat, lng: +c.pin.lon } : null;
  if (alvo) { MAPA.setCenter(alvo); MAPA.setZoom(modo.j != null ? 14 : 15); } else { MAPA.setCenter({ lat: -23.55, lng: -46.63 }); MAPA.setZoom(11); }
  dica(textoDica());
  setTimeout(() => $('#janela-busca').focus(), 50);
}
function irPara(lat, lon, desc) {
  MAPA.panTo({ lat, lng: lon }); MAPA.setZoom(17);
  if (PROVISORIO) PROVISORIO.setMap(null);
  PROVISORIO = new google.maps.Marker({ map: MAPA, position: { lat, lng: lon }, title: desc, opacity: .75 });
  dica(`Achei "${desc}". Dê dois cliques no local exato para selecionar.`);
}
async function propor(lat, lon) {
  lat = +lat.toFixed(6); lon = +lon.toFixed(6); ESCOLHA = { lat, lon, descricao: '' };
  if (PROVISORIO) PROVISORIO.setMap(null);
  PROVISORIO = new google.maps.Marker({ map: MAPA, position: { lat, lng: lon }, zIndex: 50 });
  const cx = $('#confirma'), ex = MODO?.j != null;
  $('#confirma-tit').textContent = ex ? 'Usar este local como centro da exclusão?' : 'Selecionar este endereço?';
  $('#confirma-end').textContent = 'Buscando o endereço…'; $('#confirma-pos').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  cx.hidden = false; $('[data-j="ok"]', cx).focus();
  try {
    const r = await GEOCODER.geocode({ location: { lat, lng: lon } });
    const end = limpaEnd(r.results?.[0]?.formatted_address);
    if (ESCOLHA?.lat === lat && ESCOLHA?.lon === lon) { ESCOLHA.descricao = end; $('#confirma-end').textContent = end || 'Sem endereço para este local.'; }
  } catch { if (ESCOLHA?.lat === lat) $('#confirma-end').textContent = 'Sem endereço para este local.'; }
}
function cancelarEscolha() { ESCOLHA = null; const cx = $('#confirma'); if (cx) cx.hidden = true; if (PROVISORIO) { PROVISORIO.setMap(null); PROVISORIO = null; } if (MODO) dica(textoDica()); }
function confirmarEscolha() {
  if (!ESCOLHA || !MODO) return;
  const c = F.cenarios[MODO.i];
  if (MODO.j != null) { const p = c.pontos[MODO.j]; if (p) { p.lat = ESCOLHA.lat; p.lon = ESCOLHA.lon; if (!p.nome && ESCOLHA.descricao) p.nome = ESCOLHA.descricao.split(',')[0].slice(0, 60); } }
  else c.pin = { lat: ESCOLHA.lat, lon: ESCOLHA.lon, descricao: ESCOLHA.descricao || c.pin.descricao };
  guardar(); $('#janela-mapa').close();
}
function desenharMapa() {
  if (!MAPA || !MODO) return;
  MARCAS.forEach(m => m.setMap(null)); MARCAS = [];
  F.cenarios.forEach((c, i) => {
    if (c.pin.lat == null || c.pin.lon == null) return;
    const pos = { lat: +c.pin.lat, lng: +c.pin.lon };
    MARCAS.push(new google.maps.Marker({ map: MAPA, position: pos, clickable: false, label: { text: String(i + 1), color: '#fff', fontWeight: '700' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: CORES[i], fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }, zIndex: i === ATIVO ? 10 : 1 }));
    if (i !== ATIVO) return;
    for (const r of F.raios_km) MARCAS.push(new google.maps.Circle({ map: MAPA, center: pos, radius: r * 1000, strokeColor: CORES[i], strokeOpacity: .8, strokeWeight: 1.5, fillOpacity: 0, clickable: false }));
    for (const s of c.est.ativo ? c.est.lista : []) for (const e of ESTACOES.filter(e => e.nome === s))
      MARCAS.push(new google.maps.Circle({ map: MAPA, center: { lat: e.lat, lng: e.lon }, radius: (num(c.est.km) || 0) * 1000, strokeColor: '#b3261e', strokeOpacity: .7, strokeWeight: 1, fillColor: '#b3261e', fillOpacity: .08, clickable: false }));
    for (const p of c.pontos) if (p.lat != null)
      MARCAS.push(new google.maps.Circle({ map: MAPA, center: { lat: p.lat, lng: p.lon }, radius: (num(p.km) || 0) * 1000, strokeColor: '#b3261e', strokeOpacity: .7, strokeWeight: 1, fillColor: '#b3261e', fillOpacity: .08, clickable: false }));
  });
}

// ---- lista
async function telaLista() {
  TELA().innerHTML = `<div style="display:flex;flex-direction:column;gap:16px">
    <div class="linha" style="align-items:center"><h1 style="flex:1">Relatórios</h1>
      <div class="chips"><button class="chip" data-f="todos" aria-pressed="true">Todos</button><button class="chip" data-f="meus" aria-pressed="false">Meus</button></div></div>
    <div id="lista"><p class="suave">Carregando…</p></div></div>`;
  let meus = false;
  const carregar = async () => {
    try {
      const L = await api('/api/relatorios' + (meus ? '?meus=true' : ''));
      $('#lista').innerHTML = L.length ? `<div class="tabela-box"><table class="tabela"><thead><tr><th>Título</th><th class="esconde">Pontos</th><th class="esconde">Quem gerou</th><th>Quando</th><th></th></tr></thead><tbody>
        ${L.map(x => `<tr><td><a href="#/r/${x.id}">${esc(x.titulo)}</a></td>
          <td class="esconde">${esc((x.spec?.cenarios || []).map(c => c.nome).join(' · '))}</td>
          <td class="esconde">${esc(x.autor_nome || x.autor)}</td><td>${fmtData(x.criado_em)}</td>
          <td><div class="acoes"><a class="btn peq" href="/r/${x.id}.pdf">PDF</a><a class="btn texto peq" href="#/duplicar/${x.id}">Duplicar</a></div></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="suave">Nenhum relatório ainda. Use "Novo relatório".</p>';
    } catch (e) { $('#lista').innerHTML = `<div class="erro">${esc(e.message)}</div>`; }
  };
  TELA().querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
    meus = b.dataset.f === 'meus'; TELA().querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); carregar();
  }));
  carregar();
}

// ---- relatório aberto
async function telaVer(id) {
  TELA().innerHTML = `<div class="ver"><header><h1 id="ver-tit">Relatório</h1>
    <a class="btn principal" id="pdf" href="/r/${esc(id)}.pdf">Baixar PDF</a>
    <a class="btn" href="/r/${esc(id)}" target="_blank" rel="noopener">Abrir em nova aba</a>
    <a class="btn texto" href="#/duplicar/${esc(id)}">Duplicar e ajustar</a></header>
    <p class="suave" id="ver-sub" style="margin:0"></p>
    <iframe src="/r/${esc(id)}" title="Relatório"></iframe></div>`;
  $('#pdf').addEventListener('click', e => {
    const b = e.currentTarget; if (b.dataset.ocupado) return e.preventDefault();
    b.dataset.ocupado = '1'; const t = b.textContent; b.innerHTML = '<span class="girando" aria-hidden="true"></span> Preparando o PDF…';
    setTimeout(() => { b.textContent = t; delete b.dataset.ocupado; }, 15000);
  });
  try {
    const x = await api(`/api/relatorios/${id}`);
    $('#ver-tit').textContent = x.titulo;
    $('#ver-sub').textContent = `Gerado por ${x.autor_nome || x.autor} em ${fmtData(x.criado_em)}.`;
    document.title = `${x.titulo} · Relatórios de mercado BKM`;
  } catch (e) { $('#ver-sub').textContent = e.message; }
}

// ------------------------------------------------------------ início
async function iniciar() {
  menus();
  try {
    [CFG, OPC, ESTACOES] = await Promise.all([api('/api/eu'), api('/api/opcoes'), fetch('/dados/estacoes.json').then(r => r.json())]);
  } catch (e) { TELA().innerHTML = `<div class="erro">${esc(e.message)}</div>`; return; }
  const visto = new Map();
  for (const e of ESTACOES) { const k = e.nome; const emp = { METRO: 'Metrô', CPTM: 'CPTM', VIAMOBILIDADE: 'ViaMobilidade', VIAQUATRO: 'ViaQuatro' }[e.empresa] || e.empresa; e.rotulo = `${k} · ${emp} ${e.linha.toLowerCase()}`; if (!visto.has(e.rotulo)) visto.set(e.rotulo, e); }
  $('#lista-estacoes').innerHTML = [...visto.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(r => `<option value="${esc(r)}"></option>`).join('');
  const eu = CFG.eu || {};
  $('#eu-nome').textContent = eu.nome || ''; $('#eu-email').textContent = eu.email || '';
  $('#avatar').innerHTML = eu.foto ? `<img src="${esc(eu.foto)}" alt="" referrerpolicy="no-referrer">` : esc((eu.nome || eu.email || '?')[0].toUpperCase());
  if (CFG.ambiente === 'dev') { $('#selo-dev').hidden = false; document.title = '[DEV] ' + document.title; }
  addEventListener('hashchange', rota);
  rota();
}
iniciar();
