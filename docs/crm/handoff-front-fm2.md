# Handoff ao front: FM2, link pessoal do formulário

A ficha da pessoa passa a gerar o link de um formulário publicado e a mostrar o histórico de links. A página que abre o link é a FM3; até lá, a URL ainda não abre nada.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FM2. A FM1 está em [handoff-front-fm1.md](./handoff-front-fm1.md).

Tudo fica atrás da flag `crm.formularios` e vale para **qualquer papel que vê a pessoa**: a mesma regra de visibilidade das outras abas da ficha.

## 1. Rotas

| Rota                                                    | Uso                                                      |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `GET /crm/formularios/disponiveis`                      | formulários que podem ser enviados (ativos e publicados) |
| `GET /crm/leads/:id/formularios`                        | links da pessoa, do mais novo para o mais antigo         |
| `POST /crm/leads/:id/formularios/:formId/link`          | copiar o link: devolve o ativo ou cria um                |
| `POST /crm/leads/:id/formularios/links/:linkId/revogar` | cancelar um link ativo                                   |

## 2. Copiar o link

```
POST /crm/leads/:id/formularios/:formId/link
{ "oportunidadeId": "uuid" }   // opcional, só referência
```

```json
{
  "url": "http://localhost:5173/f/<token>",
  "criado": true,
  "link": {
    "id": "uuid",
    "status": "active",
    "expiraEm": "...",
    "versao": { "id": "uuid", "versao": 2 }
  }
}
```

- **201** quando criou e **200** quando devolveu o link ativo que já existia. Copiar duas vezes devolve a mesma `url`, e dois cliques ao mesmo tempo geram um link só.
- **Use a `url` exatamente como vem.** O token não aparece em nenhum outro lugar; a lista não traz o token.
- **A página pública é a rota `/f/:token` do front.** É ela que a FM3 vai atender.
- **Versão:** o link fica na versão publicada quando nasceu. Publicar uma versão nova não muda um link ativo.

## 3. Formas de envio (tudo no front)

- **Copiar:** área de transferência.
- **Abrir no WhatsApp:** `https://wa.me/55<telefone só com dígitos>?text=<mensagem com a url, codificada>`. Desabilite quando a pessoa não tiver telefone.
- **QR Code:** gere no front a partir da `url`.

## 4. Lista e estados

Cada item de `GET /crm/leads/:id/formularios`:

```json
{
  "id": "uuid",
  "formulario": { "id": "uuid", "nome": "Anamnese" },
  "versao": { "id": "uuid", "versao": 1 },
  "oportunidadeId": null,
  "status": "active",
  "expiraEm": "...",
  "abertoEm": null,
  "respondidoEm": null,
  "revogadoEm": null,
  "criadoEm": "...",
  "criadoPor": "uuid"
}
```

| `status`    | Mostrar             | Ação                    |
| ----------- | ------------------- | ----------------------- |
| `active`    | Aguardando resposta | Copiar de novo, Revogar |
| `expired`   | Vencido             | Gerar novo              |
| `revoked`   | Cancelado           | Gerar novo              |
| `submitted` | Respondido          | Ver respostas (FM4)     |

"Gerar novo" é o mesmo `POST .../link`: com o anterior fechado, ele cria outro (201) com outra `url`.

## 5. Erros

| Situação                                                     | Resposta                            |
| ------------------------------------------------------------ | ----------------------------------- |
| Formulário inativo, sem versão publicada ou de outra empresa | 404                                 |
| Pessoa arquivada ou anonimizada                              | 409                                 |
| Oportunidade de outra pessoa ou na lixeira                   | 400 em `fields.oportunidadeId`      |
| Revogar um link que não está ativo                           | 409                                 |
| Servidor sem a chave dos links                               | 503 com `code: "FORMS_UNAVAILABLE"` |
| Flag desligada                                               | 403                                 |

## 6. O que ainda não existe

A página pública (FM3), o envio das respostas e "Ver respostas" (FM4), e os alertas (FM5). Por enquanto, `abertoEm` e `respondidoEm` ficam sempre nulos.
