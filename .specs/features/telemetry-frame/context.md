# Telemetry frame Context

**Gathered:** 2026-10-06
**Spec:** `.specs/features/telemetry-frame/spec.md`
**Status:** Spec aprovada em 06/10 — pronta para o Design

---

## Feature Boundary

Um modelo interno único, o `TelemetryFrame`, com fonte, relógio da sessão e qualidade em cada
amostra. Toda sessão nova guarda o bruto inteiro nele, as sessões e os traçados antigos são
convertidos, e todo o código do app passa a ler só desse modelo, sem mudar nenhum número. A tela da
sessão ganha um selo de fonte e de qualidade do GPS.

---

## Implementation Decisions

### Alcance da troca

- **Reescrever tudo em TelemetryFrame** (Julia, 06/10). Ela recusou o caminho de manter os
  consumidores lendo `GpsSample` por meio de um adaptador, e também a leitura intermediária ("uma
  fonte, mesmo cálculo"). Todo consumidor de `GpsSample`, `ImuSample`, `LocalSample` e
  `.samples`/`.imuSamples` é reescrito: são cerca de 38 arquivos em `src/` e `app/`, levantados em
  06/10.
- A proteção dos números já validados é a comparação valor a valor com as sessões de referência,
  gravadas a partir do código atual antes de qualquer mudança (TF-14).

### Bruto da sessão inteira

- Sessão inteira, GPS e IMU, guardada até a exclusão da sessão, sem prazo automático (Julia, 06/10).

### Sessões antigas

- Convertidas na atualização, com fonte `PHONE`, marca `legacy` e fix `unknown`. Os tempos salvos
  ficam como estão (Julia, 06/10).

### Qualidade visível

- **Selo na tela da sessão** (Julia, 06/10), e não "só dado". O selo mostra a fonte e a qualidade do
  GPS, pela precisão mediana dos frames dentro das voltas.
- Faixas aprovadas pela Julia em 06/10:
  - boa: ≤ 5 m;
  - média: ≤ 10 m;
  - ruim: acima de 10 m;
  - "desconhecida": quando não há dado de precisão.

### Agent's Discretion

- O formato físico do bruto (blocos, codificação, compressão) fica para o Design, preso ao limite de
  5 MB por 20 min (TF-10).
- O catálogo de unidades fica para o Design, com SI mais rpm e °C.
- O texto exato do selo fica para o Design.

### Declined / Undiscussed Gray Areas → Assumptions

Todas estão na tabela de Assumptions da spec, aprovadas pela Julia com a spec em 06/10:
- forma do modelo (série por fonte e por canal);
- relógio da sessão;
- lista de fontes;
- qualidade por frame;
- pontos sintéticos como cruzamentos;
- filtro de 30 m na leitura;
- unidades;
- traçados com cópia própria;
- volta ilegível;
- espaço;
- tempo de leitura;
- regra de "mesmos números".

---

## Specific References

- O documento "CockPit — Telemetria, IA, Visão Computacional e Arquitetura" (06/10), em dois pontos:
  - §3, modelo sugerido: `t_mono_ns`, lat/lon/alt, speed/heading/accuracy, accel e gyro xyz,
    `yaw_rate`, `rpm?` e `source: PHONE | MYCHRON | ALFANO | GOPRO`;
  - §12, decisões fixas: fonte, timestamp e qualidade em todo dado; formato independente de
    fornecedor; bruto preservado; nada de milhões de linhas no banco transacional.
- O relatório do spike do `.xrk` (`Copilot-kart-dados/xrk/spike/RELATORIO.md`), seção "O que isto
  muda na telemetry-frame".

---

## Deferred Ideas

- Confiança por canal e preferência de fonte (logger, depois GoPro, depois celular): ficam para a feature 6.
- Alinhamento entre fontes por correlação de yaw (Spike E): fica para a v2.
