# Ticker de Ações

Aplicação para Mac e Windows que mostra, quase em tempo real, as ações que escolher: faixa deslizante no topo e cartões com preço, variação e gráfico do dia. Os dados ficam só no seu computador.

## Instalar (utilizadores)

1. Descarregue o instalador da última versão em **Releases**:
   - **Mac:** o `.dmg`. Se o Mac tem chip Apple (M1, M2, M3…), escolha o ficheiro com `arm64` no nome; se é um Mac Intel, escolha o outro. Em dúvida: menu Apple → **Acerca deste Mac**.
   - **Windows:** o `.exe`.
2. Abra-o e instale. Como a aplicação não está assinada, o sistema mostra um aviso:
   - **Mac:** tente abrir a aplicação; quando o Mac a recusar, abra **Definições do Sistema → Privacidade e Segurança**, desça até à mensagem sobre "Ticker Acoes" e clique em **Abrir mesmo assim**. Se disser que a aplicação está "danificada", abra o Terminal e corra `xattr -cr "/Applications/Ticker Acoes.app"` e tente outra vez.
   - **Windows:** **Mais informações** → **Executar mesmo assim**.
3. Clique em **+ Adicionar ações**, escolha o mercado, pesquise por nome ou símbolo (por exemplo "micron" ou "NVDA") e adicione. Até 30 ações.

## Fonte dos dados

- **Yahoo Finance (por defeito, sem chave):** todos os mercados (EUA, Seul, Londres, Frankfurt, Paris, Amesterdão, Lisboa, Tóquio, Hong Kong). **Não é uma fonte oficial:** pode deixar de funcionar sem aviso, os termos do Yahoo não preveem redistribuição e os preços podem ter atraso.
- **Finnhub (chave própria):** fonte oficial. Crie uma conta gratuita em finnhub.io, copie a chave e cole-a em **Definições**. O plano gratuito só cobre ações dos EUA e não tem gráfico do dia.

Nada é recolhido sobre si: a aplicação só contacta a fonte de dados que escolher.

## Desenvolvimento

```bash
npm install
npm test             # testes automáticos (sem rede)
npm run check:live   # confirma que a pesquisa e as cotações funcionam no Yahoo
npm run app          # abre a aplicação Electron
npm start            # só o servidor, em http://127.0.0.1:3000 (para o browser)
npm run pack         # gera a aplicação sem instalador, em dist/
npm run dist         # gera o instalador da plataforma atual, em dist/
```

Requer Node.js 22.

## Publicar uma versão

Crie um repositório no GitHub, envie o código e crie uma etiqueta: `git tag v1.0.0 && git push --tags`. O fluxo em `.github/workflows/release.yml` compila o instalador do Mac e o do Windows e publica-os numa Release.
