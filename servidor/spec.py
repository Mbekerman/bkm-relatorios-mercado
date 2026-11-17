"""Monta e valida a spec do relatório (formato em bkm-inteligencia-mercado/motor/README.md) a partir do formulário.

O app nunca repassa o pedido do navegador como veio: monta a spec campo a campo, com limites. Dois motivos:
- o motor encerra o processo (sys.exit) com estação desconhecida ou tipo de sombra desconhecido;
- o motor lê o `geojson` da sombra como caminho de arquivo no servidor dele (aceita caminho absoluto).
  Aqui só entram as barreiras da lista abaixo, pelo id.
"""
import json, os, re, unicodedata

RAIZ = os.path.dirname(os.path.abspath(__file__))

# Barreiras cadastradas no motor (motor/geo/barreiras). Id do app -> nome e arquivo no motor.
BARREIRAS = {
    'rio-pinheiros': {'nome': 'Marginal Pinheiros / Rio Jurubatuba', 'geojson': 'geo/barreiras/rio-pinheiros-jurubatuba.json'},
    'guarapiranga': {'nome': 'Canal da Guarapiranga', 'geojson': 'geo/barreiras/canal-guarapiranga.json'},
}

MAX_CENARIOS = 5
MAX_RAIOS = 3
# Base do Órulo: São Paulo e região metropolitana, mais São José dos Campos, Taubaté e Campos do Jordão.
LAT = (-24.2, -22.4)
LON = (-47.3, -45.3)


class SpecInvalida(ValueError):
    pass


def _norm(s):
    return ''.join(ch for ch in unicodedata.normalize('NFD', s.upper()) if ch.isalnum())


def _estacoes():
    with open(os.path.join(RAIZ, '..', 'web', 'dados', 'estacoes.json'), encoding='utf-8') as f:
        return {_norm(e['nome']): e['nome'] for e in json.load(f)}


ESTACOES = _estacoes()


def _num(v, nome, lo, hi, opcional=False):
    if v is None or v == '':
        if opcional:
            return None
        raise SpecInvalida(f'{nome}: obrigatório')
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise SpecInvalida(f'{nome}: número inválido')
    if not lo <= x <= hi:
        raise SpecInvalida(f'{nome}: fora do intervalo de {lo} a {hi}')
    return int(x) if x.is_integer() else x


def _txt(v, nome, maximo=120, opcional=False):
    s = re.sub(r'\s+', ' ', str(v or '')).strip()
    if not s and not opcional:
        raise SpecInvalida(f'{nome}: obrigatório')
    if len(s) > maximo:
        raise SpecInvalida(f'{nome}: até {maximo} caracteres')
    return s


def _pin(p, rot):
    p = p or {}
    lat = _num(p.get('lat'), f'{rot}: latitude', *LAT)
    lon = _num(p.get('lon'), f'{rot}: longitude', *LON)
    out = {'lat': lat, 'lon': lon}
    d = _txt(p.get('descricao'), f'{rot}: endereço', 160, opcional=True)
    if d:
        out['descricao'] = d
    return out


def _sombra(s, rot):
    t = s.get('tipo')
    if t == 'barreira':
        b = BARREIRAS.get(s.get('id'))
        if not b:
            raise SpecInvalida(f'{rot}: barreira desconhecida')
        return {'tipo': 'barreira', 'nome': b['nome'], 'geojson': b['geojson']}
    if t == 'estacoes':
        nomes = s.get('estacoes') or []
        if not nomes or len(nomes) > 10:
            raise SpecInvalida(f'{rot}: escolha de 1 a 10 estações')
        ok = []
        for n in nomes:
            k = ESTACOES.get(_norm(str(n)))
            if not k:
                raise SpecInvalida(f'{rot}: estação não encontrada: {n}')
            ok.append(k)
        return {'tipo': 'raio', 'km': _num(s.get('km'), f'{rot}: raio das estações', 0.1, 10), 'estacoes': sorted(set(ok))}
    if t == 'ponto':
        p = _pin(s, f'{rot}: ponto')
        return {'tipo': 'raio', 'km': _num(s.get('km'), f'{rot}: raio do ponto', 0.1, 10), 'lat': p['lat'], 'lon': p['lon'],
                'nome': _txt(s.get('nome'), f'{rot}: nome do ponto', 60, opcional=True) or 'ponto marcado'}
    raise SpecInvalida(f'{rot}: tipo de sombra desconhecido')


def montar(f):
    """f: o JSON do formulário. Devolve a spec pronta para POST /relatorio."""
    if not isinstance(f, dict):
        raise SpecInvalida('pedido inválido')
    tp = f.get('tipologia') or {}
    amin = _num(tp.get('area_min'), 'Área mínima', 10, 500, opcional=True)
    amax = _num(tp.get('area_max'), 'Área máxima', 10, 500, opcional=True)
    if amin is not None and amax is not None and amin > amax:
        raise SpecInvalida('Área mínima maior que a máxima')
    dorms = sorted({int(_num(d, 'Dormitórios', 0, 5)) for d in (tp.get('dorms') or [])})
    tipologia = {'finalidade': 'Residencial'}
    if amin is not None: tipologia['area_min'] = amin
    if amax is not None: tipologia['area_max'] = amax
    if dorms: tipologia['dorms'] = dorms

    raios = sorted({_num(r, 'Raio', 0.5, 10) for r in (f.get('raios_km') or [])})
    if not 1 <= len(raios) <= MAX_RAIOS:
        raise SpecInvalida(f'Escolha de 1 a {MAX_RAIOS} raios')

    cen = f.get('cenarios') or []
    if not 1 <= len(cen) <= MAX_CENARIOS:
        raise SpecInvalida(f'Informe de 1 a {MAX_CENARIOS} pontos')
    cenarios = []
    for i, c in enumerate(cen):
        rot = f'Ponto {i + 1}'
        sombras = [_sombra(s, rot) for s in (c.get('sombras') or [])[:10]]
        x = {'id': f'c{i + 1}', 'nome': _txt(c.get('nome'), f'{rot}: nome', 60), 'pin': _pin(c.get('pin'), rot)}
        if sombras:
            x['sombras'] = sombras
        cenarios.append(x)

    excluir = [_txt(n, 'Empreendimento excluído', 80) for n in (f.get('excluir_nomes') or []) if str(n).strip()][:50]
    spec = {
        'titulo': _txt(f.get('titulo'), 'Título', 120),
        'tipologia': tipologia,
        'excluir_nr': bool(f.get('excluir_nr', True)),
        'excluir_nomes': excluir,
        'min_unidades_projeto': int(_num(f.get('min_unidades_projeto', 0) or 0, 'Mínimo de unidades', 0, 5000)),
        'raios_km': raios,
        'lancamento_efetivo': bool(f.get('lancamento_efetivo', True)),
        'cenarios': cenarios,
    }
    ini = f.get('periodo_inicio')
    if ini:
        if not re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])', str(ini)):
            raise SpecInvalida('Início do período: use AAAA-MM')
        spec['periodo_inicio'] = ini
    return spec
