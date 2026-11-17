"""Configuração lida das variáveis de ambiente do serviço (no Cloud Run, os segredos vêm do Secret Manager)."""
import os

DOMINIO = 'bkm.com.br'

GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
# Segredo que assina o cookie de sessão. Trocar desloga todo mundo.
SESSAO_SEGREDO = os.environ.get('SESSAO_SEGREDO', '')
SESSAO_HORAS = float(os.environ.get('SESSAO_HORAS', 12))

# Serviço de inteligência de mercado (repo bkm-inteligencia-mercado) e a chave deste app nele.
MERCADO_URL = os.environ.get('MERCADO_URL', '').rstrip('/')
MERCADO_CHAVE = os.environ.get('MERCADO_CHAVE', '')

# Chave do Google Maps (Maps JavaScript API + Geocoding), restrita por domínio no Cloud Console.
GOOGLE_MAPS_KEY = os.environ.get('GOOGLE_MAPS_KEY', '')

# Bucket do Cloud Storage com o histórico de relatórios e os PDFs já gerados. Sem ele, fica numa pasta local.
BUCKET = os.environ.get('BUCKET', '')
PASTA_LOCAL = os.environ.get('PASTA_LOCAL', '/tmp/bkm-relatorios')

# Endereço público do app (para o retorno do login do Google). Sem ele, usa o Host do pedido.
URL_PUBLICA = os.environ.get('URL_PUBLICA', '').rstrip('/')
AMBIENTE = os.environ.get('AMBIENTE', '')

# Só para teste local: pula o Google e entra com este e-mail. Nunca definir no Cloud Run.
LOGIN_FALSO = os.environ.get('LOGIN_FALSO', '')

# Chromium do Playwright (no contêiner oficial do Playwright não precisa).
CHROMIUM_PATH = os.environ.get('CHROMIUM_PATH') or None
