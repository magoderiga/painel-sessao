# painel-sessao

Mod do Claude Code que coloca uma faixa de controles logo acima da caixa do prompt. Serve para voce ligar e desligar, por sessao, o que carrega contexto e consome tokens, sem precisar lembrar nomes de comandos ou de skills.

Cada sessao nova comeca com tudo desligado. Voce habilita manualmente so o que vai usar, e a escolha de contexto, MCP e voz fica salva entre sessoes.

## Como se usa

A **faixa** acima do prompt e uma unica linha de controles rapidos:

`Painel │ ○ Memória  ○ CLAUDE.md │ MCP 2/5  Skills 1/46 │ 🔇 Auto  ▶ Ler caixa  ■ │ ×`

- **Memória** e **CLAUDE.md** ligam e desligam ali mesmo (`●` ligado, `○` desligado).
- **MCP n/m** e **Skills n/m** mostram quantos estao ligados/marcados e abrem o **painel lateral** com as listas completas. O comando `/painel` tambem abre.
- **Auto** liga a leitura em voz alta de cada resposta nova; **Ler caixa** fala o trecho colado na caixa do prompt sem enviar; **■** para a fala.

O **painel lateral** (rolavel, um item por linha) tem:

- **Contexto enviado ao modelo**: memoria automatica (secao `memory` do system prompt) e `CLAUDE.md` e regras (bloco `claudeMd`). Desligado, o texto nao vai ao modelo.
- **Servidores MCP**: um por linha. Desligado = schema das ferramentas fora do prompt (fica so atras do ToolSearch) e qualquer chamada negada. Nao encerra o processo do servidor. A lista e preenchida conforme os servidores conectam (`atualizar lista` reconsulta).
- **Skills**: todas as skills e comandos instalados, agrupados por origem (Minhas, Anthropic, outros plugins). As marcadas entram como instrucao no inicio do proximo pedido, para o agente invoca-las via ferramenta Skill. Vale so para a sessao.
- **Leitura em voz alta**: auto, ler a caixa, ler a ultima resposta, parar e velocidade (0.8 a 1.5x, salva).

Sessao nova comeca com tudo desligado. Memoria, CLAUDE.md, MCP, auto-leitura e velocidade ficam salvos entre sessoes.

## Como funciona por dentro

O mod usa hooks da API de mods do Claude Code: `prompt.section` e `prompt.context` para o contexto, `tool.describe` e `tool.call` para os servidores MCP, `prompt.submit` para injetar as skills marcadas, `turn.complete` para a voz, e `ui.render` no componente `AbovePrompt` para desenhar a faixa. A configuracao persiste em `$.store`.

A voz usa `scripts/falar_fila.py` (dentro do mod): quebra o texto em frases, gera o MP3 completo de cada uma antes de tocar e ja prepara a proxima enquanto a atual toca, por isso nao engasga. Precisa de `python` com `edge-tts` e de `ffplay` (FFmpeg) no PATH, so no Windows. Sem eles, os botoes de voz avisam e o resto do painel funciona normalmente.

## Instalacao

```
/plugin install painel-sessao --marketplace magoderiga/painel-sessao
```

## Desenvolvimento

- `claude plugin validate .` — valida o manifesto e os hooks.
- `claude plugin test .` — roda os testes em `tests/`.

Licenca MIT.
