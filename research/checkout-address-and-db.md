# Fontes: CEP, banco e armazenamento de pedidos

A consulta oficial do ViaCEP usa CEP com oito dígitos e pode retornar JSON com `logradouro`, `bairro`, `localidade` e `uf`. CEP inexistente vem como `erro: true`; formato inválido retorna HTTP 400. A implementação fará consultas individuais, somente após um comprador informar o CEP, e enviará ao ViaCEP apenas esse CEP. [1] [2]

A versão consultada do `mysql2` foi 3.24.6. A documentação do projeto confirma suporte a SSL, pools, prepared statements e Promise API; o pacote não usa bindings nativos. A conexão será aberta com consultas parametrizadas e TLS exigindo validação do certificado. [3] [4] [5]

## Referências

[1]: https://viacep.com.br/ "ViaCEP: webservice oficial e formatos de resposta"
[2]: https://viacep.com.br/exemplo/javascript/ "ViaCEP: exemplo oficial de preenchimento de endereço"
[3]: https://www.npmjs.com/package/mysql2 "mysql2 no npm, versão 3.24.6"
[4]: https://github.com/sidorares/node-mysql2 "Repositório oficial do mysql2"
[5]: https://dev.mysql.com/doc/en/using-encrypted-connections.html "MySQL: conexões criptografadas e validação de TLS"
