# Deploy (Cloud Run, projeto próprio)

Projeto do Google Cloud **separado** do `bkm-terrenos`, na organização `bkm.com.br`. Os comandos rodam no
Cloud Shell. Troque `bkm-relatorios-mercado` se escolher outro id de projeto.

```bash
PROJ=bkm-relatorios-mercado
REG=southamerica-east1
```

## 1. Projeto e APIs (uma vez)
```bash
gcloud projects create $PROJ --organization=$(gcloud organizations list --filter=displayName=bkm.com.br --format='value(name)')
gcloud billing projects link $PROJ --billing-account=<conta de faturamento>   # a mesma do bkm-terrenos serve
gcloud config set project $PROJ
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com maps-backend.googleapis.com geocoding-backend.googleapis.com
```

## 2. Login do Google (uma vez, no Console)
1. **APIs e serviços › Tela de consentimento OAuth**: tipo **Interno** (só contas do Workspace bkm.com.br). Nome "Relatórios de mercado BKM".
2. **Credenciais › Criar ID do cliente OAuth › Aplicativo da Web**. URI de redirecionamento autorizado: `https://<URL do serviço>/auth/retorno`
   (a URL só existe depois do primeiro deploy: crie o cliente agora com qualquer URI e corrija no passo 6).
3. Guarde o ID do cliente e a chave secreta.

O app também confere no servidor que o token tem `hd = bkm.com.br` e e-mail verificado; o "Interno" é a segunda trava.

## 3. Chave deste app no serviço de mercado (uma vez, no projeto `bkm-terrenos`)
No clone do `bkm-inteligencia-mercado`:
```bash
gcloud config set project bkm-terrenos
python3 servico/nova_chave.py relatorios-app      # mostra a chave (guarde) e o hash
gcloud secrets versions access latest --secret=im-chaves   # JSON atual: NÃO perca as chaves que já existem
printf '%s' '{"claude": "...", "grok": "...", "relatorios-app": "<hash>"}' | gcloud secrets versions add im-chaves --data-file=-
gcloud run deploy inteligencia-mercado --source . --region southamerica-east1   # relê o segredo
gcloud config set project $PROJ
```

## 4. Segredos, bucket e chave do Maps (uma vez)
```bash
printf '%s' '<chave secreta do cliente OAuth>' | gcloud secrets create rm-google-client-secret --data-file=-
printf '%s' '<chave relatorios-app do passo 3>' | gcloud secrets create rm-mercado-chave --data-file=-
python3 -c "import secrets;print(secrets.token_urlsafe(48),end='')" | gcloud secrets create rm-sessao-segredo --data-file=-
gcloud storage buckets create gs://$PROJ-dados --location=$REG --uniform-bucket-level-access
SA=$(gcloud projects describe $PROJ --format='value(projectNumber)')-compute@developer.gserviceaccount.com
for s in rm-google-client-secret rm-mercado-chave rm-sessao-segredo; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor; done
gcloud storage buckets add-iam-policy-binding gs://$PROJ-dados --member=serviceAccount:$SA --role=roles/storage.objectAdmin
```
Chave do Maps: **Credenciais › Criar chave de API**, restrita a **sites** `https://<URL do serviço>/*` e às APIs
**Maps JavaScript API** e **Geocoding API**. Ela vai para o navegador; a restrição por site é o que a protege.

## 5. Deploy
```bash
gcloud run deploy relatorios-mercado --source . --region $REG \
  --memory 2Gi --cpu 1 --timeout 600 --concurrency 10 --min-instances 0 --max-instances 2 --allow-unauthenticated \
  --set-secrets GOOGLE_CLIENT_SECRET=rm-google-client-secret:latest,MERCADO_CHAVE=rm-mercado-chave:latest,SESSAO_SEGREDO=rm-sessao-segredo:latest \
  --set-env-vars GOOGLE_CLIENT_ID=<id do cliente OAuth>,MERCADO_URL=https://inteligencia-mercado-469931692112.southamerica-east1.run.app,BUCKET=$PROJ-dados,GOOGLE_MAPS_KEY=<chave do Maps>
URL=$(gcloud run services describe relatorios-mercado --region $REG --format='value(status.url)')
gcloud run services update relatorios-mercado --region $REG --update-env-vars URL_PUBLICA=$URL
curl $URL/saude
```
`--allow-unauthenticated` porque o login é do próprio app (Google OAuth); sem sessão, só a tela de entrar e `/saude` respondem.
2 GiB de memória por causa do Chromium do PDF.

## 6. Fechar o login
No cliente OAuth do passo 2, troque o URI de redirecionamento por `$URL/auth/retorno` (exato, sem curinga) e
na chave do Maps ponha `$URL/*`. Abra `$URL`, entre com a conta @bkm.com.br e gere um relatório de teste.

## Redeploy depois de um merge
```bash
cd ~/bkm-relatorios-mercado && git pull
gcloud run deploy relatorios-mercado --source . --region southamerica-east1
```
Não repetir o `--set-env-vars` do primeiro deploy (apaga o `URL_PUBLICA`); para mudar uma variável use `--update-env-vars`.

## Ambiente de desenvolvimento (opcional)
Mesmo comando com o serviço `relatorios-mercado-dev`, `AMBIENTE=dev` (selo "Desenvolvimento" na barra) e o URI
de retorno dele acrescentado no mesmo cliente OAuth.
