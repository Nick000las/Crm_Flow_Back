# Sprint 17 — Cobrança de Assinatura

Escopo: fluxo de pagamento recorrente da mensalidade (Núcleo + Módulos). NÃO confundir com a Wallet de consumo Meta/IA (Bloco 1.3.2), que é um fluxo separado e já implementado em sprint anterior (Fase 3).

## Objetivo da sprint
1. Integração com gateway de pagamento (Pix Automático + cartão + boleto)
2. Máquina de estados do tenant (trial/active/past_due/suspenso/cancelado)
3. Webhook do gateway com validação de assinatura + idempotência
4. Régua de cobrança automatizada (dunning) via BullMQ

## Contexto de arquitetura (extraído do MASTER_DOCUMENT.md, Bloco 1.3.1)

**Trilho de cobrança:**
- Pix Automático como principal (menor custo, sem inadimplência involuntária de cartão)
- Cartão de crédito recorrente como fallback/alternativa
- Boleto como opção manual residual — SEM papel na automação de status (não tem confirmação em tempo real)
- Gateway: Pagar.me, Asaas ou Mercado Pago (decisão de custo/suporte, não arquitetural) — suportam Pix Automático + cartão + boleto numa API só

**Máquina de estados do tenant** (NÃO usar campo booleano `is_paid`):
```
trial → active → past_due (período de graça, acesso ainda liberado) → suspenso (acesso bloqueado)
                     ↑_____________________________________________|
                     (pagamento recuperado)
active/suspenso → cancelado (fluxo de Offboarding, ver Bloco 1.1.5/2.4)
```
- `past_due`: cobrança falhou, período de graça configurável (ex: 3-5 dias), acesso ainda liberado
- `suspenso`: graça esgotada, acesso bloqueado (login redireciona para tela de regularização), dados preservados conforme retenção do Bloco 2.4

**Webhook do gateway:**
- Validação de assinatura obrigatória antes de aceitar qualquer mudança de estado (mesmo princípio já usado no webhook da Meta — payload assinado pelo emissor, validado pelo backend)
- Idempotência: guardar ID do evento processado, ignorar reentrega

**Dunning automatizado:**
- Ao entrar em `past_due`: job(s) atrasado(s) no BullMQ (ex: dias 1, 3, 5 do período de graça) disparando lembrete via WhatsApp/e-mail
- Reaproveitar o MESMO padrão já implementado para notificação proativa de incidente (Bloco 7.2 — job agendado, cancelável se resolvido antes do disparo). Não reinventar o mecanismo.

## Dependências desta sprint
- Auth/RBAC (Fase 1, sprints 2-4) — já implementado
- Padrão de job atrasado/cancelável no BullMQ (Fase 3, sprint 8) — já implementado, reaproveitar
- Padrão de validação de assinatura de webhook (Fase 3, sprint 8, webhook da Meta) — já implementado, reaproveitar a mesma abordagem

## O que a Sprint 18 (Onboarding) vai depender desta sprint
O fluxo de provisionamento de tenant (Bloco 1.1.5) cria o tenant já com status `trial` — a máquina de estados desta sprint precisa estar pronta antes.

## Fora de escopo nesta sprint
- Wallet de consumo Meta/IA (já existe, Bloco 1.3.2)
- Qualquer UI de onboarding assistido (Sprint 18)
