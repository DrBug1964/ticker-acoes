# Ticker de Ações

Página local com cotações quase em tempo real (Yahoo Finance, ~30 s, possível atraso conforme a bolsa) de ações farmacêuticas, nucleares, de memória e de tecnologia/espaço.

## Usar

```bash
npm start            # abre em http://localhost:3000 (PORT=4000 npm start para mudar)
npm test             # testes automáticos (sem rede)
npm run check:live   # confirma que os 12 símbolos respondem no Yahoo
```

Requer Node.js 22 ou superior. Não há dependências para instalar.

## Mudar as empresas

Edite `src/tickers.js` (símbolo, nome e setor) e reinicie o servidor.
