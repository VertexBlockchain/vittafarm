# Fontes: CEP, banco e armazenamento de pedidos

A consulta oficial do ViaCEP usa CEP com oito dígitos e pode retornar JSON com `logradouro`, `bairro`, `localidade` e `uf`. CEP inexistente vem como `erro: true`; formato inválido retorna HTTP 400. A implementação fará consultas individuais, somente após um comprador informar o CEP, e enviará ao ViaCEP apenas esse CEP. [1] [2]

A versão usada do pacote `pg` é 8.16.3. A biblioteca oferece suporte a SSL, pools, prepared statements e Promise API. A conexão é aberta com consultas parametrizadas e TLS exigido pelo `DATABASE_URL` do Render. [3] [4]

## Referências

[1]: https://viacep.com.br/ "ViaCEP: webservice oficial e formatos de resposta"
[2]: https://viacep.com.br/exemplo/javascript/ "ViaCEP: exemplo oficial de preenchimento de endereço"
[3]: https://www.npmjs.com/package/pg "pg no npm, versão 8.16.3"
[4]: https://node-postgres.com/features/ssl "node-postgres: conexões SSL"
