"""
Cockpit Vision (Externa) — telemetria por vídeo de câmera fixa.

Recebe vídeo de espectador (câmera parada filmando o kart passando) e
gera saída com:
  - Trail brilhante seguindo o kart (últimas N posições com fade)
  - Velocímetro estimado (px/s convertido por calibração)
  - Contador de passagens ("VOLTA 1, 2, 3…")
  - Indicador de aceleração/freada por variação da velocidade

Funciona melhor com:
  - Câmera no tripé (parada)
  - 1 kart por vez no frame
  - Background relativamente uniforme

Uso:
    python process_external.py video.mp4
    python process_external.py video.mp4 saida.mp4 --calib 0.04
"""

import argparse
import sys
from collections import deque
from pathlib import Path

import cv2
import numpy as np


# ============================================================================
# Detector de kart (background subtraction)
# ============================================================================

def make_subtractor() -> cv2.BackgroundSubtractor:
    """MOG2 com sombra desativada — sombra de kart confunde tracking."""
    return cv2.createBackgroundSubtractorMOG2(
        history=400,
        varThreshold=28,
        detectShadows=False,
    )


def find_kart_centroid(
    mask: np.ndarray,
    min_area: int,
    max_area: int,
) -> tuple[int, int, int] | None:
    """Acha maior contorno de área válida e retorna (cx, cy, area). None se nada."""
    # Limpa ruído
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    best = None
    best_area = 0
    for c in contours:
        a = cv2.contourArea(c)
        if a < min_area or a > max_area:
            continue
        if a > best_area:
            best_area = a
            best = c
    if best is None:
        return None

    M = cv2.moments(best)
    if M["m00"] == 0:
        return None
    cx = int(M["m10"] / M["m00"])
    cy = int(M["m01"] / M["m00"])
    return (cx, cy, int(best_area))


# ============================================================================
# Renderização HUD + trail
# ============================================================================

COCKPIT_GREEN = (130, 255, 130)
COCKPIT_RED = (60, 80, 240)
COCKPIT_CYAN = (240, 220, 100)
COCKPIT_WHITE = (240, 240, 240)
COCKPIT_GRAY = (160, 160, 160)
COCKPIT_MAGENTA = (220, 100, 240)


def draw_trail(
    frame: np.ndarray,
    trail: deque,
) -> np.ndarray:
    """Desenha trail com fade — recente = brilhante, antigo = transparente."""
    if len(trail) < 2:
        return frame

    overlay = frame.copy()
    points = list(trail)
    n = len(points)

    # Linha grossa com gradient de cor (verde → magenta cinematic)
    for i in range(1, n):
        p1 = points[i - 1]
        p2 = points[i]
        # Alpha relativo: ponto mais recente = 1, mais antigo = 0.2
        alpha_idx = i / n
        # Cor varia do magenta (antigo) pro verde-claro (novo) → trail moderno
        color = (
            int(COCKPIT_MAGENTA[0] * (1 - alpha_idx) + COCKPIT_GREEN[0] * alpha_idx),
            int(COCKPIT_MAGENTA[1] * (1 - alpha_idx) + COCKPIT_GREEN[1] * alpha_idx),
            int(COCKPIT_MAGENTA[2] * (1 - alpha_idx) + COCKPIT_GREEN[2] * alpha_idx),
        )
        thickness = max(2, int(2 + alpha_idx * 4))
        cv2.line(overlay, p1, p2, color, thickness, lineType=cv2.LINE_AA)

    # Ponta brilhante (última posição)
    last = points[-1]
    cv2.circle(overlay, last, 14, COCKPIT_GREEN, 2, lineType=cv2.LINE_AA)
    cv2.circle(overlay, last, 6, COCKPIT_WHITE, -1, lineType=cv2.LINE_AA)

    # Blend translúcido pra parecer luz
    cv2.addWeighted(overlay, 0.85, frame, 0.15, 0, frame)
    return frame


def draw_hud(
    frame: np.ndarray,
    speed_kmh: float,
    lap_count: int,
    is_accel: bool,
    is_brake: bool,
    frame_num: int,
    total_frames: int,
) -> np.ndarray:
    h, w = frame.shape[:2]

    # Painel HUD superior direito
    px1, py1 = w - 320, 30
    px2, py2 = w - 30, 250
    overlay = frame.copy()
    cv2.rectangle(overlay, (px1, py1), (px2, py2), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)
    cv2.rectangle(frame, (px1, py1), (px2, py2), COCKPIT_GRAY, 1)

    # Velocidade
    cv2.putText(
        frame, f"{int(round(speed_kmh)):3d}",
        (px1 + 40, py1 + 95),
        cv2.FONT_HERSHEY_DUPLEX, 2.4, COCKPIT_GREEN, 5,
    )
    cv2.putText(
        frame, "KM/H (estimado)",
        (px1 + 40, py1 + 130),
        cv2.FONT_HERSHEY_SIMPLEX, 0.55, COCKPIT_WHITE, 1,
    )

    # Linha separadora
    cv2.line(frame, (px1 + 20, py1 + 150), (px2 - 20, py1 + 150), COCKPIT_GRAY, 1)

    # Contador de passagens
    cv2.putText(
        frame, f"PASSAGEM {lap_count}",
        (px1 + 40, py1 + 185),
        cv2.FONT_HERSHEY_SIMPLEX, 0.85, COCKPIT_CYAN, 2,
    )

    # Status (acelerando/freando/cruzeiro)
    if is_brake:
        status_text, status_color = "FREANDO", COCKPIT_RED
    elif is_accel:
        status_text, status_color = "ACELERANDO", COCKPIT_GREEN
    else:
        status_text, status_color = "CRUZEIRO", COCKPIT_GRAY
    cv2.putText(
        frame, status_text,
        (px1 + 40, py1 + 222),
        cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2,
    )

    # Watermark
    cv2.putText(
        frame, "COCKPIT VISION",
        (24, h - 36),
        cv2.FONT_HERSHEY_SIMPLEX, 0.7, COCKPIT_WHITE, 2,
    )
    cv2.putText(
        frame, "trajetoria + velocidade do video",
        (24, h - 16),
        cv2.FONT_HERSHEY_SIMPLEX, 0.45, COCKPIT_GRAY, 1,
    )

    # Barra de progresso
    progress_w = int((frame_num / max(1, total_frames)) * (w - 48))
    cv2.rectangle(frame, (24, h - 6), (24 + progress_w, h - 3), COCKPIT_GREEN, -1)

    return frame


# ============================================================================
# Pipeline
# ============================================================================

def process_external(
    input_path: Path,
    output_path: Path,
    kmh_per_pxps: float,
    trail_seconds: float,
    min_area_pct: float,
    max_area_pct: float,
) -> None:
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        print(f"ERRO: não consegui abrir {input_path}", file=sys.stderr)
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"Input: {input_path.name}")
    print(f"  {width}x{height} @ {fps:.0f}fps  ({total_frames} frames)")
    print(f"Output: {output_path}")
    print(f"Calibração: 1 px/s ≈ {kmh_per_pxps} km/h")

    frame_area = width * height
    min_area = int(frame_area * min_area_pct)
    max_area = int(frame_area * max_area_pct)
    print(f"Detecção: contornos entre {min_area}–{max_area} px²")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))

    subtractor = make_subtractor()
    trail: deque = deque(maxlen=int(trail_seconds * fps))
    last_centroid: tuple[int, int] | None = None
    speed_smooth = 0.0
    SMOOTH = 0.75

    # Lap counter — incrementa quando kart "desaparece" e depois "aparece"
    lap_count = 0
    absent_frames = 0
    ABSENT_THRESHOLD = int(fps * 0.7)  # 0.7s sem detectar = saiu do frame
    was_present = False

    # Detecção de aceleração / freada (variação relativa em ~6 frames)
    speed_history: deque = deque(maxlen=int(fps * 0.4))

    frame_num = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Detecta movimento
        fg_mask = subtractor.apply(frame)
        result = find_kart_centroid(fg_mask, min_area, max_area)

        is_brake = False
        is_accel = False

        if result is not None:
            cx, cy, _ = result
            trail.append((cx, cy))

            # Calcula velocidade entre centroide atual e anterior
            if last_centroid is not None:
                dx = cx - last_centroid[0]
                dy = cy - last_centroid[1]
                px_per_frame = float(np.hypot(dx, dy))
                px_per_sec = px_per_frame * fps
                speed_kmh = px_per_sec * kmh_per_pxps
                speed_kmh = float(np.clip(speed_kmh, 0, 180))
                speed_smooth = SMOOTH * speed_smooth + (1 - SMOOTH) * speed_kmh
            last_centroid = (cx, cy)

            # Lap counter
            if not was_present and absent_frames >= ABSENT_THRESHOLD:
                lap_count += 1
            was_present = True
            absent_frames = 0
        else:
            # Sem kart no frame — decai velocidade
            speed_smooth *= 0.92
            absent_frames += 1
            if absent_frames > ABSENT_THRESHOLD:
                was_present = False
                last_centroid = None

        # Status de aceleração/freada
        speed_history.append(speed_smooth)
        if len(speed_history) >= 4:
            recent = list(speed_history)[-4:]
            past = list(speed_history)[: len(speed_history) - 4] or [recent[0]]
            avg_past = sum(past) / len(past)
            avg_recent = sum(recent) / len(recent)
            if avg_past > 20 and avg_recent < avg_past * 0.78:
                is_brake = True
            elif avg_recent > avg_past * 1.18 and avg_recent > 15:
                is_accel = True

        # Trail brilhante
        frame = draw_trail(frame, trail)

        # HUD
        frame = draw_hud(
            frame,
            speed_smooth,
            max(1, lap_count),  # mostra 1 desde o primeiro detect
            is_accel,
            is_brake,
            frame_num,
            total_frames,
        )

        out.write(frame)
        frame_num += 1

        if frame_num % 60 == 0:
            pct = (frame_num / max(1, total_frames)) * 100
            present_str = "DETECTADO" if last_centroid else "—"
            print(
                f"  {frame_num}/{total_frames} ({pct:5.1f}%)  "
                f"v={speed_smooth:5.1f}  passagem={lap_count}  {present_str}"
            )

    cap.release()
    out.release()
    print(f"\nPronto: {output_path}")
    print("Dica:")
    print(f"  - Velocidade fora? Ajusta --calib (atual {kmh_per_pxps}). Tenta 0.06 ou 0.02.")
    print(f"  - Kart não detectado? Ajusta --min-area-pct (atual {min_area_pct})")
    print(f"  - Detecta sombra/insetos? Aumenta --min-area-pct")


def main() -> None:
    parser = argparse.ArgumentParser(description="Cockpit Vision — telemetria por câmera externa")
    parser.add_argument("input", type=Path, help="vídeo de entrada (mp4, mov)")
    parser.add_argument("output", type=Path, nargs="?", help="vídeo de saída (default: <input>_cockpit.mp4)")
    parser.add_argument(
        "--calib", type=float, default=0.04,
        help="km/h por pixel/segundo (default 0.04). Aumenta se velocidade aparece baixa.",
    )
    parser.add_argument(
        "--trail-seconds", type=float, default=2.0,
        help="duração do trail brilhante em segundos (default 2.0)",
    )
    parser.add_argument(
        "--min-area-pct", type=float, default=0.005,
        help="área mínima do kart como fração do frame (default 0.5%%)",
    )
    parser.add_argument(
        "--max-area-pct", type=float, default=0.35,
        help="área máxima do kart como fração do frame (default 35%%)",
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"ERRO: arquivo não existe: {args.input}", file=sys.stderr)
        sys.exit(1)

    output = args.output or args.input.with_name(f"{args.input.stem}_cockpit.mp4")
    process_external(
        args.input,
        output,
        kmh_per_pxps=args.calib,
        trail_seconds=args.trail_seconds,
        min_area_pct=args.min_area_pct,
        max_area_pct=args.max_area_pct,
    )


if __name__ == "__main__":
    main()
