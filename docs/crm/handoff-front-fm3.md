# Handoff ao front: FM3, página pública do formulário

O link que a ficha copia (`<FRONTEND_URL>/f/<token>`) passa a abrir. A página que esse endereço abre é do front, **sem login**. Ela busca o formulário na API pública e mostra os campos, com os valores pré-preenchidos que o dono marcou.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FM3. Antes: [handoff-front-fm2.md](./handoff-front-fm2.md) (link na ficha) e [handoff-front-fm2b.md](./handoff-front-fm2b.md) (perguntas e pré-preenchimento).

**Ainda não envia resposta.** O botão de enviar é da FM4. Nesta etapa a página só mostra o formulário.

## 1. Rota do front

- `/f/:token`, **fora** do layout logado: sem menu, sem chamar `/auth/me` e sem redirecionar para o login.
- Leia o token da URL e não o grave em `localStorage`, analytics nem log de erro do front.
- Não carregue scripts de terceiros nesta página (analytics, chat, pixels): o token está na URL, e eles a enviam para fora.
- A prévia do link no WhatsApp continua genérica: ela vem do `index.html` e não chama a API.

## 2. Rotas da API (sem `Authorization`)

| Rota                           | Uso                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `GET /public/f/:token`         | o formulário. **Não muda nada**: pode ser chamado de novo ao recarregar               |
| `POST /public/f/:token/aberto` | marca que a pessoa abriu. Chame **uma vez**, depois que o formulário aparecer na tela |

O `POST /aberto` fica separado para que um robô que só lê o link (prévia, antivírus de e-mail) não conte como abertura. Ele não tem corpo e devolve `{ "aberto": true }`. Repetir não muda a data.

## 3. Resposta do `GET`

```json
{
  "formulario": { "nome": "Anamnese" },
  "pessoa": { "primeiroNome": "Maria" },
  "expiraEm": "2026-11-15T12:00:00.000Z",
  "versao": {
    "introducao": "texto ou null",
    "termo": "texto do aceite",
    "secoes": [
      {
        "titulo": "Dados",
        "itens": [
          {
            "campoId": "uuid",
            "obrigatorio": true,
            "campo": { "label": "Nome", "tipo": "texto", "opcoes": null },
            "valor": "Maria Souza"
          },
          {
            "pergunta": {
              "id": "uuid",
              "rotulo": "Fuma?",
              "ajuda": null,
              "tipo": "booleano",
              "opcoes": null
            },
            "obrigatorio": true
          }
        ]
      }
    ]
  }
}
```

- **Item de campo** (`campoId`): `valor` é o que a pessoa já tem salvo, quando o dono marcou "vem preenchido" e o campo não é sensível. Fora disso, vem `null`. Mostre o valor no campo, **editável**.
- **Campo de seleção:** pode trazer `opcoesLista` (`key` e `label`). Use `label` na tela e `key` como valor.
- **Item de pergunta** (`pergunta`): sempre vem vazio.
- **Tipos:** os mesmos do CRM (`texto`, `texto_longo`, `numero`, `monetario`, `data`, `booleano`, `selecao`, `selecao_multipla`, `telefone`, `email`, `url`, `cpf`, `cnpj`, `cep`, `endereco`, `intervalo_datas`, `hora`). Reaproveite os componentes de campo do CRM. `endereco` só aparece em item de campo.
- **Termo:** mostre o `termo` antes do botão de enviar (FM4) e peça o aceite.
- **Prazo:** `expiraEm` pode aparecer como "responda até".
- **Cabeçalho:** use só `primeiroNome` ("Olá, Maria"). O nome completo pode estar em `valor`, dentro do campo.

## 4. Erros

| Resposta                       | Mostrar                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 404                            | "Este link não está mais disponível. Peça um novo a quem enviou." **Não diferencie o motivo**: a API responde igual para link vencido, cancelado, já respondido ou inexistente |
| 429 com `code: "RATE_LIMITED"` | "Muitas tentativas. Aguarde um minuto e tente de novo." O cabeçalho `Retry-After` traz os segundos                                                                             |
| outro                          | erro genérico, com botão de tentar de novo                                                                                                                                     |

## 5. O que o back já faz

- **Cabeçalhos:** as respostas saem com `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e `X-Robots-Tag: noindex`. No `index.html` dessa rota, use também `<meta name="referrer" content="no-referrer">` e `<meta name="robots" content="noindex">`.
- **Limites:** 120 pedidos por minuto por IP e 30 por minuto por link.

## 6. O que ainda não existe

O envio da resposta e "Ver respostas" na ficha são da FM4. Os alertas são da FM5.
