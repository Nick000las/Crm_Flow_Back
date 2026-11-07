# Handoff ao front: P0, motivo da perda ligado por padrão

"Motivo da perda" passa a nascer ligado, em tenants novos e nos que já existem. Antes, desligado, a regra "motivo obrigatório em Perdido" sumia e o Perdido aceitava oportunidade sem motivo.

Plano: [plano-execucao-formularios-forecast.md](./plano-execucao-formularios-forecast.md), marco P0.

## O que muda na tela

- O campo aparece na tabela, nos filtros, no formulário de lead e na ficha, como qualquer campo ligado. O dono ainda pode desligá-lo em Configurações.
- Mover para Perdido sem motivo, pelo arraste ou pelo menu "Mover para…", agora é recusado com `CAMPOS_OBRIGATORIOS`, e o formulário "Falta preencher para mover" abre. Isso foi testado na tela em 07/11/2026, com "Salvar e mover" concluindo.
- O diálogo "Mudar status" da ficha passa a mostrar o motivo, porque `campoDoMotivo` agora encontra o campo em `/fields`.

## O que não muda

Nenhum contrato de API mudou, e o front não precisa de nenhuma alteração de código.
