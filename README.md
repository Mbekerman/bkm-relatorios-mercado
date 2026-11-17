# Relatórios de mercado BKM

App web para a equipe da BKM gerar o relatório de mercado imobiliário (lançamentos, vendas, estoque, preço × INCC,
VSO, índice de velocidade, curvas por safra) para os pontos que quiser e baixar em PDF.

- **Login:** só conta Google do Workspace `@bkm.com.br` (OAuth "Interno" + conferência de `hd` no servidor).
- **Formulário:** recorte (área, dormitórios, raios, mínimo de unidades, período, exclusões por nome) e até 5 pontos,
  cada um com as sombras do motor: barreiras cadastradas, entorno de estações e raio em volta de um ponto do mapa.
- **Cálculo:** no serviço de inteligência de mercado (repo `bkm-inteligencia-mercado`, `POST /relatorio`). Este app
  guarda a chave daquele serviço no servidor; o navegador nunca a vê. As regras de cálculo estão em
  `bkm-inteligencia-mercado/motor/README.md`.
- **PDF:** a página do relatório aberta no Chromium (Playwright) com folha de impressão própria (A4 deitado, uma métrica
  por folha, listas de empreendimentos abertas). Fica guardado no bucket depois da primeira vez.
- **Histórico:** todo relatório gerado fica listado (quem gerou, quando, a spec), com "Duplicar e ajustar".
- **Visual:** design system BKM, seção Aplicativos (Material 3 com a marca BKM; temas Claro, Escuro e Automático).

## Estrutura
```
servidor/   FastAPI: login (sessao.py), validação da spec (spec.py), histórico (guarda.py), PDF (pdf.py), rotas (app.py)
web/        página sem build (index.html, app.js, app.css), tela de entrar, logo e a lista de estações
tests/      pytest + serviço de mercado falso (mercado_falso.py)
docs/       deploy.md (Cloud Run no projeto bkm-terrenos)
```

## Rodar local
```bash
pip install -r requirements.txt && python3 -m playwright install chromium
# serviço de mercado falso (devolve o HTML de RELATORIO_HTML para qualquer relatório)
(cd tests && MERCADO_CHAVE=teste RELATORIO_HTML=<um relatorio.html do motor> uvicorn mercado_falso:app --port 9100 &)
cd servidor && SESSAO_SEGREDO=x MERCADO_URL=http://127.0.0.1:9100 MERCADO_CHAVE=teste \
  LOGIN_FALSO=voce@bkm.com.br PASTA_LOCAL=/tmp/rm uvicorn app:app --port 8080
```
`LOGIN_FALSO` pula o Google e só serve para teste local: nunca defina no Cloud Run. Para o mapa e a busca de
endereço, defina também `GOOGLE_MAPS_KEY`.

Testes: `python3 -m pytest tests -q`.

## Pontos de atenção
- O motor encerra o processo (`sys.exit`) com estação ou tipo de sombra desconhecido, e lê o `geojson` da sombra como
  caminho de arquivo no servidor dele. Por isso este app monta a spec campo a campo (`servidor/spec.py`) e só aceita as
  barreiras cadastradas, pelo id. Sombra do tipo polígono ainda não está no formulário.
- O link `/relatorios/<id>` do serviço de mercado continua aberto para quem tiver o id. Neste app, `/r/<id>` pede login
  e só serve relatórios gerados por ele.
- Lista de estações em `web/dados/estacoes.json` é cópia de `bkm-inteligencia-mercado/motor/geo/estacoes.json`; se lá
  mudar, copie de novo. O mesmo para as barreiras em `servidor/spec.py`.
- O histórico é lido inteiro do bucket a cada listagem: bom até alguns milhares de relatórios.
