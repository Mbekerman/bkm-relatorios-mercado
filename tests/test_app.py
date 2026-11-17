"""Testes do servidor: login (regras do domínio), validação da spec e o fluxo gerar -> histórico -> ver.

O serviço de mercado é trocado pelo falso (tests/mercado_falso.py) via transporte ASGI do httpx.
Rodar: python3 -m pytest tests -q
"""
import os, sys, tempfile
import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(RAIZ, 'servidor'), os.path.join(RAIZ, 'tests')]
os.environ.update(SESSAO_SEGREDO='segredo-de-teste', MERCADO_URL='http://mercado', MERCADO_CHAVE='teste',
                  PASTA_LOCAL=tempfile.mkdtemp(), GOOGLE_CLIENT_ID='cid')

import httpx
from fastapi.testclient import TestClient
import app as appmod, sessao, spec as specmod, mercado_falso


# ---------------------------------------------------------------- login
def test_claims_exigem_workspace_bkm():
    ok = {'hd': 'bkm.com.br', 'email_verified': True, 'email': 'fulano@bkm.com.br'}
    assert sessao.conferir_claims(ok) is None
    # conta pessoal do Google com e-mail @bkm.com.br: sem hd
    assert sessao.conferir_claims({**ok, 'hd': None})
    assert sessao.conferir_claims({**ok, 'hd': 'outra.com.br'})
    assert sessao.conferir_claims({**ok, 'email_verified': False})
    assert sessao.conferir_claims({**ok, 'email': 'fulano@bkm.com.br.evil.com'})


def test_sessao_assinada_e_do_dominio():
    v = sessao.criar_sessao('a@bkm.com.br', 'A')
    assert sessao.ler_sessao(v)['email'] == 'a@bkm.com.br'
    assert sessao.ler_sessao(v + 'x') is None
    assert sessao.ler_sessao(sessao.criar_sessao('a@gmail.com', 'A')) is None


def test_voltar_so_para_o_proprio_site():
    _, ck = sessao.inicio_login('https://app/auth/retorno', '//evil.com')
    assert sessao.ler_inicio(ck)['voltar'] == '/'


# ---------------------------------------------------------------- spec
def form(**kw):
    f = {'titulo': 'Teste', 'tipologia': {'area_min': 28, 'area_max': 33, 'dorms': [2]}, 'raios_km': [5, 3],
         'min_unidades_projeto': 80, 'cenarios': [{'nome': 'A', 'pin': {'lat': -23.49, 'lon': -46.48, 'descricao': 'R. X'},
                                                    'sombras': [{'tipo': 'barreira', 'id': 'rio-pinheiros'},
                                                                {'tipo': 'estacoes', 'km': 1.5, 'estacoes': ['corinthians itaquera']},
                                                                {'tipo': 'ponto', 'km': 1, 'lat': -23.5, 'lon': -46.5, 'nome': 'Y'}]}]}
    f.update(kw)
    return f


def test_spec_montada():
    s = specmod.montar(form())
    assert s['raios_km'] == [3, 5]
    assert s['tipologia'] == {'finalidade': 'Residencial', 'area_min': 28, 'area_max': 33, 'dorms': [2]}
    sb = s['cenarios'][0]['sombras']
    assert sb[0] == {'tipo': 'barreira', 'nome': 'Marginal Pinheiros / Rio Jurubatuba', 'geojson': 'geo/barreiras/rio-pinheiros-jurubatuba.json'}
    assert [specmod._norm(n) for n in sb[1]['estacoes']] == ['CORINTHIANSITAQUERA']
    assert sb[2] == {'tipo': 'raio', 'km': 1, 'lat': -23.5, 'lon': -46.5, 'nome': 'Y'}


@pytest.mark.parametrize('ruim', [
    {'cenarios': []},
    {'raios_km': [1, 2, 3, 5]},
    {'tipologia': {'area_min': 40, 'area_max': 30}},
    {'cenarios': [{'nome': 'A', 'pin': {'lat': 10, 'lon': -46.5}}]},  # fora da base
    {'cenarios': [{'nome': 'A', 'pin': {'lat': -23.5, 'lon': -46.5}, 'sombras': [{'tipo': 'barreira', 'id': '/etc/passwd'}]}]},
    {'cenarios': [{'nome': 'A', 'pin': {'lat': -23.5, 'lon': -46.5}, 'sombras': [{'tipo': 'estacoes', 'km': 1, 'estacoes': ['Não Existe']}]}]},
    {'cenarios': [{'nome': 'A', 'pin': {'lat': -23.5, 'lon': -46.5}, 'sombras': [{'tipo': 'poligono', 'geojson': '/x'}]}]},
    {'periodo_inicio': '2024-13'},
    {'titulo': ''},
])
def test_spec_recusa(ruim):
    with pytest.raises(specmod.SpecInvalida):
        specmod.montar(form(**ruim))


# ---------------------------------------------------------------- fluxo
@pytest.fixture
def cli(monkeypatch):
    transporte = httpx.ASGITransport(app=mercado_falso.app)
    original = httpx.AsyncClient

    def cliente(*a, **kw):
        kw['transport'] = transporte
        return original(*a, **kw)
    monkeypatch.setattr(appmod.httpx, 'AsyncClient', cliente)
    c = TestClient(appmod.app)
    return c


def entrar(c, email='fulano@bkm.com.br'):
    c.cookies.set(sessao.COOKIE, sessao.criar_sessao(email, 'Fulano'))


def test_sem_sessao(cli):
    assert cli.get('/api/relatorios').status_code == 401
    r = cli.get('/r/' + 'a' * 32, follow_redirects=False)
    assert r.status_code == 302 and r.headers['location'].startswith('/auth/entrar')
    assert 'Entrar com o Google' in cli.get('/').text
    assert cli.get('/app.js', follow_redirects=False).status_code == 302


def test_gerar_listar_ver(cli):
    entrar(cli)
    r = cli.post('/api/relatorios', json=form())
    assert r.status_code == 200, r.text
    rid = r.json()['id']
    assert mercado_falso.PEDIDOS[-1]['cenarios'][0]['sombras'][0]['geojson'].startswith('geo/barreiras/')
    lista = cli.get('/api/relatorios').json()
    assert lista[0]['id'] == rid and lista[0]['autor'] == 'fulano@bkm.com.br'
    assert cli.get('/api/relatorios?meus=true').json()[0]['id'] == rid
    assert 'relatório' in cli.get(f'/r/{rid}').text
    # relatório que não saiu deste app não é servido
    assert cli.get('/r/' + 'b' * 32).status_code == 404


def test_spec_invalida_vira_400(cli):
    entrar(cli)
    r = cli.post('/api/relatorios', json=form(raios_km=[]))
    assert r.status_code == 400 and 'raios' in r.json()['detail']


def test_chave_errada(cli, monkeypatch):
    entrar(cli)
    monkeypatch.setattr(appmod.config, 'MERCADO_CHAVE', 'outra')
    assert cli.post('/api/relatorios', json=form()).status_code == 502


def test_nome_do_pdf():
    h = appmod.nome_arquivo('Mercado de 28 a 33 m² · Jardim Matarazzo')
    assert 'filename="Mercado-de-28-a-33-m2--Jardim-Matarazzo.pdf"' in h
    assert "filename*=UTF-8''Mercado%20de%2028%20a%2033%20m%C2%B2" in h
    h.encode('latin-1')
