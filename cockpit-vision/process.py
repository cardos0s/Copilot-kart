"""
Cockpit Vision — MVP de telemetria por vídeo (POV capacete).

Recebe um vídeo POV de kart (GoPro ou similar) e gera um vídeo de saída
com HUD sobreposto: velocidade estimada (km/h), indicador de freada, e
direção lateral aproximada (curva esq/dir/reta).

Não pretende ser preciso como GPS — é demo conceitual da feature de
"telemetria sem app no celular". Para uso real precisa de calibração
empírica do constante km/h-por-pixel-de-fluxo com referência conhecida.

Uso:
    python process.py video.mp4
    python process.py video.mp4 saida.mp4
    python process.py video.mp4 saida.mp4 --calib 35   # calibra escala 30→35 km/h
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np


# ============================================================================
# Estimadores
# ============================================================================

def estimate_forward_flow(prev_gray: np.ndarray, curr_gray: np.ndarray) -> float:
    """Magnitude mediana do fluxo ótico na ROI do chão (metade inferior).

    Retorna deslocamento médio de pixels por frame. A conversão pra km/h
    é feita no caller (calibração linear simples).
    """
    flow = cv2.calcOpticalFlowFarneback(
        prev_gray, curr_gray,
        flow=None,
        pyr_scale=0.5,
        levels=3,
        winsize=15,
        iterations=3,
        poly_n=5,
        poly_sigma=1.2,
        flags=0,
    )
    h, w = flow.shape[:2]
    # ROI do chão: 55% pra baixo, 30% centro horizontal — onde a pista
    # passa mais consistentemente em POV de capacete.
    roi = flow[int(h * 0.55):h, int(w * 0.30):int(w * 0.70)]
    magnitudes = np.linalg.norm(roi, axis=2)
    # Mediana descarta outliers (sombras, cones, pneus do kart no frame).
    return float(np.median(magnitudes))


def estimate_horizon_tilt(gray: np.ndarray) -> float:
    """Inclinação horizontal estimada via linhas longas dominantes.

    Em curvas o "horizonte" (skyline ou paredão) gira porque a câmera
    no capacete acompanha o piloto. Retorna ângulo em graus (negativo
    = inclina pra esquerda, positivo = direita).
    """
    edges = cv2.Canny(gray, 60, 160)
    lines = cv2.HoughLines(edges, 1, np.pi / 180, threshold=180)
    if lines is None:
        return 0.0
    angles = []
    for line in lines[:30]:
        _, theta = line[0]
        angle_deg = np.rad2deg(theta) - 90.0
        # Só linhas próximas da horizontal — descarta verticais (postes, cones).
        if abs(angle_deg) < 35:
            angles.append(angle_deg)
    if not angles:
        return 0.0
    return float(np.median(angles))


# ============================================================================
# Render HUD
# ============================================================================

# Cores estilo Cockpit (BGR — OpenCV usa BGR, não RGB).
COCKPIT_GREEN = (130, 255, 130)
COCKPIT_RED = (60, 80, 240)
COCKPIT_CYAN = (240, 220, 100)
COCKPIT_WHITE = (240, 240, 240)
COCKPIT_GRAY = (160, 160, 160)


def draw_hud(
    frame: np.ndarray,
    speed_kmh: float,
    horizon_deg: float,
    is_braking: bool,
    frame_num: int,
    total_frames: int,
) -> np.ndarray:
    """Desenha overlay HUD sobre o frame.

    - Velocímetro grande no canto superior direito
    - Indicador de curva (esq/reta/dir) abaixo
    - Flash vermelho "FREADA" quando detecta desaceleração brusca
    - Watermark "COCKPIT VISION" rodapé
    - Barra de progresso fina no fundo
    """
    h, w = frame.shape[:2]

    # Painel translúcido superior direito
    panel_x1, panel_y1 = w - 320, 30
    panel_x2, panel_y2 = w - 30, 230
    overlay = frame.copy()
    cv2.rectangle(overlay, (panel_x1, panel_y1), (panel_x2, panel_y2), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)
    cv2.rectangle(frame, (panel_x1, panel_y1), (panel_x2, panel_y2), COCKPIT_GRAY, 1)

    # Velocidade — número grande
    speed_text = f"{int(round(speed_kmh)):3d}"
    cv2.putText(
        frame, speed_text,
        (panel_x1 + 40, panel_y1 + 105),
        cv2.FONT_HERSHEY_DUPLEX, 2.6, COCKPIT_GREEN, 5,
    )
    cv2.putText(
        frame, "KM/H",
        (panel_x1 + 50, panel_y1 + 145),
        cv2.FONT_HERSHEY_SIMPLEX, 0.7, COCKPIT_WHITE, 1,
    )

    # Indicador de direção lateral (estimado pelo horizonte)
    if horizon_deg < -3:
        dir_text = "← CURVA ESQ"
        dir_color = COCKPIT_CYAN
    elif horizon_deg > 3:
        dir_text = "CURVA DIR →"
        dir_color = COCKPIT_CYAN
    else:
        dir_text = "RETA"
        dir_color = COCKPIT_GRAY
    cv2.putText(
        frame, dir_text,
        (panel_x1 + 40, panel_y1 + 190),
        cv2.FONT_HERSHEY_SIMPLEX, 0.8, dir_color, 2,
    )

    # Flash de freada — banner vermelho topo central
    if is_braking:
        banner_x1, banner_x2 = w // 2 - 140, w // 2 + 140
        banner_y1, banner_y2 = 30, 100
        cv2.rectangle(frame, (banner_x1, banner_y1), (banner_x2, banner_y2), COCKPIT_RED, -1)
        cv2.putText(
            frame, "FREADA",
            (banner_x1 + 30, banner_y1 + 50),
            cv2.FONT_HERSHEY_DUPLEX, 1.4, COCKPIT_WHITE, 3,
        )

    # Watermark COCKPIT VISION
    cv2.putText(
        frame, "COCKPIT VISION",
        (24, h - 36),
        cv2.FONT_HERSHEY_SIMPLEX, 0.7, COCKPIT_WHITE, 2,
    )
    cv2.putText(
        frame, "telemetria por video",
        (24, h - 16),
        cv2.FONT_HERSHEY_SIMPLEX, 0.45, COCKPIT_GRAY, 1,
    )

    # Barra de progresso (fina no rodapé)
    progress_w = int((frame_num / max(1, total_frames)) * (w - 48))
    cv2.rectangle(frame, (24, h - 6), (24 + progress_w, h - 3), COCKPIT_GREEN, -1)

    return frame


# ============================================================================
# Pipeline principal
# ============================================================================

def process_video(
    input_path: Path,
    output_path: Path,
    calib_kmh_at_8px: float = 30.0,
) -> None:
    """Processa o vídeo e escreve a saída com HUD."""
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
    print(f"Calibração: fluxo de 8 px/frame ≈ {calib_kmh_at_8px:.0f} km/h")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))

    prev_gray: np.ndarray | None = None
    speed_smooth = 0.0
    horizon_smooth = 0.0
    SMOOTH_SPEED = 0.78  # mais inércia (sente real)
    SMOOTH_HORIZON = 0.85

    # Detecção de freada: queda relativa de velocidade em janela curta
    speed_history: list[float] = []
    BRAKE_WINDOW = 8  # frames pra trás
    BRAKE_DROP_PCT = 0.18  # 18% de queda dispara

    PX_PER_FRAME_AT_CALIB = 8.0  # baseline de calibração

    frame_num = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # Reduz pra acelerar — fluxo ótico é caro em full HD
        small = cv2.resize(gray, (width // 2, height // 2))

        # Velocidade
        if prev_gray is not None:
            flow_px = estimate_forward_flow(prev_gray, small)
            # Calibração linear: x px → x/8 × calib_kmh km/h
            speed_kmh = (flow_px / PX_PER_FRAME_AT_CALIB) * calib_kmh_at_8px
            # Tetos sanos
            speed_kmh = float(np.clip(speed_kmh, 0, 180))
        else:
            speed_kmh = 0.0
        speed_smooth = SMOOTH_SPEED * speed_smooth + (1 - SMOOTH_SPEED) * speed_kmh

        # Horizonte (rolagem da câmera)
        horizon = estimate_horizon_tilt(small)
        horizon_smooth = SMOOTH_HORIZON * horizon_smooth + (1 - SMOOTH_HORIZON) * horizon

        # Detecção de freada — queda relativa
        is_braking = False
        speed_history.append(speed_smooth)
        if len(speed_history) > BRAKE_WINDOW:
            speed_history.pop(0)
            past_max = max(speed_history[:-1])
            if past_max > 25 and speed_smooth < past_max * (1 - BRAKE_DROP_PCT):
                is_braking = True

        # HUD
        frame = draw_hud(
            frame,
            speed_smooth,
            horizon_smooth,
            is_braking,
            frame_num,
            total_frames,
        )

        out.write(frame)
        prev_gray = small
        frame_num += 1

        if frame_num % 60 == 0:
            pct = (frame_num / max(1, total_frames)) * 100
            print(f"  {frame_num}/{total_frames} ({pct:5.1f}%)  v={speed_smooth:5.1f} km/h  h={horizon_smooth:+5.1f}°")

    cap.release()
    out.release()
    print(f"\nPronto: {output_path}")
    print("Dica: se a velocidade tá visivelmente alta/baixa, ajuste --calib")


def main() -> None:
    parser = argparse.ArgumentParser(description="Cockpit Vision — telemetria por vídeo")
    parser.add_argument("input", type=Path, help="vídeo de entrada (mp4, mov)")
    parser.add_argument("output", type=Path, nargs="?", help="vídeo de saída (default: <input>_cockpit.mp4)")
    parser.add_argument(
        "--calib", type=float, default=30.0,
        help="km/h estimado quando fluxo ótico ≈ 8 px/frame (default 30). Aumenta se vídeo aparece lento, diminui se rápido.",
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"ERRO: arquivo não existe: {args.input}", file=sys.stderr)
        sys.exit(1)

    output = args.output or args.input.with_name(f"{args.input.stem}_cockpit.mp4")
    process_video(args.input, output, calib_kmh_at_8px=args.calib)


if __name__ == "__main__":
    main()
