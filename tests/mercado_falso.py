"""Serviço de mercado falso para teste local: POST /relatorio devolve um id; GET /relatorios/<id> devolve
o HTML de exemplo (RELATORIO_HTML). Confere a chave como o serviço real."""
import os, uuid
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

app = FastAPI()
CHAVE = os.environ.get('MERCADO_CHAVE', 'teste')
HTML = open(os.environ['RELATORIO_HTML']).read() if os.environ.get('RELATORIO_HTML') else '<style></style><h1>relatório</h1>'
PEDIDOS = []


@app.post('/relatorio')
async def relatorio(req: Request):
    if req.headers.get('authorization') != f'Bearer {CHAVE}':
        return JSONResponse({'erro': 'chave'}, 401)
    spec = await req.json(); PEDIDOS.append(spec)
    return {'id': uuid.uuid4().hex, 'link': 'x', 'meta': {'titulo': spec['titulo']}, 'resumo': {}}


@app.get('/relatorios/{rid}', response_class=HTMLResponse)
def ver(rid: str):
    return HTML
