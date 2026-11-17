"""Login com o Google do Workspace da BKM e sessão em cookie assinado.

Fluxo: /auth/entrar manda ao Google (OAuth com state e nonce guardados num cookie assinado de 10 min);
/auth/retorno troca o código pelo id_token, confere a assinatura e o público com a biblioteca do Google e
exige `hd == bkm.com.br` e e-mail verificado. O `hd` só existe em conta do Workspace: conta pessoal do
Google criada com um e-mail @bkm.com.br não tem `hd` e é recusada. O parâmetro `hd` da URL do Google é só
dica de tela; quem barra é a conferência daqui.
"""
import secrets, time, urllib.parse
import httpx
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from google.oauth2 import id_token
from google.auth.transport import requests as g_requests

import config

COOKIE = 'bkm_sessao'
COOKIE_LOGIN = 'bkm_login'
AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'


def _ser(sal):
    if not config.SESSAO_SEGREDO:
        raise RuntimeError('SESSAO_SEGREDO não configurado')
    return URLSafeTimedSerializer(config.SESSAO_SEGREDO, salt=sal)


def criar_sessao(email, nome, foto=''):
    return _ser('sessao').dumps({'email': email, 'nome': nome, 'foto': foto, 'em': int(time.time())})


def ler_sessao(valor):
    if not valor:
        return None
    try:
        d = _ser('sessao').loads(valor, max_age=int(config.SESSAO_HORAS * 3600))
    except (BadSignature, SignatureExpired):
        return None
    # defesa em profundidade: a sessão só nasce para o domínio, mas confere de novo
    return d if email_permitido(d.get('email', '')) else None


def email_permitido(email):
    return isinstance(email, str) and email.lower().endswith('@' + config.DOMINIO) and email.count('@') == 1


def conferir_claims(info):
    """Regras sobre o id_token já verificado (assinatura, público e validade). Devolve o motivo da recusa ou None."""
    if info.get('hd') != config.DOMINIO:
        return 'conta fora do Google Workspace da BKM'
    if not info.get('email_verified'):
        return 'e-mail não verificado'
    if not email_permitido(info.get('email', '')):
        return 'e-mail fora do domínio'
    return None


def inicio_login(retorno_url, voltar_para='/'):
    """URL do Google e o valor do cookie temporário (state, nonce e para onde voltar)."""
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    if not voltar_para.startswith('/') or voltar_para.startswith('//'):
        voltar_para = '/'
    q = {'client_id': config.GOOGLE_CLIENT_ID, 'redirect_uri': retorno_url, 'response_type': 'code',
         'scope': 'openid email profile', 'state': state, 'nonce': nonce, 'hd': config.DOMINIO,
         'prompt': 'select_account'}
    cookie = _ser('login').dumps({'state': state, 'nonce': nonce, 'voltar': voltar_para})
    return AUTH_URL + '?' + urllib.parse.urlencode(q), cookie


def ler_inicio(valor):
    try:
        return _ser('login').loads(valor or '', max_age=600)
    except (BadSignature, SignatureExpired):
        return None


async def trocar_codigo(code, retorno_url):
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(TOKEN_URL, data={'code': code, 'client_id': config.GOOGLE_CLIENT_ID,
                                          'client_secret': config.GOOGLE_CLIENT_SECRET,
                                          'redirect_uri': retorno_url, 'grant_type': 'authorization_code'})
    r.raise_for_status()
    tok = r.json()['id_token']
    return id_token.verify_oauth2_token(tok, g_requests.Request(), config.GOOGLE_CLIENT_ID)
