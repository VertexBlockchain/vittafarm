# Plano de implementação — Vitta Farm

## Abordagem

Expandir o catálogo existente, preservando imagens, carrossel, identidade visual e sete itens. O checkout pede nome, CPF/CNPJ, e-mail, senha com no mínimo 6 caracteres e confirmação da senha para criar ou autenticar a conta, além do telefone e endereço completo. O telefone é guardado para contato sobre o pedido; o aceite para ofertas por WhatsApp é opcional e revogável, não bloqueia a compra e habilita somente o link promocional do painel. A senha nunca é guardada em texto aberto; a conta usa hash forte e sessão HttpOnly. O aceite obrigatório dos termos permanece em uma única declaração; detalhes de privacidade ficam recolhidos, e a frase de pesquisa acompanha essa mesma declaração somente quando aplicável. O navegador consulta ViaCEP somente com o CEP; os campos continuam editáveis. O envio é grátis e não é somado ao PIX.

O detalhe de termos e privacidade explica que nome e CPF/CNPJ são enviados à Pixgate, nome, endereço e telefone atendem o pedido, e-mail é usado para acesso e acompanhamento, senha é protegida por hash e endereço/telefone não vão à Pixgate. O telefone só é usado para ofertas quando o cliente marca o consentimento opcional de WhatsApp. A declaração obrigatória única aceita os termos e autoriza o processamento necessário do pedido; o marketing tem um aceite distinto e opcional. Não armazenar CPF/CNPJ nem código PIX copia-e-cola.

O backend valida dados, termos aceitos e produto/preço a partir de `catalog.json`. Cria o pedido no banco antes de chamar a Pixgate, com chave idempotente e token de callback aleatório exclusivo por pedido; se o banco não salvar, não envia a cobrança. A chamada envia `postback` HTTPS e registra ID e status devolvidos pela Pixgate. O endpoint `/api/pixgate/webhook` valida o token de callback e aceita somente confirmações `transaction.paid`/`PAID`, de forma idempotente; o botão do comprador apenas consulta esse estado e jamais confirma pagamento por declaração do cliente. A resposta Pixgate `pix` gera localmente um QR em alta resolução, com margem branca e contraste alto, usando o mesmo conteúdo do copia e cola. Falhas ambíguas ficam para conferência manual, sem repetição automática. Pedidos, contas e telefones de contato ficam em `/admin`, protegido por senha exclusiva de ao menos 16 caracteres. O painel mostra o telefone para atendimento do pedido, mas só cria link clicável de campanha quando a autorização promocional estiver ativa; contas podem revogar a autorização em `/conta`. Compradores veem apenas os próprios pedidos autenticados em `/conta`.

O banco PostgreSQL gerenciado será criado no Render e compartilhado por desenvolvimento e produção. Migrations versionadas, aditivas e idempotentes criam tabelas de pedidos/sessões e campos de telefone e autorização promocional. `pg` conecta com TLS; consultas usam parâmetros preparados. Não criar pedido de teste nem cobrança real durante validação.

Na exibição do pagamento, abrir o resultado em viewport inteira, com conteúdo centralizado e sem rolagem horizontal; manter intactos o QR, o conteúdo copia e cola e os handlers de pagamento. O site disponibiliza o WhatsApp de suporte `+55 47 92006-6015` em botão flutuante que pode ser dispensado por “×” e em links visíveis de contato. A correção de layout e os preços já estão publicados. Esta nova alteração — telefone obrigatório para contato operacional, opt-in promocional, lista de clientes e ativação do painel — fica em branch isolada até autorização explícita para merge/deploy.

## Estrutura do projeto

- `index.html`, `styles.css`, `app.js`: catálogo, carrossel, checkout, campos de endereço, busca ViaCEP, consentimentos, frete grátis e apresentação do PIX.
- `admin.html`, `admin.js`: página `/admin`, login por senha e consulta autenticada de pedidos, contas/e-mails e telefones de contato; link clicável de campanha somente para consentimentos ativos, sem senha ou dados pessoais embutidos em código público.
- `catalog.json`, `images/`: fonte compartilhada de produtos/preços e imagens existentes.
- `server.js`: servidor HTTP, arquivos estáticos, healthcheck, rotas e separação entre checkout bloqueado na prévia e contêiner configurado.
- `src/database.js`: pool PostgreSQL a partir de `DATABASE_URL`, TLS estrito e funções comuns.
- `src/orders.js`: validação e gravação idempotente, leitura dos pedidos e contas para o painel autenticado.
- `src/admin-auth.js`: autenticação com senha secreta, sessões opacas com hash no banco, cookie `HttpOnly; Secure; SameSite=None`, expiração e logout.
- `src/customer-auth.js`, `account.html`, `account.js`: cadastro/login por e-mail e senha, telefone de contato do pedido, sessão de cliente, consulta dos próprios pedidos e revogação de mensagens promocionais.
- `src/pixgate.js`: cobrança com nome/CPF-CNPJ e valor validado no servidor; nunca recebe endereço.
- `research/pixgate-cashin-webhook.md`: contrato da documentação oficial da Pixgate usado para o QR e postback.
- `migrations/001_orders.sql`–`003_customer_marketing_contact.sql`, `scripts/migrate.js`: tabelas/colunas aditivas e idempotentes e histórico versionado de migrations.
- `tests/`: testes de validação e comportamento com mocks; não inserir pedidos na base compartilhada.
- `Dockerfile`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`: Node 22, `pg@8.16.3`, `pnpm@11.25.0` e flags de runtime para pedidos, painel e PIX no contêiner publicado.
- `manus-routes.json`: páginas `/`, `/admin` e `/conta`; publicação roteia `/api/*`, `/admin`, `/conta` e `/healthz` ao servidor, e assets ao build estático com cache de revalidação.
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
