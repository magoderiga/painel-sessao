# painel-sessao

Mod do Claude Code que coloca uma faixa de controles logo acima da caixa do prompt. Serve para voce ligar e desligar, por sessao, o que carrega contexto e consome tokens, sem precisar lembrar nomes de comandos ou de skills.

Cada sessao nova comeca com tudo desligado. Voce habilita manualmente so o que vai usar, e a escolha de contexto, MCP e voz fica salva entre sessoes.

## O que a faixa controla

- **Contexto** — liga/desliga a memoria automatica (secao `memory` do system prompt) e os arquivos de instrucao `CLAUDE.md` e regras (bloco `claudeMd` do contexto). Desligado, o texto nao e enviado ao modelo.
- **MCP** — um botao por servidor MCP conectado, mais os atalhos `todos` e `nenhum`. Servidor desligado tem o schema das ferramentas tirado do prompt (fica apenas atras do ToolSearch) e qualquer chamada a ele e negada. Nao encerra o processo do servidor; apenas o esconde do modelo.
- **Skills** — todas as skills e comandos instalados, agrupados por origem (suas, Anthropic, outros plugins). Marque as caixas das que quer usar: elas entram como instrucao no inicio do seu proximo pedido, para o agente invoca-las via ferramenta Skill. A marcacao vale so para a sessao.
- **Voz** — ao ligar, le em voz alta a ultima resposta do Claude e segue lendo cada resposta nova. Ao desligar, interrompe a fala. Usa o script local `falar_resposta.py` (voz neural do edge-tts com ffplay).

Botao `×` oculta a faixa; o comando `/painel` mostra de novo.

## Como funciona por dentro

O mod usa hooks da API de mods do Claude Code: `prompt.section` e `prompt.context` para o contexto, `tool.describe` e `tool.call` para os servidores MCP, `prompt.submit` para injetar as skills marcadas, `turn.complete` para a voz, e `ui.render` no componente `AbovePrompt` para desenhar a faixa. A configuracao persiste em `$.store`.

A voz depende de um script Python local (`~/.claude/hooks/falar_resposta.py`) com `edge-tts` e `ffplay` disponiveis. Sem ele, so o botao de voz fica sem efeito; o resto do painel funciona normalmente.

## Instalacao

```
/plugin install painel-sessao --marketplace magoderiga/painel-sessao
```

## Desenvolvimento

- `claude plugin validate .` — valida o manifesto e os hooks.
- `claude plugin test .` — roda os testes em `tests/`.

Licenca MIT.
