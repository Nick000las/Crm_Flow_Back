# CRM: pessoas e campos

> Estado em 21/11/2026. Fonte: código do back (`src/modules/nucleo/crm/`).

## O que é

É o cadastro de pessoas (na API, "lead") e tudo o que o dono do negócio pode ajustar nele sem pedir ajuda à equipe técnica. Cada empresa decide quais campos aparecem, em que ordem, quais são obrigatórios, quais valores as listas oferecem e como a ficha da pessoa é montada. Também decide o que o operador pode ver ou editar. Os campos vêm em três camadas: fixos do sistema, opcionais do sistema e personalizados criados pelo próprio cliente. Quase tudo aqui está sempre ligado. Só regras, listas, layout e permissões por campo ficam atrás de flag de liberação gradual.

## Features

### Cadastro da pessoa

Cria, lê, edita e exclui pessoas. Toda pessoa precisa de nome e de pelo menos um contato (e-mail ou telefone). E-mail é gravado em minúsculas e telefone só com dígitos, sem o 55. As regras de obrigatoriedade, os tipos de campo e as permissões do papel valem em toda gravação.

- **Criação:** exige todos os campos marcados como obrigatórios que aparecem no formulário de criação.
- **Edição parcial:** campo omitido mantém o valor e `null` limpa. Só nome e status nunca ficam vazios. Limpar um campo obrigatório é barrado.
- **Concorrência:** a edição aceita a versão lida (`expectedUpdatedAt`). Se outra pessoa alterou o cadastro antes, a resposta é 409 com o estado atual. Sem a versão, nada é conferido.
- **Status e valor:** moram na oportunidade principal da pessoa. Sem status informado, a pessoa nasce no primeiro status aberto do pipeline padrão. Veja [Oportunidades e pipelines](crm-oportunidades-e-pipelines.md).
- **Excluir:** sempre manda para a lixeira. Arquivar, restaurar e a purga estão em [Histórico, arquivo e LGPD](crm-historico-arquivo-e-lgpd.md).
- **Efeitos ao salvar:** checagem de duplicidade, distribuição do responsável, enriquecimento por CNPJ e recálculo do score. Estão em [Qualidade e produtividade](crm-qualidade-e-produtividade.md).

### Campos em três camadas

Cada empresa enxerga uma lista única de campos, que mistura três origens.

- **Camada 1, fixa do sistema (9 campos):** Nome, E-mail, Telefone, Origem do lead, Status, Tags, Última interação, Primeiro nome e Valor. Estão sempre ativos.
- **Camada 2, opcional do sistema (19 campos):** Empresa, Cargo, CPF, CNPJ, Cidade, UF, CEP, Endereço, Campanha (UTM), Data de conversão, Probabilidade de fechamento, Data prevista de fechamento, Motivo da perda, Lead score, Próximo follow-up, Base legal, Data da base legal, Origem do registro e Opt-out de marketing. Todos nascem desligados, menos Motivo da perda (decisão do dono, 07/11/2026). A data da base legal, a origem do registro e a data do opt-out são só leitura: o back carimba.
- **Camada 3, personalizados:** criados pelo cliente. Não há teto de quantidade no código. O valor é guardado pelo id do campo, então renomear não perde dado.
- **Fonte única:** `GET /crm/leads/fields` devolve os campos ativos já no recorte do papel de quem pergunta, e é a base de formulário, filtro e mapeamento de import e export.
- **Dados órfãos de propósito:** desligar um campo, ocultá-lo ou excluí-lo nunca apaga o valor gravado. Ele só deixa de aparecer.

### Tipos de campo

Cada tipo valida, grava em forma padronizada, converte na importação, filtra e exporta. Os 18 tipos valem para campos personalizados e para os campos do sistema do mesmo tipo.

| Grupo                    | Tipos                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Básicos (11)             | Texto, Texto longo (até 10.000 caracteres), Número, Monetário (reais, até 2 casas), Data, Sim/Não, Seleção, Seleção múltipla, Telefone, E-mail e URL (http/https) |
| Avançados (7, marco M11) | CPF, CNPJ (inclui o alfanumérico), CEP, Endereço (CEP, logradouro, número, complemento, bairro, cidade e UF), Usuário, Intervalo de datas e Hora                  |

- **Telefone:** só dígitos, 10 ou 11, aceitando máscara e o DDI 55.
- **CPF, CNPJ e CEP:** gravados sem máscara e saem formatados no export.
- **Usuário:** aponta para um usuário ativo da empresa.
- **Intervalo de datas:** o início não pode ser depois do fim.
- **Seleção e Seleção múltipla:** exigem ao menos uma opção. As opções do campo personalizado ficam no próprio campo e não usam as listas configuráveis.

### Campos personalizados

O dono cria, edita e exclui campos próprios com nome, tipo, opções e obrigatoriedade.

- **Nome único:** vale entre personalizados e campos do sistema, sem diferenciar maiúscula, inclusive o nome atual de um campo do sistema renomeado.
- **Chave:** é gerada a partir do nome e nunca muda. Não pode repetir a chave de um campo do sistema.
- **Tipo travado:** depois que algum registro tem valor no campo, o tipo não muda. É preciso criar outro campo.
- **Excluir é desativar:** os valores continuam salvos nas pessoas e a API avisa isso.
- **Obrigatório:** o campo precisa aparecer no formulário de criação.

### Configuração de campos

A área Configurações → Campos controla a vitrine de cada campo, sem mexer em código.

- **Nome de exibição:** renomear qualquer campo. `label: null` volta ao nome padrão do sistema.
- **Obrigatório:** liga e desliga, exceto onde o contrato do sistema trava.
- **Visibilidade por contexto:** quatro telas independentes (Criação, Ficha, Tabela e Filtros). Desligar uma tela não apaga dado. Campo oculto em todas as telas some da resposta.
- **Ordem:** reordenar todos os campos juntos (sistema e personalizados) e "Voltar ao padrão".
- **O que cada campo permite:** o back valida, a tela só reflete.

| Campo                                         | Pode ocultar | Pode ficar opcional  | Pode renomear |
| --------------------------------------------- | ------------ | -------------------- | ------------- |
| Nome                                          | não          | não                  | sim           |
| E-mail e Telefone                             | não          | não (basta um dos 2) | sim           |
| Status                                        | não          | sim                  | sim           |
| Demais da Camada 1, Camada 2 e personalizados | sim          | sim                  | sim           |

- **Forecast liga campos:** ligar `crm.forecast` num tenant liga Data prevista e Probabilidade em todas as telas (decisão do dono, 19/11/2026). Desligar a flag não os desliga. Veja [Forecast](crm-forecast.md).

### Primeiro nome

Campo do sistema derivado do Nome e editável, para personalizar mensagens ("Olá, Maria").

- **Criação:** sem valor informado, vale a primeira palavra do nome.
- **Mudança de nome:** o primeiro nome acompanha o nome enquanto ninguém o editou à mão. Se foi editado ("Zé"), fica.
- **Limpar:** vazio ou `null` volta ao derivado. Com nome, nunca fica vazio.
- **Import:** vale a mesma regra.

### Responsável

Cada pessoa tem um responsável, que precisa ser um usuário ativo da empresa.

- **Padrão:** na criação, vale quem está criando.
- **Quem pode atribuir:** qualquer papel. `GET /crm/usuarios` lista os possíveis responsáveis.
- **Tirar o responsável:** `null` na edição, ou pela edição em massa.
- **Distribuição automática:** com a flag ligada e sem responsável no payload, as regras da empresa decidem. Veja [Qualidade e produtividade](crm-qualidade-e-produtividade.md).

### Campo sensível

O dono marca um campo como sensível para escondê-lo do operador, por exemplo uma informação de saúde coletada em formulário.

- **Efeito:** o OPERADOR não vê nem edita o campo, com ou sem a flag `crm.permissoes`. DONO e MASTER veem tudo.
- **Liberação:** com `crm.permissoes` ligada, o dono pode liberar o campo para o operador.
- **Export:** o campo sensível só sai se pedido pelo nome, nunca nas colunas padrão.
- **Quem pode ser sensível:** personalizados e campos da Camada 2 editáveis. Nome, contato e demais campos da Camada 1 não podem. Os campos de LGPD carimbados pelo sistema também não.
- **Uso em formulários:** o campo sensível não é preenchido por quem responde o link. Veja [Formulários](crm-formularios.md).

### Regras de obrigatoriedade

O dono cria regras que tornam um campo obrigatório ou visível conforme a situação da pessoa. Com a flag desligada, nenhuma regra vale, nem a do sistema.

- **Por status:** campo obrigatório a partir de status escolhidos ou de uma categoria (aberto, ganho, perdido). A categoria evita quebrar a regra quando o cliente renomeia "Perdido".
- **Condicional:** campo obrigatório e/ou visível quando outro campo cumpre uma condição, com os mesmos operadores do filtro. A condição precisa ser sobre outro campo.
- **Regra do sistema:** "Motivo da perda obrigatório em Perdido". Só liga e desliga, não se exclui. Só vale com o campo Motivo da perda ligado.
- **Onde vale:** criação, edição (conferida contra a pessoa resultante), edição em massa, import e criação pelo quadro.
- **Quem cumpre:** a regra não vale para o papel que não pode preencher o campo (decisão do dono).
- **Mesma regra no front:** a função de avaliação é a mesma dos dois lados e roda os mesmos casos de teste. A validação que vale é a do back.

### Listas configuráveis

O dono edita as opções que alimentam os campos de escolha, sem pedir mudança de código.

| Lista             | Alimenta                                                                        |
| ----------------- | ------------------------------------------------------------------------------- |
| Status            | Campo Status (com categoria e probabilidade)                                    |
| Origem            | Origem do lead                                                                  |
| Motivo da perda   | Motivo da perda                                                                 |
| Tipo de atividade | Atividades (veja [Qualidade e produtividade](crm-qualidade-e-produtividade.md)) |
| Tags              | Tags (a lista nasce vazia e cresce com o uso)                                   |

- **Opção:** nome, cor (`#RRGGBB`), ordem e ativo ou inativo. O identificador interno é imutável e é o que fica gravado na pessoa. Renomear muda só o nome.
- **Em uso não se exclui:** só se desativa. A opção inativa some dos seletores, mas a pessoa antiga continua mostrando.
- **Gravação:** a pessoa só grava opção ativa, exceto a que já tinha. Tag digitada que não existe vira tag nova.
- **Status:** cada status tem uma categoria (aberto, ganho ou perdido). É preciso manter ao menos um status ativo em cada categoria, e não se muda a categoria de um status em uso.
- **Probabilidade padrão do status (FC1):** 0 a 100. Ganho é sempre 100 e perdido é sempre 0. Veja [Forecast](crm-forecast.md).
- **Listas semeadas:** Status, Origem, Motivo da perda e Tipo de atividade nunca ficam sem opção.
- **Opções iniciais:** um tenant novo recebe sugestões. Tenants que já tinham pessoas antes mantiveram as opções antigas, para nenhuma pessoa mudar.
- **Status de outros pipelines:** a lista de Status aqui é a do pipeline padrão. Os demais são geridos por pipeline em [Oportunidades e pipelines](crm-oportunidades-e-pipelines.md).
- **Sem a flag:** a tela de configuração responde 403, mas as opções continuam chegando em `GET /crm/leads/fields` e o cadastro segue validando contra elas.

### Layout da ficha e da tabela

O dono define como a pessoa aparece, e cada usuário pode ajustar o seu.

- **Identificador:** o campo que dá nome à pessoa na lista e na ficha. Pode ser Nome, Empresa, CNPJ, CPF, E-mail ou um personalizado de texto. Também entra na busca.
- **Subtítulo (até 2), destaques (até 4) e colunas da tabela:** qualquer campo ou referência fixa (Valor, Responsável, Estágio, Criado em).
- **Seções da ficha:** até 12, com nome de até 60 caracteres. O que não está em seção cai numa seção automática no fim ("Outros campos"), então campo novo nunca fica escondido sem querer.
- **Padrão da empresa:** só DONO e MASTER salvam. Sem configuração, vale um layout inicial do código.
- **Meu layout:** qualquer papel ajusta o seu, parcialmente, e pode "Voltar ao padrão". Nas listas (subtítulo, destaques e colunas), o que o padrão ganhar depois entra no fim da lista do usuário.
- **O layout organiza, a visibilidade esconde:** campo oculto, inativo ou proibido para o papel some do layout.
- **Reaproveitado:** as colunas padrão do export seguem o layout (com `crm.massa`). Veja [Busca e dados em massa](crm-busca-e-dados-em-massa.md) e [Quadro comercial](crm-quadro-comercial.md).

### Permissões por campo

O dono decide, campo a campo, o que o operador faz: editar, só ver ou nem ver.

- **Quem é configurável:** só o OPERADOR. DONO e MASTER ignoram e veem e editam tudo. A API já usa o papel como chave, para quando houver papéis novos.
- **Acessos:** editar (padrão), só ver e oculto. O padrão de campo sensível é oculto.
- **Leitura:** o campo oculto some de tudo: pessoa, lista, campos, filtro, histórico, layout e busca textual (e-mail, telefone e identificador ocultos deixam de ser pesquisados).
- **Escrita:** mandar um campo "só ver" ou oculto devolve 403 listando os campos. Nada é ignorado em silêncio. Na edição em massa, a conferência é uma só, antes de mexer em qualquer pessoa.
- **Travas:** o Nome é sempre editável. E-mail e telefone não podem ficar travados os dois ao mesmo tempo.
- **Obrigatoriedade:** não vale para quem não pode preencher o campo.
- **Import e export:** são só de gestão e não sofrem restrição.
- **Rótulos são públicos:** a lista de campos e seus nomes continua visível a todos. Ela traz rótulos, não dados.
- **Aviso de duplicidade:** cita o nome da pessoa parecida e o rótulo do campo que casou, mesmo oculto, mas nunca o valor.

## Estado

| Feature                        | Back   | Front                                            | Flag                                                         | Origem         |
| ------------------------------ | ------ | ------------------------------------------------ | ------------------------------------------------------------ | -------------- |
| Cadastro da pessoa             | pronto | sem handoff                                      | sempre ligado                                                | Base, P8, M2.5 |
| Campos em três camadas         | pronto | sem handoff (contrato no plano de Configurações) | sempre ligado                                                | M1             |
| Tipos básicos                  | pronto | sem handoff (contrato no plano de Configurações) | sempre ligado                                                | M2             |
| Tipos avançados                | pronto | sem handoff (contrato no plano de Configurações) | sempre ligado                                                | M11            |
| Campos personalizados          | pronto | sem handoff                                      | sempre ligado                                                | Base, M2       |
| Configuração de campos         | pronto | sem handoff (contrato no plano de Configurações) | sempre ligado                                                | M1, M2         |
| Primeiro nome                  | pronto | sem handoff (contrato no plano de Configurações) | sempre ligado                                                | M10            |
| Responsável                    | pronto | sem handoff                                      | sempre ligado                                                | Base           |
| Campo sensível                 | pronto | handoff entregue                                 | sempre ligado (liberar para o operador usa `crm.permissoes`) | FM1            |
| Regras de obrigatoriedade      | pronto | sem handoff (contrato no plano de Configurações) | `crm.regras`                                                 | M8             |
| Listas configuráveis           | pronto | sem handoff (contrato no plano de Configurações) | `crm.listas`                                                 | M3             |
| Probabilidade padrão do status | pronto | handoff entregue                                 | sempre ligado; `crm.forecast` liga os campos                 | FC1            |
| Layout da ficha e da tabela    | pronto | sem handoff (contrato no plano de Configurações) | `crm.layout`                                                 | M4             |
| Permissões por campo           | pronto | sem handoff (contrato no plano de Configurações) | `crm.permissoes`                                             | M13            |

## Regras e limites

**Papéis (quem escreve configuração)**

- A leitura é de todos os papéis. Criar, editar, excluir e reordenar campos, listas, regras, layout padrão e permissões é só de DONO e MASTER. O papel é conferido antes da flag, então o operador sempre recebe o mesmo 403.
- Ficam abertos a qualquer papel: cadastrar e editar pessoas, escolher responsável, "Meu layout" e a lista de campos.

**Cadastro**

- Nome obrigatório e ao menos um de e-mail ou telefone (o banco repete essa regra).
- Obrigatório só conta no formulário de criação, e o campo obrigatório precisa aparecer nele.
- Edição de pessoa anonimizada é barrada com 409.
- Lead score não é editável quando a pontuação está ligada.

**Campos**

- Nome de campo único por empresa. Chave do personalizado imutável. Tipo travado depois que há valor.
- Obrigatoriedade de Nome, E-mail e Telefone é fixa.
- A configuração fica em cache de 60 segundos, invalidado a cada gravação.

**Listas**

- Cor no formato `#RRGGBB`. Nome da opção único dentro da lista (sem diferenciar maiúscula).
- Probabilidade padrão de 0 a 100, só em status.
- Ao menos um status ativo de cada categoria (aberto, ganho, perdido).

**Regras**

- Até 100 regras por empresa e até 50 status por regra.

**Layout**

- Subtítulo até 2 campos, destaques até 4, seções até 12, nome de seção até 60 caracteres, ao menos 1 coluna. Cada campo aparece uma só vez.
- Seção com nome repetido é barrada.

**Decisões do dono**

- Só Motivo da perda nasce ligado entre os campos da Camada 2 (07/11/2026).
- Escrita em campo proibido dá 403, não é ignorada.
- Obrigatoriedade não vale para quem não pode preencher.
- Só o operador tem permissão configurável.
- Ligar o forecast liga Data prevista e Probabilidade (19/11/2026).

## Fica de fora

| Item                                                                      | Motivo                                                                     | Quando volta                |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------- |
| Campo personalizado na oportunidade (`custom_fields` e `entity` no campo) | O personalizado vale só para a pessoa; a oportunidade tem colunas próprias | Sem data                    |
| Campo por pipeline                                                        | Campos são da empresa, não de um pipeline                                  | Sem data                    |
| Papéis configuráveis além do operador                                     | DONO e MASTER ignoram permissão; não há outro papel                        | Quando surgir um papel novo |
| Restrição por papel de arquivar, excluir e atividades                     | Hoje qualquer papel pode                                                   | Sem data                    |
| Reativar um campo personalizado excluído                                  | Excluir só desativa; não há rota de reativação                             | Sem data                    |
| Rótulos do ciclo de vida configuráveis                                    | Lead, Em negociação e Cliente são rótulos sugeridos ao front, fixos        | Sem data                    |

## Ideias de expansão e refinamento

> Sugestões para decidir, não decisões.

| Ideia                                                       | Valor para o cliente                                                    | Depende de                              | Esforço (P/M/G) |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- | --------------- |
| Reativar campo excluído e mostrar os dados órfãos           | Recuperar um campo apagado por engano sem perder o histórico            | Rota de reativação e tela               | P               |
| Mudar o tipo de um campo com dados, com conversão assistida | Hoje o cliente precisa criar outro campo e migrar na mão                | Regras de conversão por par de tipos    | G               |
| Opções de seleção do personalizado usando as listas         | Uma lista só para gerir, com cor e desativação, em vez de opções soltas | Mudança no modelo do campo              | M               |
| Papéis além do operador com permissão por campo             | Equipes com mais de um perfil comum                                     | Definição de novos papéis (plataforma)  | M               |
| Campo personalizado na oportunidade                         | Dados de negócio por venda, não só por pessoa                           | `custom_fields` na oportunidade         | G               |
| Campo por pipeline                                          | Vendas e Atendimento com campos diferentes                              | `entity` no campo e layout por pipeline | G               |
| Restringir arquivar, excluir e atividades por papel         | Operador sem poder de excluir                                           | Papel conferido nessas rotas            | P               |

## Mapa técnico

**Rotas** (tudo sob `/crm`; leitura de qualquer papel, escrita de gestão, salvo o cadastro)

| Método e caminho                                                                                        | Para que serve                                                       |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET/POST /leads`, `GET/PUT/DELETE /leads/:id`                                                          | Cadastro (a lista é a busca sem filtro, veja o outro doc)            |
| `GET /leads/fields?contexto=`                                                                           | Campos ativos no recorte do papel                                    |
| `GET /usuarios`                                                                                         | Responsáveis possíveis                                               |
| `GET/POST /field-definitions`, `PUT/DELETE /field-definitions/:id`                                      | Campos personalizados (escrita: gestão)                              |
| `GET /configuracoes/campos`, `PUT /configuracoes/campos/:id`                                            | Configuração de um campo (nome, obrigatório, visibilidade, sensível) |
| `PUT /configuracoes/campos/ordem`, `POST /configuracoes/campos/ordem/padrao`                            | Reordenar e voltar ao padrão                                         |
| `GET /configuracoes/listas`, `POST/PUT/DELETE /configuracoes/listas/:tipo[/:id]`, `PUT .../:tipo/ordem` | Listas (`crm.listas`)                                                |
| `GET/POST /configuracoes/regras`, `PUT/DELETE /configuracoes/regras/:id`                                | Regras (`crm.regras`)                                                |
| `GET/PUT /configuracoes/permissoes`                                                                     | Permissões por campo (`crm.permissoes`, só gestão)                   |
| `GET /layout`, `PUT /layout/padrao`, `PUT/DELETE /layout/meu`                                           | Layout (`crm.layout`)                                                |

O contrato de entrada e saída de cada rota mora nos controllers (`controllers/*.controller.js`) e nos schemas Zod (`schemas/*.schema.js`). Não está copiado aqui.

**Tabelas** (schema `modulo_crm`, todas com RLS): `leads` (Camadas 1 e 2 em colunas, Camada 3 em `custom_fields` pelo id do campo), `crm_field`, `crm_field_visibility` (um contexto por linha), `crm_field_rule`, `crm_field_permission`, `crm_option` (listas, com `kind`), `crm_layout_config`, `crm_user_layout_override`.

**Flags:** `crm.listas`, `crm.layout`, `crm.regras`, `crm.permissoes`. `crm.forecast` liga dois campos pelo gancho `aoLigarFeatures`.

**Services centrais:** `field-schema.service.js` (resolver único e cache), `configuracoes-campos.service.js`, `field-definitions.service.js`, `tipos-campo.service.js` (validar, normalizar, converter, texto de busca), `primeiro-nome.service.js`, `regras*.service.js`, `listas.service.js`, `layout.service.js`, `permissoes.service.js` (schema do papel). As constantes ficam em `constants/campos.js`, `listas.js`, `layout.js`, `regras.js` e `permissoes.js`.

**Jobs e deploy:** sem job próprio. `pnpm crm:reconcile` semeia os campos do sistema e as listas de cada empresa e precisa rodar no deploy.
