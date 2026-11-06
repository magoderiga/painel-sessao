import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Catalogo, Config, SkillInfo } from '../types'

const STORE_KEY = 'config'
const PANE = 'painel-sessao'
const TITULO = 'Painel de sessão'

// Sessao nova comeca com tudo desligado: voce liga so o que vai usar.
// Vozes pt-BR fixas. A "Multilingual" detecta idioma por trecho e escorrega para espanhol.
const VOZES: { id: string; nome: string }[] = [
  { id: 'pt-BR-FranciscaNeural', nome: 'Francisca' },
  { id: 'pt-BR-AntonioNeural', nome: 'Antonio' },
  { id: 'pt-BR-ThalitaMultilingualNeural', nome: 'Thalita (multilíngue)' },
]
const VOZ_PADRAO = VOZES[0]!.id
const PADRAO: Config = { memoria: false, claudeMd: false, mcpLigados: [], voz: false, velocidade: 1, vozNome: VOZ_PADRAO }
const VELOCIDADES = [0.8, 1, 1.2, 1.5]

// Persistido em $.store (entre sessoes); o atom e o espelho lido pelos hooks.
const config = atom({ plugin: 'painel-sessao', key: 'config' } as const, PADRAO, { shape: 'config-4' })
// So desta sessao: skills marcadas para o proximo pedido.
const skills = atom({ plugin: 'painel-sessao', key: 'skills' } as const, [] as string[])
const oculto = atom({ plugin: 'painel-sessao', key: 'oculto' } as const, false)
const catalogo = atom({ plugin: 'painel-sessao', key: 'catalogo' } as const, {
  servidores: [],
  skills: [],
} as Catalogo)
const ultimaResposta = atom({ plugin: 'painel-sessao', key: 'ultimaResposta' } as const, '')

// Infra do proprio app e do dev de mods: nunca entra no painel nem e bloqueada,
// senao o mod derrubaria ferramentas internas (ccd_*, autoria de mods, navegador).
const INFRA = ['ccd_', 'plugin-authoring', 'Claude_Browser', 'remote-devices', 'computer-use', 'visualize', 'terminal']
const ehInfra = (s: string): boolean => INFRA.some(p => s === p || s.startsWith(p))

const servidorDe = (tool: string): string | null => {
  if (!tool.startsWith('mcp__')) return null
  const s = tool.slice(5).split('__')[0] ?? null
  return s && !ehInfra(s) ? s : null
}

const SKILLS_OCULTAS = new Set(['l', 'l-0', 'painel'])
const GRUPO_MEUS = 'Minhas'

const rateDe = (v: number): string => {
  const pct = Math.round((v - 1) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

async function salvar($: EngineInterface, fn: (c: Config) => Config) {
  const novo = await update($, config, fn)
  await $.store.set(STORE_KEY, novo)
  return novo
}

function scriptVoz($: EngineInterface): string {
  return `${$.plugin.root}/scripts/falar_fila.py`
}

async function falar($: EngineInterface, texto: string, velocidade: number, vozNome: string) {
  if (!texto.trim()) return
  try {
    const r = await $.process.run(['python', scriptVoz($), 'falar', '--rate', rateDe(velocidade), '--voz', vozNome], {
      stdin: texto,
      timeoutMs: 30000,
    })
    if (r.exitCode !== 0) $.ui.toast(`Voz: falha (${(r.stderr || r.stdout).trim().slice(-140)})`)
  } catch (err) {
    $.ui.toast(`Voz: ${String(err).slice(0, 140)}`)
  }
}

async function parar($: EngineInterface) {
  try {
    await $.process.run(['python', scriptVoz($), 'parar'], { timeoutMs: 15000 })
  } catch {
    // nada tocando
  }
}

function grupoDe(c: { source: string; plugin?: string }): string {
  if (c.source === 'user') return GRUPO_MEUS
  if (c.source === 'plugin') return (c.plugin ?? 'plugin').replace(/^anthropic-skills$/, 'Anthropic')
  return c.source
}

// Os servidores MCP conectam depois do session.start: a lista e refeita a cada
// consulta e tambem cresce pelo tool.describe, que dispara ferramenta a ferramenta.
async function atualizarCatalogo($: EngineInterface) {
  const tools = await $.tool.list()
  const vistos = tools.map(t => servidorDe(t.name)).filter((s): s is string => !!s)
  await update($, catalogo, atual => ({
    ...atual,
    servidores: [...new Set([...atual.servidores, ...vistos])].sort(),
  }))
}

async function abrirPainel($: EngineInterface) {
  await atualizarCatalogo($)
  await $.ui.open({ id: PANE, title: TITULO })
}

// Acoes compartilhadas pela faixa e pelo painel.
function acoes($: EngineInterface, c: Config) {
  return {
  alternarMemoria: async () => {
    await salvar($, x => ({ ...x, memoria: !x.memoria }))
    $.ui.invalidate('prompt.section')
  },
  alternarClaudeMd: async () => {
    await salvar($, x => ({ ...x, claudeMd: !x.claudeMd }))
    $.ui.invalidate('prompt.context')
  },
  definirServidores: async (lista: string[]) => {
    await salvar($, x => ({ ...x, mcpLigados: lista }))
    $.ui.invalidate('tool.describe')
  },
  alternarAuto: async () => {
    const novo = await salvar($, x => ({ ...x, voz: !x.voz }))
    if (!novo.voz) void parar($)
    else $.ui.toast('Leitura automatica ligada: cada resposta nova sera lida.')
  },
  lerCaixa: async () => {
    const { text } = await $.prompt.read()
    if (!text.trim()) {
      $.ui.toast('Cole na caixa o trecho que quer ouvir e clique de novo.')
      return
    }
    void falar($, text, c.velocidade, c.vozNome)
  },
  lerUltima: async () => {
    const ultima = await read($, ultimaResposta)
    if (!ultima.trim()) {
      $.ui.toast('Ainda nao ha resposta nesta sessao.')
      return
    }
    void falar($, ultima, c.velocidade, c.vozNome)
  },
}
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const salvo = (await $.store.get(STORE_KEY)) as Partial<Config> | undefined
    if (salvo && typeof salvo === 'object') {
      const v = Number(salvo.velocidade)
      await update($, config, () => ({
        ...PADRAO,
        memoria: salvo.memoria === true,
        claudeMd: salvo.claudeMd === true,
        voz: salvo.voz === true,
        velocidade: VELOCIDADES.includes(v) ? v : 1,
        vozNome: VOZES.some(z => z.id === salvo.vozNome) ? String(salvo.vozNome) : VOZ_PADRAO,
        mcpLigados: Array.isArray(salvo.mcpLigados) ? salvo.mcpLigados.filter(s => typeof s === 'string') : [],
      }))
    }

    const comandos = await $.command.list()
    const lista: SkillInfo[] = comandos
      .filter(c => c.source !== 'builtin' && c.source !== 'mcp' && !SKILLS_OCULTAS.has(c.name))
      .map(c => ({ name: c.name, description: c.description, grupo: grupoDe(c) }))
      .sort((a, b) => {
        const pa = a.grupo === GRUPO_MEUS ? 0 : 1
        const pb = b.grupo === GRUPO_MEUS ? 0 : 1
        return pa - pb || a.grupo.localeCompare(b.grupo) || a.name.localeCompare(b.name)
      })
    await update($, catalogo, atual => ({ ...atual, skills: lista }))
    await atualizarCatalogo($)

    await $.command.register({
      name: 'painel',
      description: 'Abre o painel de sessao (contexto, MCP, skills, voz)',
    })

    return next(e)
  })

  on('command.run', { command: 'painel' }, async $ => {
    await update($, oculto, () => false)
    await abrirPainel($)
    return { text: 'Painel de sessao aberto.' }
  })

  // Memoria automatica: secao "memory" do system prompt.
  on('prompt.section', { name: 'memory' }, async ($, e, next) => {
    const c = await read($, config)
    return c.memoria ? next(e) : { text: null }
  })

  // CLAUDE.md e arquivos de instrucao: bloco claudeMd do contexto.
  on('prompt.context', async ($, e, next) => {
    const c = await read($, config)
    if (c.claudeMd) return next(e)
    return next({ ...e, blocks: e.blocks.filter(b => b.name !== 'claudeMd') })
  })

  // Servidor MCP desligado: schema fica fora do prompt (so atras do ToolSearch).
  on('tool.describe', async ($, e, next) => {
    const s = servidorDe(e.tool)
    if (!s) return next(e)
    const cat = await read($, catalogo)
    if (!cat.servidores.includes(s)) {
      await update($, catalogo, atual => ({ ...atual, servidores: [...new Set([...atual.servidores, s])].sort() }))
    }
    const c = await read($, config)
    if (c.mcpLigados.includes(s)) return next(e)
    return { description: e.description, isDeferred: true }
  })

  // ...e qualquer chamada a ele e negada.
  on('tool.call', async ($, e, next) => {
    const s = servidorDe(e.tool)
    if (!s) return next(e)
    const c = await read($, config)
    if (c.mcpLigados.includes(s)) return next(e)
    return { deny: `Servidor MCP "${s}" esta desligado no painel de sessao (ligue-o na faixa acima do prompt ou em /painel).` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'painel-sessao: falha ao avaliar o servidor' }))

  // Skills marcadas entram como instrucao no inicio do pedido.
  on('prompt.submit', async ($, e, next) => {
    const marcadas = await read($, skills)
    if (marcadas.length === 0 || e.text.trimStart().startsWith('/')) return next(e)
    const nomes = marcadas.map(n => `\`${n}\``).join(', ')
    const texto =
      `[painel-sessao] Antes de responder, invoque com a ferramenta Skill ` +
      `${marcadas.length === 1 ? 'a skill' : 'as skills'} ${nomes} e siga suas instrucoes para o pedido abaixo.\n\n${e.text}`
    return next({ ...e, text: texto })
  })

  // Voz: guarda a ultima resposta e, se a leitura automatica estiver ligada, le.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || e.reason !== 'answer') return r
    const resposta = e.answer ?? ''
    if (!resposta.trim()) return r
    await update($, ultimaResposta, () => resposta)
    const c = await read($, config)
    if (c.voz) void falar($, resposta, c.velocidade, c.vozNome)
    return r
  })

  // Faixa: UMA linha de controles rapidos. Listas ficam no painel lateral.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    if (await read($, oculto)) {
      return (
        <Box>
          <Button key="mostrar" label="Painel" plain dimColor onPress={() => update($, oculto, () => false)} />
        </Box>
      )
    }

    const c = await read($, config)
    const marcadas = await read($, skills)
    const cat = await read($, catalogo)
    const a = acoes($, c)
    const ligadosMcp = c.mcpLigados.filter(s => cat.servidores.includes(s)).length

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
        <Button key="abrir" plain onPress={() => abrirPainel($)}>
          <Text color="claude" bold>Painel</Text>
        </Button>
        <Text color="subtle">│</Text>
        <Button key="memoria" plain dimColor={!c.memoria} onPress={a.alternarMemoria}>
          <Text color={c.memoria ? 'success' : 'inactive'}>{c.memoria ? '●' : '○'}</Text> Memória
        </Button>
        <Button key="claudemd" plain dimColor={!c.claudeMd} onPress={a.alternarClaudeMd}>
          <Text color={c.claudeMd ? 'success' : 'inactive'}>{c.claudeMd ? '●' : '○'}</Text> CLAUDE.md
        </Button>
        <Text color="subtle">│</Text>
        <Button key="mcp" plain dimColor={ligadosMcp === 0} onPress={() => abrirPainel($)}>
          MCP <Text color={ligadosMcp > 0 ? 'success' : 'inactive'}>{ligadosMcp}</Text>/{cat.servidores.length}
        </Button>
        <Button key="skills" plain dimColor={marcadas.length === 0} onPress={() => abrirPainel($)}>
          Skills <Text color={marcadas.length > 0 ? 'warning' : 'inactive'}>{marcadas.length}</Text>/{cat.skills.length}
        </Button>
        <Text color="subtle">│</Text>
        <Button key="voz:auto" plain dimColor={!c.voz} onPress={a.alternarAuto}>
          <Text color={c.voz ? 'success' : 'inactive'}>{c.voz ? '🔊' : '🔇'}</Text> Auto
        </Button>
        <Button key="voz:caixa" plain onPress={a.lerCaixa}>
          <Text color="claude">▶</Text> Ler caixa
        </Button>
        <Button key="voz:parar" plain dimColor onPress={() => parar($)}>
          <Text color="error">■</Text>
        </Button>
        <Button key="ocultar" label="×" plain dimColor role="dismiss" onPress={() => update($, oculto, () => true)} />
      </Box>
    )
  })

  // Painel lateral: listas completas, um item por linha, rolagem do proprio app.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const c = await read($, config)
    const marcadas = await read($, skills)
    const cat = await read($, catalogo)
    const a = acoes($, c)

    const alternarServidor = (s: string) =>
      a.definirServidores(c.mcpLigados.includes(s) ? c.mcpLigados.filter(n => n !== s) : [...c.mcpLigados, s])
    const alternarSkill = (n: string) =>
      update($, skills, lista => (lista.includes(n) ? lista.filter(x => x !== n) : [...lista, n]))

    const item = (key: string, nome: string, marcado: boolean, onPress: () => unknown) => (
      <Button key={key} plain dimColor={!marcado} onPress={onPress}>
        <Text color={marcado ? 'success' : 'inactive'}>{marcado ? '●' : '○'}</Text> {nome}
      </Button>
    )
    const titulo = (texto: string, extra?: string) => (
      <Box marginTop={1} columnGap={1}>
        <Text color="claude" bold>{texto}</Text>
        {extra !== undefined && <Text color="subtle">{extra}</Text>}
      </Box>
    )

    const grupos = [...new Set(cat.skills.map(s => s.grupo))]

    return (
      <Box flexDirection="column" paddingX={1}>
        {titulo('Contexto enviado ao modelo')}
        {item('memoria', 'Memória automática', c.memoria, a.alternarMemoria)}
        {item('claudemd', 'CLAUDE.md e regras', c.claudeMd, a.alternarClaudeMd)}

        {titulo('Servidores MCP', `${c.mcpLigados.filter(s => cat.servidores.includes(s)).length}/${cat.servidores.length}`)}
        <Text dimColor>desligado = schema fora do prompt e chamadas negadas</Text>
        {cat.servidores.length === 0 && <Text dimColor>nenhum servidor conectado ainda</Text>}
        {cat.servidores.map(s => item(`mcp:${s}`, s, c.mcpLigados.includes(s), () => alternarServidor(s)))}
        {cat.servidores.length > 0 && (
          <Box flexDirection="row" columnGap={2}>
            <Button key="mcp:todos" plain dimColor label="ligar todos" onPress={() => a.definirServidores([...cat.servidores])} />
            <Button key="mcp:nenhum" plain dimColor label="desligar todos" onPress={() => a.definirServidores([])} />
            <Button key="mcp:atualizar" plain dimColor label="atualizar lista" onPress={() => atualizarCatalogo($)} />
          </Box>
        )}

        {titulo('Skills', `${marcadas.length}/${cat.skills.length}`)}
        <Text dimColor>marcadas entram como instrucao no proximo pedido</Text>
        {marcadas.length > 0 && (
          <Box flexDirection="row" columnGap={1}>
            <Text color="warning">{marcadas.join(', ')}</Text>
            <Button key="limpar" plain dimColor label="limpar" onPress={() => update($, skills, () => [])} />
          </Box>
        )}
        {cat.skills.length === 0 && <Text dimColor>nenhuma skill encontrada</Text>}
        {grupos.map(g => (
          <Box key={`grupo:${g}`} flexDirection="column">
            <Box marginTop={1}>
              <Text color="warning">{g}</Text>
            </Box>
            {cat.skills
              .filter(s => s.grupo === g)
              .map(s => item(`skill:${s.name}`, s.name, marcadas.includes(s.name), () => alternarSkill(s.name)))}
          </Box>
        ))}

        {titulo('Leitura em voz alta')}
        {item('voz:auto', 'Ler cada resposta nova', c.voz, a.alternarAuto)}
        <Button key="voz:caixa" plain onPress={a.lerCaixa}>
          <Text color="claude">▶</Text> Ler o que está na caixa (cole o trecho e clique)
        </Button>
        <Button key="voz:ultima" plain onPress={a.lerUltima}>
          <Text color="claude">▶</Text> Ler a última resposta
        </Button>
        <Button key="voz:parar" plain onPress={() => parar($)}>
          <Text color="error">■</Text> Parar
        </Button>
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Text color="subtle">Velocidade</Text>
          {VELOCIDADES.map(v => (
            <Button key={`vel:${v}`} plain dimColor={v !== c.velocidade} onPress={() => salvar($, x => ({ ...x, velocidade: v }))}>
              <Text color={v === c.velocidade ? 'success' : 'inactive'}>{v === c.velocidade ? '●' : '○'}</Text> {v.toFixed(1)}x
            </Button>
          ))}
        </Box>
        <Box flexDirection="row" columnGap={2}>
          <Text color="subtle">Voz</Text>
          {VOZES.map(z => (
            <Button key={`voz:nome:${z.id}`} plain dimColor={z.id !== c.vozNome} onPress={() => salvar($, x => ({ ...x, vozNome: z.id }))}>
              <Text color={z.id === c.vozNome ? 'success' : 'inactive'}>{z.id === c.vozNome ? '●' : '○'}</Text> {z.nome}
            </Button>
          ))}
        </Box>
      </Box>
    )
  })
}
