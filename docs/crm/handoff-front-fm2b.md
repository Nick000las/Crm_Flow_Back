# Handoff ao front: FM2b, perguntas próprias e pré-preenchimento

A tela de montar o formulário (Configurações → Formulários) passa a ter dois recursos novos:

- **Perguntas próprias:** perguntas criadas dentro do formulário, que não são campos do CRM. A resposta fica só na resposta do formulário.
- **"Vem preenchido":** marcação em cada campo do CRM. Quando a pessoa abrir o link, o campo marcado já aparece com o valor salvo; ela pode alterar.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco FM2b. Antes: [handoff-front-fm1.md](./handoff-front-fm1.md) (montar e publicar) e [handoff-front-fm2.md](./handoff-front-fm2.md) (link na ficha).

As rotas são as mesmas da FM1. Muda o formato dos itens do rascunho e da versão.

## 1. Os dois tipos de item

Cada seção tem `itens`, e cada item é **um campo do CRM** ou **uma pergunta própria**. O que diferencia é a chave `pergunta`.

```json
{
  "secoes": [
    {
      "titulo": "Dados",
      "itens": [
        { "campoId": "uuid", "obrigatorio": true, "politica": "overwrite", "preencher": true },
        {
          "pergunta": {
            "id": "uuid",
            "rotulo": "Sente dor ao mastigar?",
            "ajuda": "Escolha a que mais se parece",
            "tipo": "selecao",
            "opcoes": ["Nenhuma", "Leve", "Forte"],
            "sensivel": true
          },
          "obrigatorio": false
        }
      ]
    }
  ],
  "introducao": null,
  "termo": "..."
}
```

### Item de campo

| Chave         | Uso                                                                               |
| ------------- | --------------------------------------------------------------------------------- |
| `campoId`     | campo da lista de `GET .../campos-elegiveis`                                      |
| `obrigatorio` | do formulário, independente do CRM                                                |
| `politica`    | `overwrite` ou `fill_if_empty`; sem ela, vale `politicaPadrao` do campo           |
| `preencher`   | **novo.** `true`: a página pública mostra o valor salvo da pessoa. Padrão `false` |

- Cada campo elegível agora traz `podePreencher`. Quando ele é `false` (campo sensível), desabilite a opção "vem preenchido" e explique o motivo: um link encaminhado mostraria esse dado.
- Mandar `preencher: true` num campo sensível dá 400 em `rascunho.secoes.<s>.itens.<i>.preencher`. A publicação também dá 400 se o campo virou sensível depois de salvo.

### Item de pergunta

| Chave               | Uso                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pergunta.id`       | **mande de volta o id que a API devolveu.** Pergunta nova vai sem `id` e o servidor gera um. Se o id não voltar nas próximas edições, a pergunta é tratada como nova (e respostas de versões não se ligam).                           |
| `pergunta.rotulo`   | o texto da pergunta, até 200 caracteres                                                                                                                                                                                               |
| `pergunta.ajuda`    | texto de apoio opcional, até 500                                                                                                                                                                                                      |
| `pergunta.tipo`     | os tipos de campo do CRM, menos `usuario` e `endereco`: `texto`, `texto_longo`, `numero`, `monetario`, `data`, `booleano`, `selecao`, `selecao_multipla`, `telefone`, `email`, `url`, `cpf`, `cnpj`, `cep`, `intervalo_datas`, `hora` |
| `pergunta.opcoes`   | só em `selecao` e `selecao_multipla`, e obrigatória nelas: de 1 a 50 opções, até 120 caracteres cada, sem repetir                                                                                                                     |
| `pergunta.sensivel` | padrão `false`. Resposta sensível só aparece para quem vê campo sensível (FM4)                                                                                                                                                        |
| `obrigatorio`       | do formulário                                                                                                                                                                                                                         |

- **Pergunta própria não cria campo no CRM.** A resposta aparece em "Ver respostas", na ficha (FM4), e não vira coluna nem filtro.
- Pergunta própria nunca vem preenchida.

## 2. O que a API devolve

- `GET /crm/configuracoes/formularios/:id`: o `rascunho` já vem normalizado, com `preencher` em todo item de campo e `id` em toda pergunta. Use esse rascunho como base da próxima edição.
- Versão (`POST .../publicar` e `GET .../versoes/:versaoId`): o item de campo traz `campo`, o retrato do campo na publicação; o item de pergunta vem como foi salvo. Versões publicadas antes disso vêm com `preencher: false`.
- `alteracoesNaoPublicadas` continua funcionando com os itens novos.
- O limite de 100 itens por formulário conta campos e perguntas juntos. Publicar exige ao menos um item, campo ou pergunta.

## 3. Erros (400 com `fields`)

| Caminho                                         | Quando                                                 |
| ----------------------------------------------- | ------------------------------------------------------ |
| `rascunho.secoes.<s>.itens.<i>.preencher`       | campo sensível marcado para vir preenchido             |
| `rascunho.secoes.<s>.itens.<i>.pergunta.rotulo` | pergunta sem texto                                     |
| `rascunho.secoes.<s>.itens.<i>.pergunta.tipo`   | tipo fora da lista                                     |
| `rascunho.secoes.<s>.itens.<i>.pergunta.opcoes` | seleção sem opções, opções em outro tipo, ou repetidas |
| `rascunho.secoes.<s>.itens.<i>.pergunta.id`     | a mesma pergunta duas vezes                            |
| `rascunho.secoes`                               | publicar sem nenhum item                               |

## 4. Sugestão de tela

- **Montar:** dois botões, "Adicionar campo do CRM" e "Adicionar pergunta". No item de campo, mostre os controles "Obrigatório" e "Vem preenchido"; no item de pergunta, "Obrigatório" e "Sensível".
- **Rótulo dos itens:** marque cada item de forma visível como campo do CRM ou como pergunta do formulário, para o dono saber onde a resposta vai parar.

## 5. O que ainda não existe

Ainda não existem a página pública que mostra os valores preenchidos (FM3), o envio e "Ver respostas" (FM4), e os alertas por campo ou pergunta (FM5).
