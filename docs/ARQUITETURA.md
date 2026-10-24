# Arquitetura e modelo de dados

## Pastas

```
pentatlo-pwa/
├─ index.html                  meta tags iOS (apple-mobile-web-app-*, safe areas, theme-color)
├─ vite.config.ts              Vite + React + vite-plugin-pwa + Vitest
├─ public/                     favicon.svg e icons/ (192, 512, maskable, apple-touch-icon)
├─ scripts/generate-icons.mjs  gera os PNGs sem dependências (encoder PNG + zlib)
├─ docs/
│  ├─ RELATORIO_ANALISE.md     análise das planilhas, mapa de relação, inconsistências
│  └─ ARQUITETURA.md           este arquivo
├─ src/
│  ├─ domain/
│  │  ├─ schemas.ts            Zod: todos os tipos (SourceReference … BackupFile)
│  │  ├─ adherence.ts          regras de aderência (puras)
│  │  ├─ snapshot.ts           carrega o banco e calcula a visão de um dia (computeDay)
│  │  ├─ actions.ts            gravações de progresso, competição, deslocamento de calendário
│  │  ├─ backup.ts             exportar / prévia / restaurar / backups automáticos
│  │  ├─ dates.ts              datas locais, progresso temporal, deslocamento
│  │  └─ nutrition.ts          porções proporcionais (consulta), diferenças de macros
│  ├─ import/
│  │  ├─ workbook.ts           detecção XLS/XLSX pelos bytes, leitura SheetJS, mesclagens
│  │  ├─ normalize.ts          vírgula decimal, unidades, nomes, 4/4/9, datas do Excel
│  │  ├─ sessionText.ts        modalidade, zona, pace, intervalos, exercícios (derivados)
│  │  ├─ parsePlan.ts          20 abas do planejamento
│  │  ├─ parseBaseDiet.ts      TMB, DIETA (refeições em blocos + listas), MEDIDAS
│  │  ├─ crossCheck.ts         cruzamento entre arquivos + relatório
│  │  ├─ issues.ts             coletor de avisos/bloqueadores
│  │  └─ pipeline.ts           prepareImport (sem gravar) → commitImport (transação)
│  ├─ db/db.ts                 Dexie: tabelas de origem × tabelas de progresso
│  ├─ pwa/                     opções do SW/manifest, capacidades do aparelho, lembretes
│  ├─ screens/                 Hoje, Treinos, Dieta, Calendário, Mais, Gráficos, Importação
│  ├─ ui/kit.tsx               componentes (cards, anéis, sheets, toasts, badges de status)
│  ├─ hooks.ts                 useSnapshot (useLiveQuery), relógio, rota por hash
│  ├─ App.tsx / main.tsx
│  └─ index.css                tokens de cor claro/escuro, safe areas, redução de movimento
└─ tests/                      Vitest (fixtures sintéticas XLSX/XLS + teste opcional com arquivos reais)
```

## Fluxo de importação

1. `readWorkbook` confere a assinatura do arquivo (ZIP `PK` = XLSX; OLE2 `D0CF11E0` = XLS). Extensão renomeada é rejeitada.
2. SheetJS lê **valores em cache**, fórmulas e mesclagens (`cellFormula`, `cellNF`). Fórmula sem cache vira aviso e, quando a regra é conhecida (macros = Base_Alimentos × qtd ÷ medida-base; kcal = 4/4/9; volumes = soma das sessões), o valor é recalculado e marcado como `calculado`.
3. Parsers localizam cabeçalhos **por texto** (não por posição fixa) e guardam `SourceReference` em cada registro.
4. `crossCheck` compara plano × dieta-base. Plano = operacional; base = histórico. Só pede escolha quando há duas fontes do **plano** em conflito (ex.: perfil do dia no Calendário × Planilha Semanal).
5. `prepareImport` não grava nada → prévia/relatório. `commitImport` grava em uma transação, cria backup automático antes de reimportações e **nunca** escreve em tabelas de progresso.

## Separação no IndexedDB

| Grupo              | Tabelas                                                                                                                                                                             | Quem escreve                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Origem: plano      | phases, mesocycles, weeks, sessions, dayPlans, dietProfiles, meals, mealItems, paceZones, swimZones, guidelines, progressionTables, foods(origin=plan), coachNotes(origin=planilha) | só a importação do plano                                       |
| Origem: dieta-base | baseDiet, foods(origin=baseDiet)                                                                                                                                                    | só a importação da dieta-base                                  |
| Arquivos           | importFiles (metadados + SHA-256), importBlobs (bytes originais), reports, conflicts                                                                                                | importação                                                     |
| Progresso pessoal  | sessionLogs, mealLogs, hydration, supplements, supplementEntries, wellness, pains, personalNotes, substitutions, coachNotes(origin=usuario)                                         | só o usuário                                                   |
| Configuração       | meta[settings]                                                                                                                                                                      | usuário (a importação só preenche campos ainda não escolhidos) |

Chaves estáveis entre reimportações:

- sessão: `AAAA-MM-DD|período|tipo-normalizado` (data **do plano**);
- refeição: `perfil|ordem|nome`; registro de refeição: `dataDoPlano|chaveDaRefeição`.

Registros sem correspondência após reimportar continuam no banco e aparecem como "órfãos" no relatório.

## Deslocamento do calendário

`settings.planShiftDays` aplica-se na leitura: data real = data do plano + deslocamento. Como os registros de treino/refeição usam a data do plano, eles acompanham o deslocamento. Água, suplementos, bem-estar, dor e notas ficam na data real. Mudar a data da competição **não** altera o deslocamento.

## Modelo de dados (resumo — definição completa em `src/domain/schemas.ts`)

| Tipo                                   | Campos principais                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SourceReference                        | fileKind, fileName, sheet, cell, original, normalized, status, note                                                                                                                |
| SourcedNumber                          | original, value, cell, status                                                                                                                                                      |
| ImportFile                             | id (plan/baseDiet), fileName, size, format, sha256, importedAt, sheetNames                                                                                                         |
| ImportReport                           | files, counts, issues[], conflicts[], blocking, warnings                                                                                                                           |
| DataConflict                           | subject, field, planValue, baseValue, planSource, baseSource, operational, requiresChoice, resolution                                                                              |
| AthleteProfile                         | weightKg, heightCm, ageYears, activityFactor, dailyExpenditureKcal, expenditureFormula                                                                                             |
| Competition                            | date, source, trackAccessFrom                                                                                                                                                      |
| TrainingPhase / Mesocycle / Microcycle | código, nome, semanas, objetivos, microciclos                                                                                                                                      |
| TrainingWeek                           | número, datas, mesociclo, microciclo, carga, objetivo, observações, volumes planejados                                                                                             |
| TrainingSession                        | key, semana, data, período, tipo, modalidade, prioridade (» / ◦), duração, intensidade, zona, pace, km, m, lançamentos, contatos, intervalos, detalhe original, exercícios, issues |
| Exercise                               | raw, name, sets, reps, load, rest                                                                                                                                                  |
| Modality                               | corrida, natacao, forca, granada, tiro, ppm, pnu, mobilidade, competicao, outro                                                                                                    |
| PaceZone / SwimmingZone                | nome, pace/sigla, %FCmáx/descrição, uso                                                                                                                                            |
| DietProfile / NutritionTarget          | id, nome, kcal/P/C/G planejados, g/kg, quando usar, isEstimate, hasMeals                                                                                                           |
| Meal / MealItem / MealPlan             | perfil, ordem, nome, horário, relação com treino, totais; item: alimento, quantidade (SourcedNumber), unidade, macros, kcal calculada                                              |
| Food / FoodServing / FoodEquivalence   | nome original/normalizado, categoria, medida-base, unidade, P (A/V), C, G, kcal informada/calculada/diferença, fonte, status, duplicateGroup                                       |
| BaseDiet                               | atleta, 9 refeições (itens + totais do arquivo + soma conferida), totais do dia, %/g/kg, medidas                                                                                   |
| HydrationTarget / HydrationEntry       | meta (usuário/planilha/não definida) + referência textual; registros com horário                                                                                                   |
| Supplement / SupplementEntry           | ativo, horário, dose manual, observação, referência da planilha; tomado/ignorado                                                                                                   |
| WellnessEntry / PainEntry              | energia, humor, sono, fadiga, dor muscular, dor localizada; local, intensidade 0–10, início, impacto                                                                               |
| CoachNote / PersonalNote               | texto, data, origem                                                                                                                                                                |
| AdherenceScore / DailyChecklist        | treino, dieta, suplementos, hidratação, geral, pesos aplicados, fórmula                                                                                                            |
| AppSettings                            | competição, deslocamento, pesos, créditos, hidratação, tema, movimento, lembretes                                                                                                  |
| BackupFile                             | format, version, appVersion, kind (completo/progresso), createdAt, tables                                                                                                          |

## Fórmula de aderência

```
treino   = Σ crédito(principal) + Σ peso_opcional × crédito(opcional realizada)
           ─────────────────────────────────────────────────────────────────────
                    nº principais + Σ peso_opcional (só opcionais realizadas)
           crédito: concluído 1 · parcial 0,5 (configurável) · demais 0

dieta    = Σ crédito(refeição planejada) ÷ nº de refeições planejadas do perfil
           conforme 1 · parcial 0,5 · substituída 0,75 (configuráveis) · pendente/não realizada 0

suplem.  = ativos tomados ÷ ativos                (sem ativos → não aplicável)
água     = min(1, total ÷ meta)                    (sem meta → não aplicável)

geral    = Σ peso_i × valor_i ÷ Σ peso_i   (somente categorias aplicáveis; pesos 50/30/10/10 editáveis)
```

Progresso temporal (dias decorridos ÷ dias até a competição), conclusão de tarefas (itens marcados ÷ itens do dia) e aderência são exibidos separadamente.
