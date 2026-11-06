"""Leitura em voz alta por fila de frases, sem cortes.

Uso (pelo mod painel-sessao):
  python falar_fila.py falar [--rate +0%] [--voz NOME]   < texto     dispara um worker e volta na hora
  python falar_fila.py parar                                          interrompe a fala atual
  python falar_fila.py --worker ARQ --rate R --voz V                  (interno) gera e toca em fila

Em vez de tocar enquanto baixa (o que engasga quando a rede oscila), o texto e
quebrado em frases; cada frase vira um MP3 completo antes de tocar, e a proxima
e gerada enquanto a atual toca. Nada toca pela metade.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PASTA = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "painel-sessao"
PID = PASTA / "voz.pid"
ESTADO = PASTA / "voz.json"
# Voz fixa em pt-BR: a "Multilingual" detecta idioma por trecho e escorrega para espanhol.
VOZ_PADRAO = "pt-BR-FranciscaNeural"
MAX_FRASE = 260  # chars por trecho de audio


def limpar(t: str) -> str:
    t = re.sub(r"```.*?```", " Trecho de código na tela. ", t, flags=re.S)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"^\s*\|?[-:| ]+\|?\s*$", " ", t, flags=re.M)
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(r"[`*_#|>]", " ", t)
    return re.sub(r"[ \t]+", " ", t).strip()


def frases(t: str):
    """Quebra em frases; junta curtas e parte longas, sem passar de MAX_FRASE."""
    partes = [p.strip() for p in re.split(r"(?<=[.!?:;])\s+|\n{2,}", t) if p.strip()]
    fila, atual = [], ""

    def partir_longa(p):
        while len(p) > MAX_FRASE:
            corte = p.rfind(",", 0, MAX_FRASE)
            corte = corte if corte > 60 else MAX_FRASE
            fila.append(p[:corte].strip())
            p = p[corte:].strip(" ,")
        return p

    for i, p in enumerate(partes):
        if len(p) > MAX_FRASE:
            if atual:
                fila.append(atual)
                atual = ""
            p = partir_longa(p)
        # primeiro trecho = so a primeira frase: a fala comeca rapido
        if i == 0:
            fila.append(p)
            continue
        if len(atual) + len(p) + 1 <= MAX_FRASE:
            atual = (atual + " " + p).strip()
        else:
            if atual:
                fila.append(atual)
            atual = p
    if atual:
        fila.append(atual)
    return [f for f in fila if re.search(r"\w", f)]


def _matar_pid(pid: int):
    subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)


def parar():
    PASTA.mkdir(exist_ok=True)
    if PID.exists():
        try:
            _matar_pid(int(PID.read_text().strip()))
        except ValueError:
            pass
        PID.unlink(missing_ok=True)
    ESTADO.write_text(json.dumps({"estado": "parado"}), encoding="utf-8")


def falar(texto: str, rate: str, voz: str):
    PASTA.mkdir(exist_ok=True)
    parar()
    texto = limpar(texto)
    if not texto:
        print("nada para falar")
        return
    arq = PASTA / f"texto_{int(time.time()*1000)}.txt"
    arq.write_text(texto, encoding="utf-8")
    p = subprocess.Popen(
        [sys.executable, __file__, "--worker", str(arq), "--rate", rate, "--voz", voz],
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW,
        stdin=subprocess.DEVNULL,
        stdout=open(PASTA / "worker.log", "w", encoding="utf-8"),
        stderr=subprocess.STDOUT,
    )
    PID.write_text(str(p.pid))
    print(f"falando pid={p.pid} chars={len(texto)}")


async def _gerar(frase: str, destino: Path, rate: str, voz: str):
    import edge_tts

    com = edge_tts.Communicate(frase, voz, rate=rate)
    await com.save(str(destino))


def _tocar(arquivo: Path):
    subprocess.run(
        ["ffplay", "-nodisp", "-autoexit", "-loglevel", "error", str(arquivo)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )


async def worker(arq: Path, rate: str, voz: str):
    fila = frases(arq.read_text(encoding="utf-8"))
    total = len(fila)
    tmp = PASTA / "audio"
    tmp.mkdir(exist_ok=True)
    for velho in tmp.glob("*.mp3"):
        velho.unlink(missing_ok=True)

    def estado(i, st):
        ESTADO.write_text(json.dumps({"estado": st, "trecho": i, "total": total}), encoding="utf-8")

    async def gerar(i):
        dest = tmp / f"{i:03d}.mp3"
        for tentativa in range(3):
            try:
                await _gerar(fila[i], dest, rate, voz)
                return dest
            except Exception as e:  # rede oscilou: tenta de novo, nao pula
                print(f"trecho {i} tentativa {tentativa+1}: {e}")
                await asyncio.sleep(0.8)
        return None

    proximo = asyncio.ensure_future(gerar(0)) if total else None
    for i in range(total):
        atual = await proximo
        proximo = asyncio.ensure_future(gerar(i + 1)) if i + 1 < total else None
        estado(i + 1, "falando")
        if atual is None:
            continue
        await asyncio.get_event_loop().run_in_executor(None, _tocar, atual)
    estado(total, "fim")
    arq.unlink(missing_ok=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = sys.argv[1:]

    def opt(nome, padrao):
        return args[args.index(nome) + 1] if nome in args and args.index(nome) + 1 < len(args) else padrao

    rate, voz = opt("--rate", "+0%"), opt("--voz", VOZ_PADRAO)
    if not args:
        print(__doc__)
        return
    if args[0] == "parar":
        parar()
        print("parado")
    elif args[0] == "falar":
        falar(sys.stdin.buffer.read().decode("utf-8", "replace"), rate, voz)
    elif args[0] == "--worker":
        asyncio.run(worker(Path(args[1]), rate, voz))
    else:
        print("uso: falar | parar")


if __name__ == "__main__":
    main()
