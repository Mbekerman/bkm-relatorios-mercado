"""App de relatórios de mercado da BKM: login Google (@bkm.com.br), formulário, relatório e PDF.

O cálculo fica no serviço de inteligência de mercado (repo bkm-inteligencia-mercado, POST /relatorio).
Este servidor guarda a chave daquele serviço (o navegador nunca a vê), valida a spec, registra o histórico
e gera o PDF.

Rotas (todas pedem sessão, menos /saude, /auth/* e os arquivos do login):
  GET  /                      a página do app (sem sessão: tela de entrar)
  GET  /auth/entrar           vai ao Google        GET /auth/retorno   volta do Google
  POST /auth/sair
  GET  /api/eu                quem está logado e a configuração da página
  GET  /api/opcoes            barreiras e estações para as sombras
  POST /api/relatorios        gera (corpo = formulário)      GET /api/relatorios   histórico
  GET  /r/<id>                a página do relatório          GET /r/<id>.pdf       o PDF
"""
import datetime, os, re, unicodedata, urllib.parse
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

import config, sessao, spec as specmod
from guarda import Guarda

RAIZ = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(RAIZ, '..', 'web')
ID_RE = re.compile(r'^[0-9a-f]{32}$')

app = FastAPI(title='BKM Relatórios de Mercado', docs_url=None, redoc_url=None, openapi_url=None)
GUARDA = None


def guarda():
    global GUARDA
    if GUARDA is None:
        GUARDA = Guarda()
    return GUARDA


ABERTAS = ('/saude', '/auth/', '/entrar', '/marca/', '/favicon.svg', '/app.css')


@app.middleware('http')
async def autenticar(req: Request, prox):
    req.state.eu = sessao.ler_sessao(req.cookies.get(sessao.COOKIE))
    p = req.url.path
    if req.state.eu is None and not (p == '/' or p.startswith(ABERTAS)):
        if p.startswith('/api/'):
            return JSONResponse({'erro': 'sessão expirada, entre de novo'}, 401)
        return RedirectResponse('/auth/entrar?voltar=' + urllib.parse.quote(p), 302)
    resp = await prox(req)
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('Referrer-Policy', 'same-origin')
    if not p.startswith('/r/'):
        resp.headers.setdefault('X-Frame-Options', 'DENY')
    return resp


def _base(req):
    return config.URL_PUBLICA or str(req.base_url).rstrip('/')


def _cookie(resp, nome, valor, max_age):
    resp.set_cookie(nome, valor, max_age=max_age, httponly=True, samesite='lax',
                    secure=not _local(), path='/')


def _local():
    return bool(config.LOGIN_FALSO)


# ---------------------------------------------------------------- páginas
@app.get('/saude')
def saude():
    return {'ok': True}


@app.get('/')
def inicio(req: Request):
    return FileResponse(os.path.join(WEB, 'index.html' if req.state.eu else 'entrar.html'),
                        headers={'Cache-Control': 'no-cache'})


@app.get('/entrar')
def entrar_pagina():
    return FileResponse(os.path.join(WEB, 'entrar.html'), headers={'Cache-Control': 'no-cache'})


# ---------------------------------------------------------------- login
@app.get('/auth/entrar')
def auth_entrar(req: Request, voltar: str = '/'):
    if config.LOGIN_FALSO:
        resp = RedirectResponse(voltar if voltar.startswith('/') and not voltar.startswith('//') else '/', 302)
        _cookie(resp, sessao.COOKIE, sessao.criar_sessao(config.LOGIN_FALSO, 'Teste local'), int(config.SESSAO_HORAS * 3600))
        return resp
    url, ck = sessao.inicio_login(_base(req) + '/auth/retorno', voltar)
    resp = RedirectResponse(url, 302)
    _cookie(resp, sessao.COOKIE_LOGIN, ck, 600)
    return resp


@app.get('/auth/retorno')
async def auth_retorno(req: Request, code: str = '', state: str = '', error: str = ''):
    ini = sessao.ler_inicio(req.cookies.get(sessao.COOKIE_LOGIN))
    if error or not code or not ini or state != ini['state']:
        return RedirectResponse('/entrar?erro=login', 302)
    try:
        info = await sessao.trocar_codigo(code, _base(req) + '/auth/retorno')
    except Exception as e:
        print({'severity': 'WARNING', 'login': 'falhou', 'erro': type(e).__name__}, flush=True)
        return RedirectResponse('/entrar?erro=login', 302)
    motivo = sessao.conferir_claims(info) or (None if info.get('nonce') == ini['nonce'] else 'nonce')
    if motivo:
        print({'severity': 'WARNING', 'login': 'recusado', 'motivo': motivo}, flush=True)
        return RedirectResponse('/entrar?erro=dominio', 302)
    resp = RedirectResponse(ini['voltar'], 302)
    _cookie(resp, sessao.COOKIE, sessao.criar_sessao(info['email'].lower(), info.get('name', ''), info.get('picture', '')),
            int(config.SESSAO_HORAS * 3600))
    resp.delete_cookie(sessao.COOKIE_LOGIN, path='/')
    return resp


@app.post('/auth/sair')
def auth_sair():
    resp = JSONResponse({'ok': True})
    resp.delete_cookie(sessao.COOKIE, path='/')
    return resp


# ---------------------------------------------------------------- API
@app.get('/api/eu')
def eu(req: Request):
    return {'eu': req.state.eu, 'maps_key': config.GOOGLE_MAPS_KEY, 'ambiente': config.AMBIENTE}


@app.get('/api/opcoes')
def opcoes():
    return {'barreiras': [{'id': k, 'nome': v['nome']} for k, v in specmod.BARREIRAS.items()],
            'max_cenarios': specmod.MAX_CENARIOS, 'max_raios': specmod.MAX_RAIOS}


async def _mercado(metodo, caminho, **kw):
    if not config.MERCADO_URL:
        raise HTTPException(503, 'serviço de mercado não configurado (MERCADO_URL)')
    h = {'Authorization': f'Bearer {config.MERCADO_CHAVE}'}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=15)) as c:
            return await c.request(metodo, config.MERCADO_URL + caminho, headers=h, **kw)
    except httpx.HTTPError as e:
        raise HTTPException(502, f'serviço de mercado não respondeu ({type(e).__name__})')


@app.post('/api/relatorios')
async def gerar(req: Request):
    try:
        sp = specmod.montar(await req.json())
    except specmod.SpecInvalida as e:
        raise HTTPException(400, str(e))
    except ValueError:
        raise HTTPException(400, 'pedido inválido')
    r = await _mercado('POST', '/relatorio', json=sp)
    if r.status_code == 401:
        raise HTTPException(502, 'a chave deste app foi recusada pelo serviço de mercado')
    if r.status_code >= 400:
        try: det = r.json().get('detail') or r.json().get('erro')
        except ValueError: det = r.text[:300]
        raise HTTPException(502 if r.status_code >= 500 else 400, f'o serviço de mercado recusou: {det}')
    res = r.json()
    rid = res['id']
    if not ID_RE.match(rid):
        raise HTTPException(502, 'resposta inesperada do serviço de mercado')
    item = {'id': rid, 'titulo': sp['titulo'], 'criado_em': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
            'autor': req.state.eu['email'], 'autor_nome': req.state.eu.get('nome', ''), 'spec': sp,
            'meta': res.get('meta'), 'resumo': res.get('resumo')}
    guarda().registrar(item)
    return item


@app.get('/api/relatorios')
def historico(meus: bool = False, req: Request = None):
    itens = guarda().listar()
    if meus:
        itens = [x for x in itens if x.get('autor') == req.state.eu['email']]
    return [{k: x.get(k) for k in ('id', 'titulo', 'criado_em', 'autor', 'autor_nome', 'spec')} for x in itens]


@app.get('/api/relatorios/{rid}')
def um(rid: str):
    if not ID_RE.match(rid) or not (x := guarda().item(rid)):
        raise HTTPException(404, 'relatório não encontrado')
    return x


async def _html(rid):
    if not ID_RE.match(rid) or not guarda().item(rid):
        raise HTTPException(404, 'relatório não encontrado')
    r = await _mercado('GET', f'/relatorios/{rid}')
    if r.status_code != 200:
        raise HTTPException(404 if r.status_code == 404 else 502, 'relatório não encontrado no serviço de mercado')
    return r.text


@app.get('/r/{rid}.pdf')
async def ver_pdf(rid: str):
    import pdf
    dados = guarda().pdf(rid) if ID_RE.match(rid) else None
    if dados is None:
        dados = await pdf.gerar(await _html(rid))
        guarda().guardar_pdf(rid, dados)
    item = guarda().item(rid) or {}
    return Response(dados, media_type='application/pdf',
                    headers={'Content-Disposition': nome_arquivo(item.get('titulo', '')), 'Cache-Control': 'private, max-age=3600'})


def nome_arquivo(titulo):
    """Content-Disposition com nome ASCII de reserva e o nome em UTF-8 (RFC 6266), para títulos com acento e m²."""
    base = re.sub(r'[\\/:*?"<>|\r\n]+', '', titulo).strip()[:100] or 'relatorio'
    ascii_ = unicodedata.normalize('NFKD', base).encode('ascii', 'ignore').decode()
    ascii_ = re.sub(r'[^A-Za-z0-9._ -]+', '', ascii_).strip().replace(' ', '-') or 'relatorio'
    return f"attachment; filename=\"{ascii_}.pdf\"; filename*=UTF-8''{urllib.parse.quote(base + '.pdf')}"


@app.get('/r/{rid}', response_class=HTMLResponse)
async def ver(rid: str):
    return HTMLResponse(await _html(rid), headers={'Cache-Control': 'private, max-age=3600',
                                                   'X-Frame-Options': 'SAMEORIGIN'})


app.mount('/', StaticFiles(directory=WEB), name='web')
