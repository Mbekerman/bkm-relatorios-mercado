# Deploy (Cloud Run, projeto `bkm-terrenos`)

O app roda no mesmo projeto do serviço de mercado (`bkm-terrenos`, número 469931692112), como serviço próprio
`relatorios-mercado`. Um projeto separado foi tentado em 17/nov/2026, mas a conta de faturamento já estava no
limite de projetos vinculados (o projeto vazio `bkm-relatorios-mercado` ficou criado, sem faturamento). Os comandos
rodam no Cloud Shell.

```bash
PROJ=bkm-terrenos
REG=southamerica-east1
BUCKET=bkm-terrenos-relatorios-app
URL=https://relatorios-mercado-469931692112.southamerica-east1.run.app
SA=469931692112-compute@developer.gserviceaccount.com
```

## O que já existe (feito em 17/nov/2026)
| Recurso | Para quê |
|---|---|
| Segredo `rm-mercado-chave` | chave deste app no serviço de mercado; o hash dela está em `im-chaves` como cliente `relatorios-app` |
| Segredo `rm-sessao-segredo` | assina o cookie de sessão |
| Segredo `rm-google-client-secret` | chave secreta do cliente OAuth |
| Bucket `gs://bkm-terrenos-relatorios-app` | histórico (`historico/<id>.json`) e PDFs (`pdf/<id>.pdf`) |
| Chave de API `relatorios-maps` | Maps JavaScript + Geocoding, restrita ao site `$URL/*` (vai para o navegador; a restrição é a proteção) |
| Cliente OAuth "Relatórios de mercado BKM" | tela de consentimento **Interna**; URI de retorno `$URL/auth/retorno` |

A conta de serviço padrão do Compute (`$SA`) lê os três segredos e tem `objectAdmin` no bucket.

## Variáveis do serviço
- Segredos: `MERCADO_CHAVE`, `SESSAO_SEGREDO`, `GOOGLE_CLIENT_SECRET`
- Ambiente: `MERCADO_URL`, `BUCKET`, `GOOGLE_MAPS_KEY`, `URL_PUBLICA`, `GOOGLE_CLIENT_ID`

O app confere no servidor que o token do Google tem `hd = bkm.com.br` e e-mail verificado; o tipo "Interno" da
tela de consentimento é a segunda trava. `LOGIN_FALSO` nunca deve ser definido no Cloud Run.

## Redeploy depois de um merge
```bash
cd ~/bkm-relatorios-mercado && git pull
gcloud run deploy relatorios-mercado --source . --region $REG --project $PROJ
```
Sem `--set-env-vars`/`--set-secrets` (substituem tudo); para mudar uma variável use `--update-env-vars` ou
`--update-secrets`.

## Trocar a chave do serviço de mercado
1. Gere chave nova e hash (`python3 servico/nova_chave.py relatorios-app` no clone do `bkm-inteligencia-mercado`).
2. Leia `im-chaves`, troque só o valor de `relatorios-app` (não perca os outros clientes) e grave nova versão.
3. Force nova revisão do `inteligencia-mercado` (ele lê o segredo ao subir):
   `gcloud run services update inteligencia-mercado --region $REG --update-labels chaves=$(date +%Y%m%d%H%M)`.
4. `printf '%s' '<chave>' | gcloud secrets versions add rm-mercado-chave --data-file=-` e redeploy deste app.

## Primeira instalação do zero (referência)
```bash
# segredos e bucket
python3 -c "import secrets;print(secrets.token_urlsafe(48),end='')" | gcloud secrets create rm-sessao-segredo --data-file=-
printf '%s' '<chave relatorios-app>' | gcloud secrets create rm-mercado-chave --data-file=-
printf '%s' '<chave secreta OAuth>' | gcloud secrets create rm-google-client-secret --data-file=-
gcloud storage buckets create gs://$BUCKET --location=$REG --uniform-bucket-level-access
for s in rm-mercado-chave rm-sessao-segredo rm-google-client-secret; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor; done
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin
# chave do Maps
gcloud services enable apikeys.googleapis.com maps-backend.googleapis.com geocoding-backend.googleapis.com
gcloud services api-keys create --display-name=relatorios-maps \
  --api-target=service=maps-backend.googleapis.com --api-target=service=geocoding-backend.googleapis.com \
  --allowed-referrers="$URL/*"
# deploy
gcloud run deploy relatorios-mercado --source . --region $REG \
  --memory 2Gi --cpu 1 --timeout 600 --concurrency 10 --min-instances 0 --max-instances 2 --allow-unauthenticated \
  --set-secrets MERCADO_CHAVE=rm-mercado-chave:latest,SESSAO_SEGREDO=rm-sessao-segredo:latest,GOOGLE_CLIENT_SECRET=rm-google-client-secret:latest \
  --set-env-vars MERCADO_URL=https://inteligencia-mercado-469931692112.southamerica-east1.run.app,BUCKET=$BUCKET,GOOGLE_MAPS_KEY=<chave>,URL_PUBLICA=$URL,GOOGLE_CLIENT_ID=<id>
```
O cliente OAuth é criado no Console: **APIs e serviços › Credenciais › Criar ID do cliente OAuth › Aplicativo da
Web**, URI de retorno `$URL/auth/retorno` (exato, sem curinga).

`--allow-unauthenticated` porque o login é do próprio app; sem sessão só a tela de entrar e `/saude` respondem.
2 GiB de memória por causa do Chromium do PDF.

## Ambiente de desenvolvimento (opcional)
Mesmo comando com o serviço `relatorios-mercado-dev`, `AMBIENTE=dev` (selo "Desenvolvimento" na barra), e o URI de
retorno dele acrescentado no mesmo cliente OAuth e na chave do Maps.
