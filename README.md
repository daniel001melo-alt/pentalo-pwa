# Pentatlo Militar — PWA de preparação 2026/27

App instalável no iPhone para acompanhar o ciclo de 18 semanas (26/10/2026 → competição) do plano de treino e nutrição, com a dieta-base original como referência histórica. Funciona **offline**, sem login, sem conta e sem servidor: tudo fica no IndexedDB do aparelho.

- Relatório das planilhas (feito antes do código): [docs/RELATORIO_ANALISE.md](docs/RELATORIO_ANALISE.md)
- Arquitetura, pastas, modelo de dados e fórmulas: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)

## Stack

React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · Dexie (IndexedDB) · Zod · SheetJS 0.20.3 (XLS **e** XLSX) · Recharts · date-fns · vite-plugin-pwa (Workbox) · Vitest · ESLint · Prettier.

SheetJS é instalado do CDN oficial (`cdn.sheetjs.com`): a versão do npm (0.18.5) está desatualizada e tem vulnerabilidades conhecidas.

## Executar

Requer Node.js 18.18+ (testado com Node 24).

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run test
```

Outros: `npm run lint`, `npm run format`, `npm run preview` (serve o build), `npm run icons` (regenera os ícones).

### Teste com os arquivos reais (opcional)

Os testes usam planilhas **sintéticas** geradas em XLSX e XLS reais (`tests/fixtures.ts`). As planilhas pessoais não entram no repositório (`.gitignore` bloqueia `*.xls`/`*.xlsx`). Para validar com os arquivos reais:

```bash
PENTATLO_PLAN_FILE="/caminho/Plano_Pentatlo_Militar_Daniel_2026-27.xlsx" PENTATLO_DIET_FILE="/caminho/DIETA BASE - MASCULINA.xls" npm run test
```

No Windows (PowerShell): `$env:PENTATLO_PLAN_FILE="..."; $env:PENTATLO_DIET_FILE="..."; npm run test`.

## Primeiro uso

1. Abra o app → assistente de configuração.
2. Passo 1: escolha o planejamento (.xlsx). Passo 2: a dieta-base (.xls). O formato é verificado pelo conteúdo do arquivo.
3. Passo 3/4: análise e **relatório de importação** (arquivos, abas, contagens, divergências, avisos, bloqueadores).
4. Passo 5: confirmar. Os arquivos originais ficam guardados no aparelho; não é preciso carregá-los de novo.

Reimportar: **Mais › Importação e relatório › Reimportar** (cada arquivo separadamente). Progresso pessoal, configurações e histórico nunca são sobrescritos; um backup automático é criado antes.

## Publicar

O build (`dist/`) é estático. Qualquer hospedagem HTTPS serve (o Service Worker exige HTTPS, exceto em `localhost`).

**GitHub Pages** (repositório `usuario/pentatlo-pwa`):

```bash
BASE_PATH=/pentatlo-pwa/ npm run build
```

Publique o conteúdo de `dist/` na branch `gh-pages` (ou use a Action oficial "Deploy static content to Pages" apontando para `dist`). O app usa rotas por `#`, então não precisa de regra de reescrita.

**Netlify / Vercel / Cloudflare Pages:** comando de build `npm run build`, pasta de saída `dist`. Nenhuma variável é necessária quando publicado na raiz do domínio.

Atenção: o endereço publicado fica acessível a quem tiver o link, mas **não contém seus dados** — as planilhas só existem no aparelho de quem as importar.

## Instalar no iPhone

1. Abra o endereço publicado no **Safari**.
2. Toque em **Compartilhar** → **Adicionar à Tela de Início** → **Adicionar**.
3. Abra pelo ícone "Pentatlo" (tela cheia). Com internet na primeira abertura, o app fica disponível offline.
4. Importe as planilhas **dentro do app instalado** (no iOS, o app instalado tem armazenamento separado do Safari).
5. Opcional: Mais › Lembretes › Permitir notificações (iOS 16.4+, só no app instalado).
6. Faça um backup em Mais › Backup e guarde o JSON (Arquivos/iCloud).

Atualizações: quando houver versão nova, aparece a faixa "Nova versão disponível". Os dados ficam no IndexedDB, fora do cache, e são mantidos.

## Funcionalidades

- **Hoje** (com dashboard): data, fase, semana, microciclo, carga, objetivo semanal, dias para a prova, progresso temporal, aderência do dia e da semana (com fórmula), próximo treino, treinos do dia, perfil nutricional, kcal/macros planejados e g/kg da planilha, próxima refeição e todas as refeições, água (+250/+500/+1 L, manual, desfazer, histórico), creatina/beta-alanina, bem-estar, dor, notas do coach (planilha + suas) e metas da semana (planejado × concluído). Tudo marcável sem sair da tela; ‹ › navega entre dias.
- **Treinos**: busca (exercício, modalidade, sessão, objetivo, detalhe), filtros (data, semana, fase, modalidade, intensidade derivada, status, principal/opcional), próximo treino destacado, ficha com duração, volume, pace, zona, séries, repetições, intervalos, objetivo, texto original, origem e orientações relacionadas; registro de status (não iniciado, em andamento, concluído, parcial, ignorado), RPE 0–10, observações, data/hora, dor e motivo. Abas de progressões (Corrida, Natação, Força, Granada, Tiro, Pistas) e zonas/paces.
- **Dieta**: do dia (perfil, refeições na linha do tempo com os treinos, alimentos, quantidades, P/C/G/kcal por refeição e total, orientações da Dieta_Timing), calendário nutricional (texto + cor), dieta-base original (dados físicos, FA, gasto do arquivo, 9 refeições com vazias, totais originais × soma conferida, comparação com o plano, medidas) e base de alimentos (busca e filtros por nome, categoria cutting/bulking/proteína/gordura, macro predominante, unidade, fonte, status; porções do mesmo alimento; consulta proporcional). Substituição **opcional**, com diferenças, confirmação, salva como escolha pessoal.
- **Calendário**: mês e semana; treinos, nutrição ou combinado; sessões principais/opcionais, perfil, refeições, aderência, água, suplementos e alertas — com texto e símbolos, não só cor.
- **Mais**: gráficos (aderência diária/semanal/por fase, treinos planejados × concluídos, RPE, água, refeições, distribuição e kcal/macros por perfil, dieta-base × plano, progresso temporal), configurações (competição, deslocamento de calendário, pesos, créditos, meta de água, tema, movimento), suplementos, lembretes, histórico, importação/relatório, backup (completo / só progresso / importar com prévia, mesclar sem duplicar ou substituir, backups automáticos), instalação e limitações.

## Limitações reais

- **Lembretes só com o app aberto.** Sem servidor de push, um PWA não agenda notificações locais com o app fechado. Com permissão, aparecem como notificação; sem, como aviso interno.
- **Sem widget nativo** na Tela de Início do iOS. Substitutos: card de progresso/resumo na tela Hoje, badge no ícone (iOS 16.4+ instalado) e atalhos de manifest (Android/desktop; o iOS não mostra).
- **Sem sincronização**: dados só no aparelho. O Safari pode apagar dados de sites não instalados após inatividade — instale na Tela de Início e exporte backups.
- **Ingestão real não é medida**: kcal/macros são os planejados; marcar refeição não estima consumo.
- **Horários dos treinos são aproximados** pelo período (premissa da planilha: AM ≈06:00, PM ≈16:00).
- **Classificação de intensidade e modalidade** é derivada do texto (marcada como derivada); o texto original é sempre exibido.
- Não é recomendação médica, nutricional ou de treino; não diagnostica lesões; não sugere doses.
- No navegador embutido usado no desenvolvimento, o registro do Service Worker foi recusado pelo próprio navegador; o SW gerado foi conferido pelo conteúdo (precache de todos os assets + fallback de navegação) e deve ser validado no Safari/Chrome reais.

## Checklist de aceitação

| #   | Critério                                                                                              | Como verificar                                 | Situação               |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------- |
| 1   | Análise e relatório antes do código                                                                   | `docs/RELATORIO_ANALISE.md`                    | ✅                     |
| 2   | Lê XLS real e XLSX real, rejeita extensão renomeada                                                   | `tests/importers.test.ts`                      | ✅                     |
| 3   | 251 sessões, 218 » / 33 ◦, 18 semanas, 6 fases, 6 perfis, 34 refeições, 127 itens, 32 alimentos       | `tests/realFiles.test.ts` (arquivos reais)     | ✅                     |
| 4   | Dia → treino → perfil → refeições; 126 dias conferidos com a Planilha Semanal                         | testes + tela Hoje                             | ✅                     |
| 5   | Vírgula decimal, números como texto, unidades, nomes, duplicatas sem união, 4/4/9 só como conferência | `tests/normalize.test.ts`, `importers.test.ts` | ✅                     |
| 6   | Origem de cada dado (arquivo, aba, célula, original, normalizado, status)                             | botão "origem" nas telas                       | ✅                     |
| 7   | Divergências entre arquivos listadas, plano operacional, base histórica                               | relatório + Dieta-base                         | ✅                     |
| 8   | Fórmulas sem cache e células mescladas tratadas                                                       | testes                                         | ✅                     |
| 9   | Reimportação sem perda de progresso, órfãos preservados                                               | `tests/storage.test.ts`                        | ✅                     |
| 10  | Aderência com redistribuição de pesos, principal × opcional, parcial, fórmula visível                 | `tests/adherence.test.ts` + tela Hoje          | ✅                     |
| 11  | Data da competição configurável; deslocamento separado com prévia, backup e confirmação               | `storage.test.ts` + Configurações              | ✅                     |
| 12  | Backup completo/progresso, validação de versão, prévia, sem duplicar, backup automático               | `storage.test.ts`                              | ✅                     |
| 13  | Nenhuma meta de água, dose ou valor inventado                                                         | meta = não definida; doses vazias              | ✅                     |
| 14  | Build de produção com Service Worker e manifest                                                       | `npm run build`                                | ✅                     |
| 15  | Offline após a primeira abertura no iPhone                                                            | instalar e abrir em modo avião                 | ⏳ validar no aparelho |
| 16  | Notificações no iPhone instalado (iOS 16.4+)                                                          | Mais › Lembretes                               | ⏳ validar no aparelho |
