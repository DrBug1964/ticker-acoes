# Ticker de Ações em Quase Tempo Real — Design

Data: 2026-10-01

## Objetivo
Página web local que mostra, quase em tempo real, preço e variação de ações de empresas dos setores farmacêutico, nuclear, memória (chips) e tecnologia/espaço. Uso: acompanhamento pessoal, não negociação.

## Decisões acordadas
- Dados gratuitos do Yahoo Finance, atualização a cada 30 s (pode haver atraso conforme a bolsa).
- Abordagem: servidor local pequeno (Node.js) + página HTML/CSS/JS sem frameworks.
- Interface: faixa a deslizar (ticker) + grelha de cartões por setor com mini-gráfico do dia.
- Alojamento online fica fora desta versão.

## Tickers
| Setor | Tickers |
|---|---|
| Farmacêutico | PFE, NVO, LLY |
| Nuclear | CCJ, LEU, CEG |
| Memória | MU, 000660.KS (SK Hynix), 005930.KS (Samsung) |
| Tecnologia e espaço | NVDA, TSLA, SPCX (SpaceX, NASDAQ) |

A lista vive num único sítio no código e edita-se à mão.

## Arquitetura
**Servidor (`server.js`)**
- A cada 30 s faz um único pedido agrupado ao Yahoo Finance para os 12 tickers.
- Guarda o último valor bom por ticker e os pontos do dia para os mini-gráficos.
- Serve a página estática e `GET /api/quotes` (JSON com preço, variação %, variação absoluta, moeda, estado do mercado, série do dia, marca de "desatualizado").

**Página (HTML + CSS + JS)**
- Pede `/api/quotes` a cada 30 s.
- Faixa no topo + grelha de 4 secções com 3 cartões cada.

Fluxo: Yahoo Finance → servidor (30 s) → `/api/quotes` → página (30 s) → ecrã.
Arranque: `node server.js`, abrir `localhost:3000`.

## Interface
- Tema escuro, números em fonte monoespaçada. Verde/vermelho só para subida/descida.
- Cor de destaque por setor: farmacêutico azul, nuclear amarelo, memória violeta, tecnologia/espaço laranja.
- Faixa: desliza da direita para a esquerda a velocidade constante, pára com o rato por cima; cada item mostra símbolo, preço, seta e variação %, com etiqueta do setor.
- Cartão: nome, símbolo, preço grande, variação % e absoluta, "Aberto"/"Fechado", mini-gráfico do dia (verde/vermelho).
- Preço pisca ~1 s (verde se subiu, vermelho se desceu) ao mudar.
- Indicador "Atualizado há X s"; fica amarelo após mais de 2 min sem dados novos.
- Preços na moeda de cada ação, com símbolo visível.
- Telemóvel: cartões numa coluna.

## Erros
- Yahoo falha: mantém último valor bom, marca "desatualizado", tenta no ciclo seguinte.
- Um ticker falha: só esse cartão mostra "sem dados".
- Erro de limite de pedidos: espera o dobro do tempo antes de repetir.
- Servidor desligado: página mostra "Sem ligação ao servidor" e recupera sozinha.
- Dados inválidos (vazio/`null`): ignorados, mantém-se o valor anterior.

## Testes
- Automáticos (Node, sem bibliotecas extra), com respostas do Yahoo gravadas: interpretação da resposta, manutenção do último valor bom em falha, formatação de preços e moedas.
- Verificação dos 12 símbolos contra o Yahoo real antes de dar por concluído.
- Verificação manual: 12 preços reais, faixa a deslizar, piscar ao mudar, aviso "desatualizado" sem internet.

## Fora do âmbito
Alertas, histórico de vários dias, contas de utilizador, escolha de tickers pela interface, alojamento online.
