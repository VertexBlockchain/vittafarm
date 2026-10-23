# Pixgate: Cash In e postback de confirmação

Documentação oficial consultada em 23/10/2026: https://app.pixgateip.com/docs/

O endpoint de Cash In documentado gera a cobrança e devolve um identificador `id` e o código PIX copia e cola no campo `pix`. A situação inicial é `PENDING`. A página do checkout deve apresentar o código ao cliente e pode gerar localmente uma imagem QR a partir dele.

A Pixgate dispara `POST application/json` para a URL HTTPS enviada no campo `postback`, sem cadastro prévio do endpoint. Para pagamento confirmado, o evento é `transaction.paid`, o identificador da transação é `transaction_id` e o estado é `PAID`. O endpoint do lojista deve responder HTTP 200 e correlacionar o identificador ao registro local.

A documentação consultada não descreve assinatura HMAC ou cabeçalho de autenticação para o postback. A integração adiciona um token aleatório, exclusivo por cobrança, como parâmetro da URL de callback, guarda apenas seu hash e valida o token com o identificador da transação. O botão “Já paguei” consulta o estado no servidor e não pode declarar pagamento por si só.
