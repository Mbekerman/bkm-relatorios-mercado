"""Histórico dos relatórios gerados pelo app e cache dos PDFs: Cloud Storage (BUCKET) ou pasta local."""
import json, os
import config


class Guarda:
    def __init__(self):
        self.b = None
        if config.BUCKET:
            from google.cloud import storage
            self.b = storage.Client().bucket(config.BUCKET)
        else:
            os.makedirs(os.path.join(config.PASTA_LOCAL, 'historico'), exist_ok=True)
            os.makedirs(os.path.join(config.PASTA_LOCAL, 'pdf'), exist_ok=True)

    # ---- bytes genéricos
    def _pôr(self, nome, dados, tipo):
        if self.b:
            self.b.blob(nome).upload_from_string(dados, content_type=tipo)
        else:
            with open(os.path.join(config.PASTA_LOCAL, nome), 'wb') as f:
                f.write(dados if isinstance(dados, bytes) else dados.encode())

    def _tirar(self, nome):
        if self.b:
            bl = self.b.blob(nome)
            return bl.download_as_bytes() if bl.exists() else None
        p = os.path.join(config.PASTA_LOCAL, nome)
        return open(p, 'rb').read() if os.path.exists(p) else None

    # ---- histórico
    def registrar(self, item):
        self._pôr(f"historico/{item['id']}.json", json.dumps(item, ensure_ascii=False), 'application/json')

    def item(self, rid):
        d = self._tirar(f'historico/{rid}.json')
        return json.loads(d) if d else None

    def listar(self, limite=200):
        if self.b:
            itens = [json.loads(b.download_as_bytes()) for b in self.b.list_blobs(prefix='historico/')]
        else:
            pasta = os.path.join(config.PASTA_LOCAL, 'historico')
            itens = [json.load(open(os.path.join(pasta, n))) for n in os.listdir(pasta) if n.endswith('.json')]
        itens.sort(key=lambda x: x.get('criado_em', ''), reverse=True)
        return itens[:limite]

    # ---- PDF
    def pdf(self, rid):
        return self._tirar(f'pdf/{rid}-v{config.VERSAO_PDF}.pdf')

    def guardar_pdf(self, rid, dados):
        self._pôr(f'pdf/{rid}-v{config.VERSAO_PDF}.pdf', dados, 'application/pdf')
