# Plano de implementação — Vitta Farm

## Abordagem

Expandir o catálogo existente, preservando imagens, carrossel, identidade visual e sete itens. O checkout pede nome e CPF/CNPJ para a cobrança Pixgate e endereço de entrega: CEP, rua, número, complemento opcional, bairro, cidade e UF. O navegador consulta ViaCEP somente com o CEP informado; rua, bairro, cidade e UF permanecem editáveis. Os itens mostram “Envio grátis”; frete é R$ 0,00 e não é somado ao valor enviado à Pixgate.

O formulário explica separadamente que nome e CPF/CNPJ são enviados à Pixgate para gerar a cobrança, enquanto nome e endereço ficam no banco privado do site para processar o pedido/entrega; endereço nunca vai à Pixgate. Exige consentimentos explícitos de entrega e de envio de dados de cobrança. Não armazenar CPF/CNPJ, código PIX copia-e-cola, email nem telefone.

O backend valida dados, consentimentos e produto/preço a partir de `catalog.json`. Cria o pedido no banco antes de chamar a Pixgate, com chave idempotente; se o banco não salvar, não envia a cobrança. Em seguida registra ID e status devolvidos pela Pixgate. Falhas ambíguas ficam para conferência manual, sem repetição automática. O nome e endereço só podem ser consultados em `/admin`, protegido por senha exclusiva de ao menos 16 caracteres configurada pelo formulário secreto do projeto. O painel é somente de consulta; não oferece exclusão de pedidos. Sem webhook/status API, não mostrará pagamento ou entrega como concluídos automaticamente.

O banco PostgreSQL gerenciado será criado no Render e compartilhado por desenvolvimento e produção. Uma migration versionada, aditiva e idempotente cria tabelas de pedidos e sessões. `pg` conecta com TLS; consultas usam parâmetros preparados. Não criar pedido de teste nem cobrança real durante validação.

Na prévia, o painel pode ser consultado após autenticação para validar o fluxo administrativo; somente cria sessões de curta duração. Novos pedidos e cobranças PIX reais permanecem bloqueados. No contêiner publicado, o checkout usa flags explícitas de runtime. O usuário não autorizou publicar esta versão; manter auto-publish desligado e parar na prévia/checkpoint até nova autorização.

## Estrutura do projeto

- `index.html`, `styles.css`, `app.js`: catálogo, carrossel, checkout, campos de endereço, busca ViaCEP, consentimentos, frete grátis e apresentação do PIX.
- `admin.html`, `admin.js`: página `/admin`, login por senha e consulta de pedidos/endereço; sem senha ou dados pessoais embutidos em código público.
- `catalog.json`, `images/`: fonte compartilhada de produtos/preços e imagens existentes.
- `server.js`: servidor HTTP, arquivos estáticos, healthcheck, rotas e separação entre checkout bloqueado na prévia e contêiner configurado.
- `src/database.js`: pool PostgreSQL a partir de `DATABASE_URL`, TLS estrito e funções comuns.
- `src/orders.js`: validação e gravação idempotente, leitura dos pedidos autenticados.
- `src/admin-auth.js`: autenticação com senha secreta, sessões opacas com hash no banco, cookie `HttpOnly; Secure; SameSite=None`, expiração e logout.
- `src/pixgate.js`: cobrança com nome/CPF-CNPJ e valor validado no servidor; nunca recebe endereço.
- `migrations/001_orders.sql`, `scripts/migrate.js`: tabelas idempotentes e histórico versionado de migrations.
- `tests/`: testes de validação e comportamento com mocks; não inserir pedidos na base compartilhada.
- `Dockerfile`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`: Node 22, `pg@8.16.3`, `pnpm@11.25.0` e flags de runtime para pedidos, painel e PIX no contêiner publicado.
- `manus-routes.json`: páginas `/` e `/admin`; publicação roteia `/api/*`, `/admin` e `/healthz` ao servidor, e assets ao build estático com cache de revalidação.
- `research/`: referências técnicas já consultadas.

## Design

**Movimento:** editorial botânico contemporâneo, reaproveitando a página Vitta Farm. **Princípios:** informação legível; produtos delimitados por cartões; compra sem passos escondidos; explicações factuais e transparentes.

**Cores:** manter verde-floresta e verde-menta como orientação sobre fundos creme e marfim. Vermelho somente para erros; verde nunca comprova pagamento.

**Layout:** preservar hero assimétrico e carrossel horizontal. Checkout em diálogo com grupos curtos, resumo de produto, preço e envio. `/admin` usa tabela responsiva sem ilustrações decorativas.

**Elementos:** wordmark e símbolo Vitta existentes; linhas finas nos cartões; indicadores e estados com texto, não só cor. Verde próprio `#177d6b`.

**Interação e animação:** consulta CEP após oito dígitos; campos continuam editáveis. O pedido só é enviado após consentimento. Estados de carregamento, sucesso, falha e incerteza são apresentados por texto. Preservar animações existentes de 180–240 ms e `prefers-reduced-motion`.

**Tipografia:** Manrope em títulos/valores e DM Sans em campos/descrições/estados. Rótulos explícitos, consentimentos legíveis e resumo do valor com frete zero.

**Essência:** catálogo que apresenta produto, preço e entrega claramente. Personalidade: clara, cuidadosa e acessível. **Tom:** objetivo e informativo. Exemplos: “Envio grátis.” e “CEP encontrado. Revise o endereço antes de continuar.”

**Marca:** manter o wordmark “Vitta FARM” e o símbolo existentes. Cor de assinatura: `#177d6b`.
