# Relatório de análise e importação — Pentatlo Militar 2026-27

Gerado **antes de qualquer código**, a partir da leitura integral (célula a célula, incluindo fórmulas,
formatos numéricos e células mescladas) dos dois arquivos:

| #   | Arquivo                                      | Formato real                            | Tamanho   | Papel                                    |
| --- | -------------------------------------------- | --------------------------------------- | --------- | ---------------------------------------- |
| 1   | `Plano_Pentatlo_Militar_Daniel_2026-27.xlsx` | OOXML (ZIP, assinatura `PK`)            | 114 489 B | **Fonte primária** do planejamento atual |
| 2   | `DIETA BASE - MASCULINA.xls`                 | BIFF8 / OLE2 (assinatura `D0 CF 11 E0`) | 107 008 B | **Fonte histórica** e base nutricional   |

Método: leitura via Excel (valores em cache + fórmulas + mesclagens) e conferência independente com
SheetJS 0.20.3 (a mesma biblioteca usada pelo importador do app). Os dois métodos deram o mesmo resultado.

---

## 1. Estrutura do arquivo 1 — Plano (20 abas)

Totais: **817 fórmulas**, **0 fórmulas sem resultado em cache**, **0 células com erro** (`#VALOR!` etc.).

| Aba                  | Faixa usada | Conteúdo                                                                                                                         | Observações de estrutura                                                                                                                                              |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LEIA-ME              | A1:C27      | Como usar, **premissas adotadas**, alterações feitas                                                                             | Premissas: competição sáb. 27/02/2027 (S18), S1 começa 26/10/2026, PPM/PNU a partir de 01/02/2027 (S15), peso 64 kg / 169 cm / 21 anos, 2 sessões/dia ≈06:00 e ≈16:00 |
| Análise              | A1:B39      | Análise dos arquivos da treinadora, capacidades, pontos fortes, lacunas, justificativa                                           | Texto chave → valor (col. A → col. B)                                                                                                                                 |
| Periodização         | A1:G19      | 6 fases (período, objetivos, características, volume, intensidade, sessões-chave) + 6 mesociclos × microciclos                   | Mesclagens C14:G14 … C19:G19 (microciclos)                                                                                                                            |
| Visão Geral          | A1:K23      | 18 semanas: datas, fase/mesociclo, microciclo, carga 1–5, código da fase, objetivo, km, m de natação, lançamentos, nº de sessões | H/I/J/K são `SUMIFS`/`COUNTIFS` sobre "Sessões (detalhe)"; K **exclui** "Flexibilidade / mobilidade"                                                                  |
| Planilha Semanal     | A1:K40      | Grade SEMANA × SEG–DOM; cada célula do dia contém as sessões (texto multilinha) e, na última linha, `DIETA: <perfil>`            | Linha de "Observações Sx" após cada semana, mesclada D:K (18 mesclagens). Marcadores `»` (principal) e `◦` (opcional); períodos `[AM]`, `[PM]`, `[Casa]`              |
| Sessões (detalhe)    | A1:K255     | **251 sessões** (linhas 5–255): semana, data, dia, período, tipo, duração, intensidade, km, m, lançamentos, detalhe              | Datas como data do Excel (`dd/mm/aaaa`). Opcionais têm prefixo `◦ ` no Tipo; principais não têm marcador nesta aba                                                    |
| Corrida              | A1:H23      | Progressão S1–S17: Z2, longão, Q1 (terça), Q2 (sexta), sprint, cross                                                             | **Sem linha da S18** (a S18 existe só nas sessões)                                                                                                                    |
| Natação              | A1:F29      | Capacidades × fases; plano semanal S2–S17 (S1/S2, metros)                                                                        | **Sem S1 e sem S18** na tabela (existem nas sessões)                                                                                                                  |
| Força                | A1:F29      | Progressão S2–S17 (esquema, MI, MS+tronco, prevenção) + resumo por capacidade                                                    | Sem S1/S18; cargas em %1RM **estimadas** (não há 1RM nos arquivos)                                                                                                    |
| Granada              | A1:E29      | G1/G2 por semana S1–S18, lançamentos/semana, componentes                                                                         | Lanç./sem bate com Visão Geral                                                                                                                                        |
| Tiro                 | A1:D26      | T1/T2 por semana S1–S18 (a seco), segurança, material                                                                            | —                                                                                                                                                                     |
| Pistas (substitutos) | A1:F28      | Contatos de pliometria, saltos, sprint, circuito PPM por semana S2–S18 + quadro de qualidades                                    | —                                                                                                                                                                     |
| Biblioteca           | A1:B19      | Circuitos PPM-A/B/C/D, protocolos (aquecimento, mobilidade, pré-lançamento, controle de carga), regras de segurança              | —                                                                                                                                                                     |
| Zonas e Paces        | A1:D21      | 9 referências de corrida (pace, %FCmáx, uso) + 5 zonas de natação (British Swimming)                                             | FC máx **não informada**                                                                                                                                              |
| Dieta_Analise        | A1:G32      | Análise da dieta-base (4 refeições), pontos positivos, deficiências, ajustes propostos                                           | 16 mesclagens B:G                                                                                                                                                     |
| Dieta_Timing         | A1:C50      | Pré, intra, pós-treino, **hidratação**, estratégias por tipo de semana, pré-competição, dia de prova, suplementos                | Faixas (ex.: "35–45 ml/kg ≈2,3–2,9 L"), não metas únicas                                                                                                              |
| Dieta_Resumo         | A1:I18      | 6 perfis (kcal, P, C, G, g/kg, quando usar) + comparação com a dieta-base                                                        | Kcal = `SUMIFS` sobre Dieta_Planos; "Dia de prova" tem P/C/G **digitados** (120/450/60) e marcados como estimativa                                                    |
| Dieta_Planos         | A1:J131     | **127 itens** de refeição (5 perfis × 6–7 refeições)                                                                             | Macros por `INDEX/MATCH` em Base_Alimentos × quantidade ÷ medida-base; kcal = `4P+4C+9G`                                                                              |
| Dieta_Calendario     | A1:J34      | Perfil por dia (18 × 7 = 126 dias), kcal médio semanal, contagem por perfil                                                      | Contagens: Intenso 33, Moderado 47, Leve 25, Recuperação 18, Pré-prova 2, Dia de prova 1 (=126)                                                                       |
| Base_Alimentos       | A1:H36      | **32 alimentos** com medida-base, unidade, P, C, G, kcal (fórmula 4/4/9), fonte                                                  | 2 itens **não** vêm da dieta-base: "Macarrão cozido" (USDA) e "Salada de folhas + legumes" (estimativa)                                                               |

### Conferências internas do Plano (todas passaram)

- Datas: 26/10/2026 (S1 SEG) → 28/02/2027 (S18 DOM); dia da semana confere com a data em todas as 251 sessões; semana confere com a data.
- Visão Geral × Sessões: km, metros, lançamentos e nº de sessões recalculados a partir das sessões batem nas 18 semanas
  (total do ciclo: 749,5 km; 44 469 m; 366 lançamentos; 234 sessões sem contar flexibilidade).
- Planilha Semanal × Sessões (detalhe): as 251 sessões aparecem nas duas abas com o mesmo tipo e detalhe; **218 principais (»)** e **33 opcionais (◦)**.
- Planilha Semanal (`DIETA:`) × Dieta_Calendario: os 126 perfis diários coincidem.
- Dieta_Planos × Base_Alimentos: todos os itens recalculam exatamente; unidades coincidem.
- Dieta_Resumo × Dieta_Planos: kcal e macros de cada perfil coincidem com a soma dos itens.
- Base_Alimentos: kcal informada = 4P + 4C + 9G em todos os 32 alimentos.

## 2. Estrutura do arquivo 2 — Dieta-base (3 abas)

Totais: **100 fórmulas**, **0 sem cache**, **0 erros**, 15 mesclagens.

| Aba     | Faixa    | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TMB     | A1:AB22  | Peso **64 kg**, altura **169 cm**, idade **21 anos**, FA **1,6**; GCD = `C6*(66.47+13.75*C3+5*C4-6.8*C5)` = **2 637,872 kcal** (Harris-Benedict × FA). Notas sobre peso ideal (altura² × 21,5) e tabela de FA (1,3–1,7)                                                                                                                                                                                       |
| DIETA   | A1:AR157 | "DIETA BASE - Daniel": grade de **9 refeições** em 3 blocos (linhas 2, 16, 29) × 3 colunas (B–H, J/K–Q, T–Z); colunas Qtd, Alimento, Ptn (A), Ptn (V), Carb, Fat; totais por refeição (g e kcal) e do dia (AD2:AH8). Abaixo (linha 43+), listas de equivalência: **Carbo para cutting** (59 linhas), **Carbo para bulking** (54), **Proteínas** (32), **Gorduras** (23) = **168 porções**, 55 nomes distintos |
| MEDIDAS | A1:G10   | 8 medidas (ombro, peito, braço, antebraço, cintura, quadril, coxa, panturrilha) × 6 colunas "DATA" — **todas vazias**                                                                                                                                                                                                                                                                                         |

### Refeições da dieta-base

| Refeição | Itens                                                                              | Ptn A | Ptn V | Carb  | Gord | Kcal (arquivo) |
| -------- | ---------------------------------------------------------------------------------- | ----- | ----- | ----- | ---- | -------------- |
| 1        | Pão de forma 100 g, Whey 30 g, 1 ovo, Banana nanica 100 g                          | 42,8  | 1,4   | 62,8  | 9,3  | 511,7          |
| 2        | Arroz 100 g, Frango cru 100 g, Feijão 100 g, Suco de laranja 100 ml, 1 ovo         | 28    | 7     | 58,5  | 8,7  | 452,3          |
| 3        | Arroz 100 g, Frango cru 100 g, Feijão 100 g, 1 ovo                                 | 28    | 7     | 42    | 8,7  | 386,3          |
| 4        | Pão de forma 100 g, 1 ovo, Queijo muç. 50 g, Iogurte desnatado 100 g, Banana 100 g | 37,6  | 1,4   | 65,1  | 18,1 | 579,3          |
| 5–9      | **vazias**                                                                         | 0     | 0     | 0     | 0    | 0              |
| **Dia**  |                                                                                    | 136,4 | 16,8  | 228,4 | 44,8 | **1 929,6**    |

Distribuição do dia (fórmulas do arquivo): Ptn A 28,3 %, Ptn V 3,5 %, Carb 47,3 %, Gord 20,9 %;
g/kg (÷ TMB!C3 = 64): Ptn A 2,13; Ptn V 0,26; Carb 3,57; Gord 0,70. "Excedente" = 1 929,6 − 2 637,872 = **−708,272 kcal**.
O arquivo **não informa kcal por alimento** — só por refeição e por dia.

## 3. Como os arquivos se relacionam

```
DIETA BASE (.xls)                               PLANO (.xlsx)
──────────────────                              ─────────────
TMB: peso/altura/idade/FA/GCD ───────────────▶ LEIA-ME (premissas), Dieta_Resumo!B3 (peso 64),
                                                Dieta_Resumo R16 (gasto 2 637,9), Dieta_Timing (g/kg p/ 64 kg)
DIETA: refeições 1–4 (totais) ───────────────▶ Dieta_Analise (diagnóstico) e Dieta_Resumo R15 (comparação)
DIETA: listas de equivalência ───────────────▶ Base_Alimentos (30 de 32 alimentos copiados, nomes normalizados)
                                                        │ INDEX/MATCH
                                                        ▼
Sessões (detalhe) ──SUMIFS──▶ Visão Geral         Dieta_Planos (127 itens, 5 perfis)
       ║ (mesmo conteúdo)                                │ SUMIFS
Planilha Semanal ── "DIETA: perfil" ──▶ Dieta_Calendario ◀── Dieta_Resumo (kcal por perfil)
Periodização / Corrida / Natação / Força / Granada / Tiro / Pistas / Biblioteca / Zonas: referência textual
```

Chave de ligação **dia → treino → perfil**: `data` (Sessões) → semana/dia (Planilha Semanal e
Dieta_Calendario) → nome do perfil → refeições em Dieta_Planos (por nome do perfil) → alimentos em
Base_Alimentos (por nome exato do alimento).

Regra de precedência aplicada no app: **plano = valor operacional**; dieta-base = **referência histórica**
mostrada lado a lado, com a origem (arquivo/aba/célula) de cada valor.

## 4. Relatório de importação (prévia)

| Item                           | Encontrado                                                              |
| ------------------------------ | ----------------------------------------------------------------------- |
| Arquivos reconhecidos          | 2 (XLSX e XLS legítimos, sem conversão de extensão)                     |
| Abas                           | 20 + 3                                                                  |
| Semanas                        | 18 (S1 26/10/2026 → S18 22–28/02/2027)                                  |
| Fases / mesociclos             | 6 / 6                                                                   |
| Sessões                        | 251 (218 principais, 33 opcionais)                                      |
| Perfis nutricionais            | 6 (Intenso, Moderado, Leve, Recuperação, Pré-prova (D-1), Dia de prova) |
| Refeições planejadas           | 34 (7+7+7+6+7 em 5 perfis; **Dia de prova sem refeições**)              |
| Itens de refeição              | 127                                                                     |
| Alimentos (plano)              | 32                                                                      |
| Refeições da dieta-base        | 9 (4 preenchidas, 5 vazias)                                             |
| Porções da dieta-base (listas) | 168 (55 nomes)                                                          |
| Dias com perfil                | 126                                                                     |
| Fórmulas sem resultado         | 0                                                                       |
| Erros bloqueadores             | 0                                                                       |

## 5. Inconsistências, ausências e dados que exigem validação

Legenda de status usada no app: **Não informado**, **Requer validação**, **Dado inconsistente**, **Campo configurável**.

### 5.1 Divergências entre os arquivos (plano operacional × base histórica)

| #   | Item                       | Plano (Base_Alimentos)                    | Dieta-base (DIETA)                                                                         | Status                                                     |
| --- | -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| D1  | Ovo inteiro, 1 un          | P 6 · **C 0,5** · G 5                     | P 6 · **C vazio** · G 5 (M63/V44); 2 un → C 1                                              | Dado inconsistente (o plano usa 0,5 g/un)                  |
| D2  | Whey protein 30 g          | P 23 · C 5 · **G 1,5**                    | P 23 · C 5 · **G vazio** (D5/M74)                                                          | Requer validação (rótulo)                                  |
| D3  | Leite integral             | **100 ml** · 2,9/5/3                      | **"200g"** · 5,8/10/6 (D101)                                                               | Unidade divergente (g × ml)                                |
| D4  | Banana nanica 100 g        | C 23,8                                    | C 23,8 (cutting D54) e **C 24** (bulking D115)                                             | Mesma porção, dois valores na própria base                 |
| D5  | Pão de forma               | C 34 g/100 g                              | idem                                                                                       | Requer validação — o próprio plano marca "conferir rótulo" |
| D6  | Macarrão cozido            | 5,8/30,9/0,9 por 100 g                    | **ausente**                                                                                | Fonte externa (USDA) — fora da dieta-base                  |
| D7  | Salada de folhas + legumes | 1,5/5/0,2 por 100 g                       | **ausente**                                                                                | **Estimativa** do plano                                    |
| D8  | Gasto diário               | 2 637,9 (Dieta_Resumo, valor digitado)    | 2 637,872 (TMB!C7, fórmula)                                                                | Arredondamento — sem impacto                               |
| D9  | Proteína do dia            | 153,2 g (P total)                         | 136,4 A + 16,8 V                                                                           | Igual; o plano soma animal + vegetal                       |
| D10 | Nº de refeições vazias     | "Refeições 5–7 vazias" (Dieta_Analise R9) | refeições **5–9** vazias                                                                   | Texto do plano incompleto                                  |
| D11 | "Erro de valor" no queijo  | Dieta_Analise diz que '1,5' gera erro     | No arquivo o Excel pt-BR **converteu** o texto (G26 = 65,1 inclui 1,5) — sem erro em cache | Depende do idioma do Excel; o app normaliza a vírgula      |

### 5.2 Problemas na dieta-base (preservados como estão, marcados no app)

- **Números como texto com vírgula**: `queijo muç` G20 "1,5", H20 "8,5", G102 "1,5", H102 "8,5" → normalizados para 1,5 e 8,5 com o original preservado.
- **Porções desproporcionais** (mesmo alimento, mesma unidade, macro não proporcional à quantidade):
  Abóbora 300 g P 1,7 (esperado 5,1) · Banana 300 g P 3,2 (4,2) · Beterraba 200 g P 2,8 (3,8) e 300 g P 4,7 (5,7) ·
  Chocolate 60% 25 g G 4,4 (9,2) · Feijão 400 g G 1 (2) · Iogurte 300 g G 0,6 (0,9) · Pão de forma 200 g G 2,1 (8,4) ·
  Pasta de amendoim 60 g 20,5/15/35 (16,4/12/28) · Mandioca 300 g C 108,2 (108,6, diferença pequena) ·
  Ovos 2–4 un com carboidrato 1–2 g enquanto 1 un tem 0.
- **Requeijão light** D97: quantidade `100` **sem unidade** e macros 22/—/12, incompatíveis com 20 g → 2,6/—/1,9 (D96) e com 100 g → 13/—/9,7 (lista de gorduras W56).
- **Porções sem macros**: Batata doce crua 100/200/300 g; Farinha de mandioca crua 25/50 g.
- **Quantidade sem unidade explícita**: ovos (`1`, `2`, `3`, `4` = unidades — interpretado como "un", Requer validação).
- **Líquidos medidos em g**: leite integral "200g", suco de maracujá "100g".
- **Duplicatas exatas entre listas** (não unidas): leite desnatado 200/400/600 ml (cutting e bulking), arroz integral 100/200/300 g, banana 100–300 g, pão de forma 100 g, ovos (proteínas e gorduras), creme de leite (cutting e gorduras), requeijão light (cutting e gorduras), queijo muç (refeição 4 e cutting).
- **Variações de nome**: "Banana nanica" × "banana nanica"; "Carne vermelha crua \*" ("\*" remete à nota L79: patinho, coxão mole, coxão duro, lagarto, maminha, filé mignon, picanha sem gordura); "Abobora Cabotian" (grafia original preservada); espaços extras ("pão de forma ", "100g ").
- Chocolate 60% e iogurte saborizado lançados na coluna **Ptn (A)**; castanha e pasta de amendoim na **Ptn (V)** — preservado.
- Coluna "Gorduras" da lista inclui **ovos** e **creme de leite**, e a de "Carbo para cutting" inclui **requeijão, queijo e leite em pó** — classificação original preservada.
- Rótulos de formato `hh:mm` aplicados a células de texto (B3, B4, B6, A1) — sem efeito, ignorado.

### 5.3 Ausências e premissas do plano (Não informado / Campo configurável)

| Item                            | Situação no app                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Data da competição              | 27/02/2027 é **premissa** (LEIA-ME C13) → **Campo configurável**; mudar a data **não** desloca treinos                    |
| 2º dia de competição (28/02)    | Sessão "Competição (2º dia) / recuperação" condicional — Requer validação (regulamento)                                   |
| Regulamento PNU/PPM             | Não informado (LEIA-ME C18: premissas do autor)                                                                           |
| FC máxima                       | Não informada → zonas por pace; %FCmáx só como apoio                                                                      |
| 1RM / tempos de natação / pista | Não informados → %1RM são estimativas a recalibrar na S8                                                                  |
| Refeições do **Dia de prova**   | **Não informadas** em Dieta_Planos; só macros estimados (Dieta_Resumo R11) e orientações (Dieta_Timing R40–R45)           |
| Perfil "Pré-prova (D-1)"        | Usado também no D-2 (quinta 25/02) — nome do perfil mantido, papel D-2/D-1 indicado                                       |
| Meta diária de água             | Não há meta única: faixa **35–45 ml/kg ≈ 2,3–2,9 L** (Dieta_Timing B20) → o usuário escolhe; padrão = não definida        |
| Creatina                        | Citada como opcional "3–5 g/dia" **só após avaliação** (Dieta_Timing R49) → dose **não pré-preenchida**                   |
| Beta-alanina                    | **Não informada** em nenhum arquivo → dose manual                                                                         |
| Horários das refeições          | Planejados no plano assumindo treino AM ≈06:00 / PM ≈16:00 → configuráveis por registro real                              |
| Medidas corporais               | Seção existe, **vazia**                                                                                                   |
| Tabelas de progressão           | Corrida/Natação/Força sem linha S18 (Natação/Força também sem S1) — as sessões têm os dados                               |
| Duração                         | 2 sessões sem duração numérica: "conforme programação" (competição) e "—" (2º dia)                                        |
| Inconsistência pequena          | S18 QUA "PPM – ativação": duração ≈45' × detalhe "≤25'" → Dado inconsistente                                              |
| Fase 1 volume                   | Periodização "27 → 44 km" × S1 calculada 26,5 km (arredondamento)                                                         |
| Recuperação / Ceia              | "Castanha-do-pará 10 g" aparece **duas vezes** na mesma refeição (Dieta_Planos R108–R109) — possível duplicata, não unida |

### 5.4 Erros bloqueadores

Nenhum. Todos os avisos acima são **não bloqueadores**.

## 6. Decisões de importação (sem inventar dados)

1. Todo valor importado guarda `SourceReference` = arquivo, aba, célula/linha, valor original, valor normalizado e status.
2. Calorias por alimento da dieta-base: **calculadas 4/4/9 apenas para conferência**, rotuladas "calculada" (o arquivo não informa).
3. Nenhuma duplicata é unida automaticamente; nenhum valor é substituído por valor "de mercado".
4. Datas do Excel são lidas pelo número de série (ou objeto Date) e gravadas como `AAAA-MM-DD` sem fuso.
5. Marcadores: `»` principal, `◦` opcional (Planilha Semanal), confirmados com o prefixo `◦` de Sessões (detalhe).
6. Perfil do dia: Dieta_Calendario (conferido com a linha `DIETA:` da Planilha Semanal).
7. Reimportação substitui só os dados de origem do arquivo reimportado; progresso pessoal fica intacto e
   registros sem sessão correspondente ficam preservados e listados como "órfãos".
