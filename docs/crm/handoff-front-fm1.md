# Handoff ao front: FM1, formulário e versões

Nesta etapa entram a tela de montar formulários em Configurações e a marcação de campo sensível. O link para a pessoa responder vem na FM2, e a página pública na FM3.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FM1.

## Ideia

O formulário é uma **seleção dos campos da pessoa que já existem no CRM**. O dono escolhe quais entram, e a resposta grava nesses mesmos campos. Uma pergunta nova ("Alergias", por exemplo) é criada antes como campo personalizado, em Configurações → Campos, e depois entra no formulário. Não existe "campo de formulário" separado.

Tudo fica atrás da flag `crm.formularios` e é só de gestão (DONO e MASTER). Sem a flag, as rotas dão 403; o OPERADOR também recebe 403.

## 1. Campo sensível (Configurações → Campos)

`PUT /crm/configuracoes/campos/:id` aceita `{ "sensivel": true }`.

- **Onde aparece:** `GET /crm/configuracoes/campos` traz `sensivel` em cada campo e `capacidades.canBeSensitive`. Mostre o controle só quando `canBeSensitive` for verdadeiro. Nome, e-mail, telefone e os campos carimbados pela LGPD não podem ser sensíveis (400).
- **Para o OPERADOR:** o campo some da leitura, dos filtros e da escrita, com ou sem a flag `crm.permissoes`.
- **Com a flag `crm.permissoes`:** a tela de permissões mostra o campo como `hidden` por padrão (`GET /crm/configuracoes/permissoes` traz `sensivel: true`). O dono pode liberá-lo marcando `edit`, como em qualquer outro campo.
- **Exportação:** as colunas padrão deixam o campo sensível de fora. Ele só sai quando é pedido pelo nome em `colunas`.

## 2. Rotas

Base: `/crm/configuracoes/formularios`.

| Rota                         | Uso                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `GET /`                      | lista                                                                            |
| `GET /campos-elegiveis`      | campos que podem entrar num formulário                                           |
| `POST /`                     | criar: `{ nome, descricao?, validadeDias? }` (validade padrão 7, de 1 a 90 dias) |
| `GET /:id`                   | detalhe: dados, `rascunho` e `versoes`                                           |
| `PUT /:id`                   | editar: `{ nome?, descricao?, validadeDias?, ativo?, rascunho? }`                |
| `POST /:id/publicar`         | publica o rascunho como versão nova (201)                                        |
| `GET /:id/versoes/:versaoId` | uma versão publicada, como o link vai mostrar                                    |

## 3. Formatos

Item da lista e detalhe:

```json
{
  "id": "uuid",
  "nome": "Anamnese",
  "descricao": null,
  "ativo": true,
  "validadeDias": 7,
  "versaoAtual": { "id": "uuid", "versao": 2, "publicadaEm": "..." },
  "alteracoesNaoPublicadas": false,
  "atualizadoEm": "..."
}
```

O detalhe acrescenta `rascunho` e `versoes` (`[{ id, versao, publicadaEm, publicadaPor }]`, da mais nova para a mais antiga).

Rascunho, igual no `PUT` e no `GET`:

```json
{
  "secoes": [
    {
      "titulo": "Saúde",
      "itens": [{ "campoId": "uuid", "obrigatorio": true, "politica": "overwrite" }]
    }
  ],
  "introducao": "Texto antes das perguntas",
  "termo": "Autorizo o uso dos meus dados para o atendimento."
}
```

- **`obrigatorio`:** vale só no formulário. Não torna o campo obrigatório no cadastro do lead.
- **`politica`:**
  - `overwrite`: a resposta substitui o valor salvo.
  - `fill_if_empty`: só grava se o campo estiver vazio.
  - Se não vier, vale `politicaPadrao` do campo elegível: `fill_if_empty` para e-mail, telefone, CPF e CNPJ, e `overwrite` para o resto.

Campo elegível:

```json
{
  "id": "uuid",
  "chave": "alergias",
  "label": "Alergias",
  "tipo": "texto",
  "camada": 3,
  "sensivel": true,
  "opcoes": null,
  "politicaPadrao": "overwrite"
}
```

**Quem é elegível:**

- **Do sistema:** nome, e-mail, telefone, empresa, cargo, CPF, CNPJ, cidade, UF, CEP e endereço, desde que estejam ligados no CRM.
- **Personalizados:** todos, menos os do tipo usuário.
- **Ficam de fora:** status, valor, motivo, tags, origem, score, follow-up e os campos de LGPD.

Versão publicada: cada item leva `campo`, o retrato do campo no momento da publicação (`chave`, `label`, `tipo`, `camada`, `sensivel`, `opcoes`). Se o campo for renomeado depois, a versão continua com o nome antigo.

## 4. Erros que a tela precisa tratar

| Situação                                   | Resposta                                                  |
| ------------------------------------------ | --------------------------------------------------------- |
| Campo não elegível ou repetido no rascunho | 400, em `fields["rascunho.secoes.<s>.itens.<i>.campoId"]` |
| Publicar sem nenhum campo                  | 400, em `fields["rascunho.secoes"]`                       |
| Publicar sem termo                         | 400, em `fields["rascunho.termo"]`                        |
| Campo do rascunho foi desligado no CRM     | 400 ao publicar, no item                                  |
| Nome repetido (sem diferenciar maiúscula)  | 409, em `fields.nome`                                     |
| Mais de 50 formulários                     | 400                                                       |

## 5. Como montar a tela

- **Lista:** use `versaoAtual` e `alteracoesNaoPublicadas` para mostrar "Rascunho", "Publicado" ou "Publicado com alterações".
- **Montar:** carregue `campos-elegiveis` e deixe arrastar os campos para as seções. Ao lado de cada item, mostre o interruptor "obrigatório neste formulário" e a escolha de política.
- **Salvar e publicar:** salve com `PUT` e publique com `POST /publicar`. Publicar não apaga o rascunho; depois de publicar, `alteracoesNaoPublicadas` fica falso.
- **Pré-visualizar:** `GET /:id/versoes/:versaoId` mostra a versão como a pessoa vai vê-la.

## 6. O que ainda não existe

Gerar e copiar o link na ficha (FM2), a página pública (FM3), o envio das respostas (FM4) e os alertas (FM5).
