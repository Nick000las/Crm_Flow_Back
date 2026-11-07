# Handoff ao front: M5, tempo real do quadro comercial

Agora o quadro aberto recebe o que muda em qualquer lugar do CRM: ficha, tabela, edição em massa, importação, distribuição e o card de atendimento criado pela venda ganha.

O aviso leva só ids. A tela relê os cards pela API, com as permissões de quem está vendo.

Base do front: os handoffs do [M3](./handoff-front-m3.md) e do [M4](./handoff-front-m4.md).

## 1. Entrar e sair da sala

Use o mesmo socket do Kanban, no namespace `/kanban`:

```js
const { ok, code } = await socket.emitWithAck('quadro:watch', {
  boardType: 'crm_oportunidades',
  quadroRef: pipelineId,
});
```

- Envie ao abrir o quadro e de novo a cada reconexão.
- `ok: false`: o quadro não está disponível para este usuário. Mostre o quadro sem tempo real, sem erro.
- Ao sair: `socket.emit('quadro:unwatch', { boardType, quadroRef })`.
- O `kanban:watch` continua só para quadros nativos.

## 2. O aviso

```json
{
  "id": "uuid",
  "boardType": "crm_oportunidades",
  "quadroRef": "uuid do pipeline",
  "entidadeIds": ["uuid", "uuid"]
}
```

O evento é `quadro:changed`. Um aviso pode trazer vários cards, sem repetir nenhum.

## 3. Reler os cards

```
POST /kanban/quadros/crm_oportunidades/:quadroRef/cards/por-ids
{ "ids": ["..."], "filtros": { ... } }
```

Envie os mesmos `filtros` da tela. No máximo 100 ids por chamada.

```json
{
  "itens": [{ "entidadeId": "uuid", "colunaRef": "proposta", "titulo": "Ana Souza" }],
  "ausentes": ["uuid"]
}
```

- **`itens`:** o card completo, no formato de sempre, com `colunaRef`. Atualize e, se a coluna mudou, mude de coluna.
- **`ausentes`:** saiu do quadro, do filtro ou do alcance do usuário. Tire da tela, sem aviso.
- **Card novo:** vem em `itens`, com um id que a tela não conhecia. Coloque na coluna certa.
- **404:** o quadro deixou de estar disponível para este usuário. Saia da sala e mostre que o acesso mudou.

## 4. Como aplicar

- Junte os avisos por 300 a 500 ms antes de reler, para uma importação não virar uma chamada por card.
- A posição do card segue a ordem da tela: não mexa no card que o próprio usuário está arrastando. Aplique quando o arraste terminar.
- Reler a própria mudança não tem problema: o resultado é o mesmo.
- Atualize o resumo da coluna afetada com `/resumo`, com debounce maior, porque ele custa uma consulta sobre a coluna inteira.
- **Reconexão:** avisos perdidos não voltam. Ao reconectar, recarregue as colunas abertas.

## 5. O que não chega em tempo real

- **Selo "esfriando":** muda com o tempo e com atividades, que não geram aviso. Atualiza ao reler o card.
- **Score:** recalcular não gera aviso. Se ele estiver no layout do card, atualiza ao reler.
- **Atraso:** o aviso leva até cerca de 1 s, porque o back consulta as mudanças a cada segundo.

## 6. O que depende da sua tela para fechar o M5

O aceite "editar a oportunidade na ficha atualiza o card em outro navegador" só fecha com a tela no ar.
