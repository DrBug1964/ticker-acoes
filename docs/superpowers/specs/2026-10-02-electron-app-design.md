# Ticker de Ações como aplicação distribuível (Electron) — Design

Data: 2026-10-02
Substitui, no que respeita à lista de ações e à distribuição, o design `2026-10-01-ticker-acoes-design.md` (a lista fixa de 12 tickers e o arranque com `npm start` deixam de existir). O que não é contrariado aqui mantém-se: atualização a cada 30 s, faixa deslizante, cartões com mini-gráfico, tema escuro, tratamento de erros por ticker, texto em português de Portugal.

## Objetivo
Uma aplicação de secretária (Mac e Windows) que outras pessoas descarregam e correm no seu computador, sem instalar Node nem mais nada. Cada utilizador escolhe, num formulário, as ações que quer seguir e o mercado de cada uma, e vê-as num ticker e numa grelha de cartões quase em tempo real.

## Decisões acordadas
- Distribuição: aplicação autónoma para Mac (`.dmg`) e Windows (`.exe`), feita com Electron. Cada pessoa tem a sua lista, guardada no seu computador. Sem contas, sem servidor alojado.
- Fonte de dados dupla: Yahoo Finance por defeito (sem chave, todos os mercados) e, opcionalmente, Finnhub com chave do próprio utilizador (fonte oficial, plano gratuito só com EUA).
- A lista é livre, por isso os cartões e o ticker agrupam por **mercado**, não por setor.
- Fora do âmbito: contas e sincronização, alertas, atualizações automáticas, assinatura dos instaladores (o sistema mostrará o aviso de "programador não verificado" ao abrir), histórico de vários dias.

## Aviso sobre o Yahoo Finance
O Yahoo não oferece API oficial e os seus termos não preveem redistribuição. A fonte pode deixar de funcionar ou ser bloqueada sem aviso. A aplicação diz isto nas Definições e o README repete-o. A arquitetura isola cada fonte atrás da mesma interface, para se poder trocar ou acrescentar fontes sem mexer no resto.

## Arquitetura

### Processo principal do Electron (`electron/main.js`)
- Garante uma única instância (`app.requestSingleInstanceLock`).
- Arranca o servidor HTTP em `127.0.0.1`, numa porta livre (porta 0), e abre uma `BrowserWindow` com `http://127.0.0.1:<porta>/`.
- A janela só navega para esse endereço (bloqueia navegação para outros sítios; ligações externas, como a da página para criar a chave, abrem no browser predefinido).
- Passa ao servidor a pasta de dados do utilizador (`app.getPath('userData')`).
- `contextIsolation` ativo e `nodeIntegration` desativado; a página não usa APIs do Electron, só HTTP local.

### Servidor (reaproveita `src/`)
Rotas, todas JSON, só acessíveis a partir da própria máquina:
- `GET /api/quotes` → `{ serverTime, groups: [{ market, quotes: Entry[] }], settings: { provider, hasKey } }`.
- `GET /api/search?q=<texto>&market=<id>` → `{ results: [{ symbol, name, market, marketLabel }] }`. `market` omitido ou `all` = todos. Mínimo 2 caracteres em `q`.
- `GET /api/watchlist` → `{ items: WatchItem[] }` e `PUT /api/watchlist` com `{ items }` (valida e guarda; máximo 30).
- `GET /api/settings` → `{ provider, hasKey }` e `PUT /api/settings` com `{ provider, apiKey? }`. A chave nunca é devolvida, só `hasKey`.
- Ficheiros estáticos de `public/` como agora, com a mesma proteção contra caminhos fora de `public/`.
- Pedidos com cabeçalho `Origin` ou `Host` que não sejam o endereço local são recusados (impede que uma página web aberta no browser do utilizador escreva na lista ou leia dados).

### Dados do utilizador (`src/settings.js`)
Ficheiro `settings.json` em `userData`:
```json
{ "version": 1, "provider": "yahoo", "apiKey": "", "watchlist": [
  { "symbol": "NVDA", "name": "NVIDIA", "market": "us" } ] }
```
- Escrita atómica (escreve num ficheiro temporário e renomeia).
- Ficheiro ausente ou corrompido: arranca com lista vazia, fonte Yahoo, e guarda uma cópia do ficheiro estragado como `settings.json.bak`.
- A chave fica só neste ficheiro, no computador do utilizador, e nunca vai para o browser nem para os registos.

### Fontes de dados (`src/providers/`)
Interface comum:
- `quote(symbol): Promise<Quote>` com `Quote = { price, previousClose, change, changePct, currency, marketOpen, series }` (como hoje; `series` pode ser vazia).
- `search(query, marketId): Promise<SearchResult[]>`.
- `markets: Market[]` (os mercados que a fonte suporta).

Fontes:
- **Yahoo** (`yahoo.js`, o cliente atual): cotação por `v8/finance/chart`; pesquisa por `v1/finance/search`. Mercados: EUA (NASDAQ, NYSE e NYSE Arca), Seul (KRX e KOSDAQ), Londres, Frankfurt, Paris, Amesterdão, Lisboa, Tóquio, Hong Kong. A correspondência entre `market` e o código de bolsa do Yahoo fica numa tabela única.
- **Finnhub** (`finnhub.js`): cotação por `/quote` (preço, fecho anterior), pesquisa por `/search`, com a chave do utilizador. Mercado: só EUA. A série do dia depende do plano da conta; se a fonte não a der, o cartão omite o mini-gráfico (não é erro). Antes de implementar, verifica-se com uma chave de teste quais os endpoints disponíveis no plano gratuito; o que não estiver disponível fica omitido, nunca simulado.

Trocar de fonte nas Definições refaz a lista de mercados do formulário. Ações já na lista cujo mercado a nova fonte não suporta ficam visíveis, marcadas "sem dados nesta fonte", e não são apagadas.

### Armazém e ciclo de atualização
`QuoteStore` e `refreshAll` mantêm-se. O armazém passa a poder ser reconstruído quando a lista muda: ações novas aparecem de imediato (sem dados até ao próximo pedido, que é antecipado), ações removidas desaparecem, e os valores das que ficam mantêm-se. O ciclo de 30 s e o recuo em limite de pedidos (HTTP 429, dobra até 5 min) mantêm-se. O ciclo ganha `try/finally` para nunca parar em silêncio.

## Interface

### Ecrã principal
- Faixa deslizante e grelha de cartões como hoje, agrupados por mercado (título do grupo = nome do mercado). A cor de destaque passa a ser por mercado, atribuída de uma paleta fixa de forma estável.
- Cada cartão tem um **✕** (visível ao passar o rato e sempre visível com teclado/toque) para retirar a ação.
- Topo: botão **+ Adicionar ações**, botão **Definições**, e o estado "Atualizado há X s".
- Lista vazia: ecrã vazio com a mensagem "Ainda não escolheu nenhuma ação" e o botão "Adicionar a primeira ação".
- Mantém-se a marcação clara de ações desatualizadas ("Desatualizado há X min", cartão esbatido).

### Formulário "Adicionar ações" (painel por cima)
1. **Mercado**: lista com "Todos" e os mercados da fonte atual.
2. **Pesquisa**: texto (nome ou símbolo), com atraso de ~300 ms antes de pesquisar; pedidos antigos são descartados se chegar uma pesquisa mais recente.
3. **Resultados**: nome, símbolo, mercado e botão **Adicionar** (ou "Já na lista"). Várias ações podem ser adicionadas sem fechar o painel.
4. Limite de **30** ações; ao atingi-lo, o painel avisa e desativa "Adicionar".
5. Estados: "A pesquisar…", "Sem resultados", "Não foi possível pesquisar. Tente outra vez." (com o motivo curto, por exemplo limite de pedidos).

### Definições
- Fonte de dados: Yahoo (sem chave) ou Finnhub (chave própria, só EUA), com o aviso sobre o Yahoo.
- Campo da chave (palavra-passe oculta), com ligação para criar a conta gratuita. Chave inválida ou limite excedido: aviso nas Definições; a lista continua visível com os últimos valores.

## Erros
- Falha de uma ação: só esse cartão fica "sem dados" ou "desatualizado"; as outras continuam.
- Pesquisa a falhar: mensagem no painel; a lista principal não é afetada.
- `PUT` com dados inválidos (símbolo vazio, mais de 30, mercado desconhecido, JSON mal formado): resposta 400 com mensagem, nada é guardado.
- Servidor interno a falhar ao arrancar (por exemplo, não conseguir abrir a porta): a janela mostra uma mensagem de erro em vez de ficar em branco.

## Distribuição
- `electron-builder` gera `.dmg` (Mac, Intel e Apple Silicon) e instalador `.exe` (Windows).
- O instalador do Windows é gerado no GitHub Actions (um fluxo que compila as duas versões ao marcar uma versão). O repositório GitHub é criado pelo utilizador; a app não envia nada para lado nenhum.
- README para utilizadores: como instalar, o que fazer perante o aviso de "programador não verificado" (Mac: abrir com botão direito → Abrir; Windows: "Mais informações" → "Executar mesmo assim"), como obter a chave Finnhub, e o aviso sobre o Yahoo.
- A aplicação não recolhe dados de utilização nem faz pedidos a outros sítios além da fonte de dados escolhida.

## Testes
- **Automáticos (Node, sem bibliotecas extra, sem rede):**
  - definições: ler, guardar, limite de 30, ficheiro ausente e corrompido (com cópia `.bak`), escrita atómica;
  - fontes: interpretação de respostas gravadas do Yahoo e do Finnhub (cotação e pesquisa), filtro por mercado, mapeamento de bolsas, série ausente;
  - armazém: reconstruir ao mudar a lista mantendo valores;
  - rotas: validação dos `PUT`, a chave nunca é devolvida, pesquisa com menos de 2 caracteres, recusa de `Origin`/`Host` externos, proteção de caminhos;
  - lógica da página que seja testável sem browser (agrupar por mercado, estados de pesquisa).
- **Verificação com a rede:** `npm run check:live` pesquisa e cota uma amostra de ações em vários mercados no Yahoo; o Finnhub verifica-se com uma chave de teste do utilizador.
- **À mão (e dito como tal ao fim):** abrir a aplicação instalada em Mac e em Windows, adicionar e retirar ações, mudar de fonte, janela sem lista, aviso do sistema ao abrir.

## Ajustes decididos ao escrever o plano (2026-10-02)
- **Finnhub e o limite de pedidos:** o plano gratuito permite 60 pedidos por minuto. Por isso o intervalo de atualização com o Finnhub é `max(30 s, (n+1)/50 minutos)` (37,2 s com 30 ações). O Yahoo mantém 30 s.
- **Finnhub, estado do mercado e gráfico:** "Aberto/Fechado" vem de `/stock/market-status` (um pedido por ciclo, em cache 60 s). A série do dia fica sempre vazia com o Finnhub, porque os candles não estão confirmados no plano gratuito; o cartão omite o gráfico, nunca o simula.
- **Aviso de fonte:** `/api/quotes` e `/api/settings` devolvem `notice` quando todas as ações da fonte atual falham (por exemplo "chave inválida ou sem permissão"). A página mostra-o numa faixa e nas Definições.
- **Erro de arranque do servidor interno:** mostra-se numa caixa de diálogo do sistema, não dentro da janela.
- **Resultados atrasados:** resultados de uma fonte antiga ou de uma ação já retirada, que cheguem depois de a lista ou a fonte mudar, são descartados.
