# Cockpit Vision

MVP de **telemetria por vídeo** — processa vídeo de kart e gera saída com
HUD sobreposto (velocidade estimada, contador, indicador de freada).

Dois modos, escolha pelo ângulo do vídeo:

| Vídeo | Script | O que extrai |
|---|---|---|
| **POV (capacete/GoPro)** — você é o piloto | `process.py` | Velocidade via fluxo da pista + curva esq/dir + freada |
| **Câmera externa fixa** — amigo te filmando | `process_external.py` | Trail brilhante do kart + velocidade + contador de passagens |

## Setup (1 vez só)

```bash
cd cockpit-vision
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Uso — Câmera externa (mais cinematic)

```bash
source venv/bin/activate

# Básico
python process_external.py video.mp4

# Custom output
python process_external.py video.mp4 saida_legal.mp4

# Calibrar velocidade — se aparecer lento, aumenta o calib
python process_external.py video.mp4 --calib 0.08

# Trail mais longo (visual de cometa)
python process_external.py video.mp4 --trail-seconds 3.5
```

**Funciona melhor com**:
- Câmera no tripé (parada)
- Background calmo (não muita gente se mexendo atrás)
- 1 kart por vez no frame
- Resolução mínima 720p

## Uso — POV capacete

```bash
python process.py video.mp4
python process.py video.mp4 --calib 45
```

## Calibração

A velocidade é **estimativa**, não GPS. Cada modo tem seu calibrador:

| Script | Parâmetro | Default | Quando ajustar |
|---|---|---|---|
| POV | `--calib` | `30` (km/h a 8px/frame de fluxo) | Aumenta se vídeo aparece lento |
| Externa | `--calib` | `0.04` (km/h por px/segundo) | Aumenta se velocidade baixa |

**Calibração precisa**: se você sabe que numa reta o kart faz X km/h
(pelo Cockpit ou cronômetro), rode com vários `--calib` até o HUD bater.

## Troubleshooting câmera externa

- **Kart não detectado**: aumenta a sensibilidade com `--min-area-pct 0.002`
- **Detecta sombras/galhos**: diminui com `--min-area-pct 0.01`
- **Contador erra passagens**: significa que o kart ficou parcialmente fora do
  frame ou a câmera tem ruído — geralmente OK em vídeo limpo
- **Trail aparece e some**: kart provavelmente saiu do frame e voltou. Esperado.

## Limitações honestas

- **Não é GPS preciso** — é estimativa por pixels. Erro típico ±10-20 km/h.
- **Background subtraction precisa câmera parada** — qualquer pan/zoom quebra.
- **1 kart por vez** — se vários karts no frame, pega o maior.
- **Indicador de status (acelerando/freando) é heurístico** — variação relativa
  da velocidade estimada, não medição absoluta.

## Próximas evoluções (não-MVP)

- YOLO pra detecção robusta (funciona com câmera se movendo)
- OCR de cronometragem oficial visível no vídeo
- Múltiplos karts simultâneos com IDs persistentes
- Fusão com GPX exportado do Cockpit (vídeo + GPS = telemetria completa)
